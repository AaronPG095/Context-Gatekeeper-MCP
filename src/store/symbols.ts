import type { DatabaseSync } from 'node:sqlite';
import { buildSafeFtsQuery } from './artifacts.js';

export interface FileRecord {
  id: number;
  rel_path: string;
  lang: string;
  sha256: string;
  mtime_ms: number;
  line_count: number;
  indexed_at: number;
}

export interface SymbolInput {
  name: string;
  qualifiedName: string;
  kind: string;
  signature: string;
  isExported: boolean;
  startLine: number;
  endLine: number;
  parentQualifiedName?: string;
}

export interface SymbolRecord {
  id: number;
  file_id: number;
  name: string;
  qualified_name: string;
  kind: string;
  signature: string;
  is_exported: number;
  start_line: number;
  end_line: number;
  parent_id: number | null;
}

export interface SymbolRefInput {
  symbolName: string;
  lineNo: number;
  colNo: number;
  snippet: string;
}

export interface SymbolRefRecord {
  rel_path: string;
  symbol_name: string;
  line_no: number;
  col_no: number;
  snippet: string;
}

export interface UpsertFileIndexInput {
  relPath: string;
  lang: string;
  sha256: string;
  mtimeMs: number;
  lineCount: number;
  symbols: SymbolInput[];
  refs: SymbolRefInput[];
}

export interface SymbolSearchHit {
  rel_path: string;
  qualified_name: string;
  kind: string;
  signature: string;
  start_line: number;
  end_line: number;
}

export interface RepoMapFileEntry {
  rel_path: string;
  lang: string;
  line_count: number;
  inbound_refs: number;
  symbols: Array<{
    name: string;
    kind: string;
    is_exported: number;
    start_line: number;
    end_line: number;
  }>;
}

/**
 * Normalizes a relative file path to forward slashes without leading `./`.
 */
export function normalizeRelPath(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return norm === '.' ? '' : norm;
}

/**
 * Persists and queries AST-extracted files, symbols, and references in SQLite.
 */
export class SymbolStore {
  constructor(private readonly db: DatabaseSync) {}

  getFileMeta(relPath: string): FileRecord | undefined {
    const norm = normalizeRelPath(relPath);
    return this.db
      .prepare('SELECT * FROM files WHERE rel_path = ?')
      .get(norm) as FileRecord | undefined;
  }

  listFilePaths(): string[] {
    const rows = this.db
      .prepare('SELECT rel_path FROM files ORDER BY rel_path ASC')
      .all() as Array<{ rel_path: string }>;
    return rows.map((r) => r.rel_path);
  }

  touchFileMtime(relPath: string, mtimeMs: number): void {
    const norm = normalizeRelPath(relPath);
    this.db
      .prepare('UPDATE files SET mtime_ms = ?, indexed_at = ? WHERE rel_path = ?')
      .run(mtimeMs, Date.now(), norm);
  }

