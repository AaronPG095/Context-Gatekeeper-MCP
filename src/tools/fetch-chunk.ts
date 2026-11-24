import type { ArtifactLineRow, ArtifactStore } from '../store/artifacts.js';

export interface FetchChunkInput {
  artifact_id: string;
  query?: string;
  line_range?: [number, number] | string;
  context_lines?: number;
  limit?: number;
}

export interface FetchChunkResult {
  artifact_id: string;
  total_lines: number;
  mode: 'line_range' | 'fts_query' | 'head';
  returned_lines: number;
  content: string;
}

/**
 * Parses `"start-end"`, `"start..end"`, or `[start, end]` into an inclusive
 * 1-based `[start, end]` tuple.
 */
export function parseLineRange(
  range: [number, number] | string,
): [number, number] {
  if (Array.isArray(range)) {
    const start = Math.max(1, Math.floor(range[0]));
    const end = Math.max(start, Math.floor(range[1]));
    return [start, end];
  }
  const match = range.trim().match(/^(\d+)\s*(?:\.\.|-|:)\s*(\d+)$/);
  if (!match) {
    throw new Error(`Invalid line_range "${range}". Expected "start-end" or "start..end".`);
  }
  const start = Math.max(1, Number.parseInt(match[1], 10));
  const end = Math.max(start, Number.parseInt(match[2], 10));
  return [start, end];
}

/**
 * Retrieves exact lines or FTS5-matched chunks (with configurable context)
 * from a stored `artifact_id`.
 */
export function fetchChunk(
  store: ArtifactStore,
  input: FetchChunkInput,
): FetchChunkResult {
  const artifact = store.getArtifact(input.artifact_id);
  if (!artifact) {
    throw new Error(`Artifact not found: ${input.artifact_id}`);
  }

  let mode: FetchChunkResult['mode'] = 'head';
  let rows: ArtifactLineRow[];

  if (input.line_range !== undefined) {
    mode = 'line_range';
    const [start, end] = parseLineRange(input.line_range);
    rows = store.fetchByLineRange(input.artifact_id, start, end);
  } else if (input.query && input.query.trim().length > 0) {
    mode = 'fts_query';
    rows = store.searchLines(input.artifact_id, input.query, {
      contextLines: input.context_lines ?? 2,
      limit: input.limit ?? 50,
    });
  } else {
    rows = store.fetchByLineRange(input.artifact_id, 1, 50);
  }

  const content = formatRows(rows);
  return {
    artifact_id: input.artifact_id,
    total_lines: artifact.raw_lines,
    mode,
    returned_lines: rows.length,
    content,
  };
}

function formatRows(rows: ArtifactLineRow[]): string {
  if (rows.length === 0) return '(no matching lines)';
  const out: string[] = [];
  let prevLine = rows[0].line_no - 1;

  for (const row of rows) {
    if (row.line_no > prevLine + 1) {
      out.push('---');
    }
    const marker = row.isMatch ? '*' : ' ';
    out.push(`${marker}L${row.line_no}: ${row.text}`);
    prevLine = row.line_no;
  }
  return out.join('\n');
}
