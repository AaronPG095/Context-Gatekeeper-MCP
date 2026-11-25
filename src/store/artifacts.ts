import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type OutputStream = 'stdout' | 'stderr';

export interface OutputLine {
  stream: OutputStream;
  text: string;
}

export interface ArtifactRecord {
  id: string;
  command: string;
  cwd: string;
  exit_code: number;
  duration_ms: number;
  raw_bytes: number;
  raw_lines: number;
  summary_bytes: number;
  summary_text: string;
  created_at: number;
}

export interface ArtifactLineRow {
  line_no: number;
  stream: OutputStream;
  text: string;
  isMatch?: boolean;
}

export interface SaveArtifactInput {
  command: string;
  cwd: string;
  exitCode: number;
  durationMs: number;
  lines: OutputLine[];
  summaryText: string;
  maxArtifacts?: number;
}

export interface SearchLinesOptions {
  contextLines?: number;
  limit?: number;
}

/**
 * Escapes arbitrary user/agent search terms into a safe FTS5 MATCH expression
 * by quoting each whitespace-separated token so punctuation like `:` or `-`
 * does not trigger FTS5 syntax errors.
 */
export function buildSafeFtsQuery(rawQuery: string): string {
  const tokens = rawQuery
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  return tokens.join(' ');
}

/**
 * Persists raw command output into `artifacts` and `artifact_lines` (indexed by FTS5)
 * and provides fast line-range and full-text chunk retrieval.
 */
export class ArtifactStore {
  constructor(private readonly db: DatabaseSync) {}

  saveArtifact(input: SaveArtifactInput): ArtifactRecord {
    const id = `art_${randomBytes(4).toString('hex')}`;
    const createdAt = Date.now();
    const rawBytes = input.lines.reduce(
      (sum, line) => sum + Buffer.byteLength(line.text, 'utf8') + 1,
      0,
    );
    const summaryBytes = Buffer.byteLength(input.summaryText, 'utf8');
    const maxArtifacts = input.maxArtifacts ?? 200;

    const insertArtifact = this.db.prepare(`
      INSERT INTO artifacts (
        id, command, cwd, exit_code, duration_ms,
        raw_bytes, raw_lines, summary_bytes, summary_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLine = this.db.prepare(`
      INSERT INTO artifact_lines (artifact_id, line_no, stream, text)
      VALUES (?, ?, ?, ?)
    `);

    this.db.exec('BEGIN');
    try {
      insertArtifact.run(
        id,
        input.command,
        input.cwd,
        input.exitCode,
        Math.round(input.durationMs),
        rawBytes,
        input.lines.length,
        summaryBytes,
        input.summaryText,
        createdAt,
      );

      for (let i = 0; i < input.lines.length; i += 1) {
        const line = input.lines[i];
        insertLine.run(id, i + 1, line.stream, line.text);
      }

      if (maxArtifacts > 0) {
        this.evictOldest(maxArtifacts);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return {
      id,
      command: input.command,
      cwd: input.cwd,
      exit_code: input.exitCode,
      duration_ms: Math.round(input.durationMs),
      raw_bytes: rawBytes,
      raw_lines: input.lines.length,
      summary_bytes: summaryBytes,
      summary_text: input.summaryText,
      created_at: createdAt,
    };
  }

  getLatestArtifactForCommand(command: string, cwd: string): ArtifactRecord | undefined {
    return this.db
      .prepare(
        `SELECT * FROM artifacts
         WHERE command = ? AND cwd = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(command, cwd) as ArtifactRecord | undefined;
  }

  getArtifact(id: string): ArtifactRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM artifacts WHERE id = ?')
      .get(id) as ArtifactRecord | undefined;
    return row;
  }

  fetchByLineRange(
    artifactId: string,
    startLine: number,
    endLine: number,
  ): ArtifactLineRow[] {
    const start = Math.max(1, Math.floor(startLine));
    const end = Math.max(start, Math.floor(endLine));
    return this.db
      .prepare(
        `SELECT line_no, stream, text
         FROM artifact_lines
         WHERE artifact_id = ? AND line_no BETWEEN ? AND ?
         ORDER BY line_no ASC`,
      )
      .all(artifactId, start, end) as unknown as ArtifactLineRow[];
  }

  searchLines(
    artifactId: string,
    query: string,
    options: SearchLinesOptions = {},
  ): ArtifactLineRow[] {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const contextLines = Math.max(0, options.contextLines ?? 2);
    const limit = Math.max(1, options.limit ?? 50);

    let matchedLineNos: number[] = [];
    const ftsQuery = buildSafeFtsQuery(trimmed);

    if (ftsQuery) {
      try {
        const rows = this.db
          .prepare(
            `SELECT line_no
             FROM artifact_lines_fts
             WHERE artifact_id = ? AND artifact_lines_fts MATCH ?
             ORDER BY line_no ASC
             LIMIT ?`,
          )
          .all(artifactId, ftsQuery, limit) as Array<{ line_no: number }>;
        matchedLineNos = rows.map((r) => r.line_no);
      } catch {
        // Fall through to substring LIKE search if FTS5 rejects the query.
      }
    }

    if (matchedLineNos.length === 0) {
      const escaped = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`);
      const rows = this.db
        .prepare(
          `SELECT line_no
           FROM artifact_lines
           WHERE artifact_id = ? AND text LIKE ? ESCAPE '\\'
           ORDER BY line_no ASC
           LIMIT ?`,
        )
        .all(artifactId, `%${escaped}%`, limit) as Array<{ line_no: number }>;
      matchedLineNos = rows.map((r) => r.line_no);
    }

    if (matchedLineNos.length === 0) return [];

    const matchSet = new Set(matchedLineNos);
    const ranges = mergeLineRanges(
      matchedLineNos.map((n) => [Math.max(1, n - contextLines), n + contextLines]),
    );

    const results: ArtifactLineRow[] = [];
    for (const [start, end] of ranges) {
      const chunk = this.fetchByLineRange(artifactId, start, end);
      for (const row of chunk) {
        results.push({
          ...row,
          isMatch: matchSet.has(row.line_no),
        });
      }
    }
    return results;
  }

  private evictOldest(maxArtifacts: number): void {
    this.db
      .prepare(
        `DELETE FROM artifacts
         WHERE id IN (
           SELECT id FROM artifacts
           ORDER BY created_at DESC, rowid DESC
           LIMIT -1 OFFSET ?
         )`,
      )
      .run(maxArtifacts);
  }
}

function mergeLineRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const [start, end] = sorted[i];
    const prev = merged[merged.length - 1];
    if (start <= prev[1] + 1) {
      prev[1] = Math.max(prev[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}