  upsertFileIndex(input: UpsertFileIndexInput): void {
    const relPath = normalizeRelPath(input.relPath);
    const now = Date.now();

    const upsertFile = this.db.prepare(`
      INSERT INTO files (rel_path, lang, sha256, mtime_ms, line_count, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(rel_path) DO UPDATE SET
        lang = excluded.lang,
        sha256 = excluded.sha256,
        mtime_ms = excluded.mtime_ms,
        line_count = excluded.line_count,
        indexed_at = excluded.indexed_at
      RETURNING id
    `);

    const deleteSymbols = this.db.prepare('DELETE FROM symbols WHERE file_id = ?');
    const deleteRefs = this.db.prepare('DELETE FROM symbol_refs WHERE file_id = ?');
    const insertSymbol = this.db.prepare(`
      INSERT INTO symbols (
        file_id, name, qualified_name, kind, signature,
        is_exported, start_line, end_line, parent_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRef = this.db.prepare(`
      INSERT INTO symbol_refs (file_id, symbol_name, line_no, col_no, snippet)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.db.exec('BEGIN');
    try {
      const fileRow = upsertFile.get(
        relPath,
        input.lang,
        input.sha256,
        input.mtimeMs,
        input.lineCount,
        now,
      ) as { id: number };
      const fileId = fileRow.id;

      deleteSymbols.run(fileId);
      deleteRefs.run(fileId);

      const idByQualified = new Map<string, number>();
      for (const sym of input.symbols) {
        const parentId = sym.parentQualifiedName
          ? (idByQualified.get(sym.parentQualifiedName) ?? null)
          : null;
        const info = insertSymbol.run(
          fileId,
          sym.name,
          sym.qualifiedName,
          sym.kind,
          sym.signature,
          sym.isExported ? 1 : 0,
          sym.startLine,
          sym.endLine,
          parentId,
        );
        idByQualified.set(sym.qualifiedName, Number(info.lastInsertRowid));
      }

      for (const ref of input.refs) {
        insertRef.run(fileId, ref.symbolName, ref.lineNo, ref.colNo, ref.snippet);
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  pruneDeletedFiles(existingRelPaths: Set<string>): number {
    const existing = this.listFilePaths();
    const deleteStmt = this.db.prepare('DELETE FROM files WHERE rel_path = ?');
    let pruned = 0;

    this.db.exec('BEGIN');
    try {
      for (const rel of existing) {
        if (!existingRelPaths.has(rel)) {
          deleteStmt.run(rel);
          pruned += 1;
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return pruned;
  }

  getRepoMapEntries(pathPrefix?: string): RepoMapFileEntry[] {
    const normPrefix = pathPrefix ? normalizeRelPath(pathPrefix) : '';
    const escapedPrefix = normPrefix.replace(/[\\%_]/g, (m) => `\\${m}`);
    const fileRows = (
      normPrefix
        ? this.db
            .prepare(
              `SELECT id, rel_path, lang, line_count
               FROM files
               WHERE rel_path = ? OR rel_path LIKE ? ESCAPE '\\'
               ORDER BY rel_path ASC`,
            )
            .all(normPrefix, `${escapedPrefix}/%`)
        : this.db
            .prepare(
              `SELECT id, rel_path, lang, line_count
               FROM files
               ORDER BY rel_path ASC`,
            )
            .all()
    ) as Array<{ id: number; rel_path: string; lang: string; line_count: number }>;

    const topSymbolsStmt = this.db.prepare(`
      SELECT name, kind, is_exported, start_line, end_line
      FROM symbols
      WHERE file_id = ? AND parent_id IS NULL
      ORDER BY is_exported DESC, start_line ASC, id ASC
    `);

    const inboundRows = this.db
      .prepare(
        `SELECT s.file_id, COUNT(*) AS cnt
         FROM symbol_refs r
         JOIN symbols s ON s.name = r.symbol_name AND s.is_exported = 1 AND s.parent_id IS NULL
         WHERE r.file_id != s.file_id
         GROUP BY s.file_id`,
      )
      .all() as Array<{ file_id: number; cnt: number }>;
    const inboundMap = new Map(inboundRows.map((r) => [r.file_id, r.cnt]));

    return fileRows.map((f) => {
      const allTop = topSymbolsStmt.all(f.id) as RepoMapFileEntry['symbols'];
      const exported = allTop.filter((s) => s.is_exported === 1);
      return {
        rel_path: f.rel_path,
        lang: f.lang,
        line_count: f.line_count,
        inbound_refs: inboundMap.get(f.id) ?? 0,
        symbols: exported.length > 0 ? exported : allTop,
      };
    });
  }

  getFileSymbols(relPath: string): SymbolRecord[] {
    const norm = normalizeRelPath(relPath);
    return this.db
      .prepare(
        `SELECT s.*
         FROM symbols s
         JOIN files f ON f.id = s.file_id
         WHERE f.rel_path = ?
         ORDER BY s.start_line ASC, s.id ASC`,
      )
      .all(norm) as unknown as SymbolRecord[];
  }

  findSymbolInFile(relPath: string, symbolQuery: string): SymbolRecord | undefined {
    const norm = normalizeRelPath(relPath);
    const byQualified = this.db
      .prepare(
        `SELECT s.*
         FROM symbols s
         JOIN files f ON f.id = s.file_id
         WHERE f.rel_path = ? AND s.qualified_name = ?
         ORDER BY s.start_line ASC
         LIMIT 1`,
      )
      .get(norm, symbolQuery) as SymbolRecord | undefined;
    if (byQualified) return byQualified;

    return this.db
      .prepare(
        `SELECT s.*
         FROM symbols s
         JOIN files f ON f.id = s.file_id
         WHERE f.rel_path = ? AND s.name = ?
         ORDER BY s.start_line ASC
         LIMIT 1`,
      )
      .get(norm, symbolQuery) as SymbolRecord | undefined;
  }

  findReferences(symbolName: string, limit = 100): SymbolRefRecord[] {
    return this.db
      .prepare(
        `SELECT f.rel_path, r.symbol_name, r.line_no, r.col_no, r.snippet
         FROM symbol_refs r
         JOIN files f ON f.id = r.file_id
         WHERE r.symbol_name = ?
         ORDER BY f.rel_path ASC, r.line_no ASC, r.col_no ASC
         LIMIT ?`,
      )
      .all(symbolName, Math.max(1, limit)) as unknown as SymbolRefRecord[];
  }

  searchSymbols(query: string, limit = 30): SymbolSearchHit[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const max = Math.max(1, limit);
    const ftsQuery = buildSafeFtsQuery(trimmed);

    if (ftsQuery) {
      try {
        const rows = this.db
          .prepare(
            `SELECT f.rel_path, s.qualified_name, s.kind, s.signature, s.start_line, s.end_line
             FROM symbols_fts fts
             JOIN symbols s ON s.id = fts.rowid
             JOIN files f ON f.id = s.file_id
             WHERE symbols_fts MATCH ?
             ORDER BY s.is_exported DESC, f.rel_path ASC, s.start_line ASC
             LIMIT ?`,
          )
          .all(ftsQuery, max) as unknown as SymbolSearchHit[];
        if (rows.length > 0) return rows;
      } catch {
        // Fall back to LIKE below.
      }
    }

    const escaped = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`);
    return this.db
      .prepare(
        `SELECT f.rel_path, s.qualified_name, s.kind, s.signature, s.start_line, s.end_line
         FROM symbols s
         JOIN files f ON f.id = s.file_id
         WHERE s.qualified_name LIKE ? ESCAPE '\\' OR s.signature LIKE ? ESCAPE '\\'
         ORDER BY s.is_exported DESC, f.rel_path ASC, s.start_line ASC
         LIMIT ?`,
      )
      .all(`%${escaped}%`, `%${escaped}%`, max) as unknown as SymbolSearchHit[];
  }

  getOneHopDependencies(
    relPath: string,
    startLine: number,
    endLine: number,
    limit = 15,
  ): SymbolSearchHit[] {
    const norm = normalizeRelPath(relPath);
    return this.db
      .prepare(
        `SELECT DISTINCT f2.rel_path, s.qualified_name, s.kind, s.signature, s.start_line, s.end_line
         FROM symbol_refs r
         JOIN files f1 ON f1.id = r.file_id
         JOIN symbols s ON s.name = r.symbol_name
         JOIN files f2 ON f2.id = s.file_id
         WHERE f1.rel_path = ? AND r.line_no BETWEEN ? AND ?
         ORDER BY s.is_exported DESC, (f2.rel_path = f1.rel_path) DESC, f2.rel_path ASC, s.start_line ASC
         LIMIT ?`,
      )
      .all(norm, startLine, endLine, Math.max(1, limit)) as unknown as SymbolSearchHit[];
  }
}
