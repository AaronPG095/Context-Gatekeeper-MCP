import { normalizeRelPath, type SymbolStore } from '../store/symbols.js';

export interface RepoMapInput {
  path?: string;
  depth?: number;
  limit?: number;
  query?: string;
  maxSymbolsPerFile?: number;
}

export interface RepoMapResult {
  files_count: number;
  omitted_count: number;
  content: string;
}

/**
 * Returns a compact structural overview of indexed files and top-level
 * exported symbols (with line counts), or searches symbols via FTS5 when
 * `query` is provided.
 */
export function repoMap(
  store: SymbolStore,
  input: RepoMapInput = {},
): RepoMapResult {
  const limit = input.limit ?? 50;

  if (input.query && input.query.trim().length > 0) {
    const prefix = input.path ? normalizeRelPath(input.path) : '';
    const hits = store.searchSymbols(input.query, limit).filter((h) => {
      if (!prefix) return true;
      return h.rel_path === prefix || h.rel_path.startsWith(`${prefix}/`);
    });
    if (hits.length === 0) {
      return {
        files_count: 0,
        omitted_count: 0,
        content: `(no symbols matched "${input.query.trim()}")`,
      };
    }
    const uniqueFiles = new Set(hits.map((h) => h.rel_path)).size;
    const lines = hits.map(
      (h) => `${h.rel_path}:L${h.start_line} [${h.kind}] ${h.qualified_name} — ${h.signature}`,
    );
    return {
      files_count: uniqueFiles,
      omitted_count: 0,
      content: lines.join('\n'),
    };
  }

  const prefix = input.path ? normalizeRelPath(input.path) : '';
  const maxDepth = input.depth;
  const maxSyms = input.maxSymbolsPerFile ?? 8;

  const filtered = store.getRepoMapEntries(prefix || undefined).filter((entry) => {
    if (maxDepth === undefined) return true;
    const relToPrefix = prefix
      ? entry.rel_path === prefix
        ? ''
        : entry.rel_path.slice(prefix.length + 1)
      : entry.rel_path;
    if (!relToPrefix) return true;
    const segments = relToPrefix.split('/').length - 1;
    return segments <= maxDepth;
  });

  if (filtered.length === 0) {
    return { files_count: 0, omitted_count: 0, content: '(no indexed files match)' };
  }

  let selected = filtered;
  let omittedCount = 0;
  if (filtered.length > limit) {
    selected = [...filtered]
      .sort(
        (a, b) =>
          b.inbound_refs - a.inbound_refs ||
          b.line_count - a.line_count ||
          a.rel_path.localeCompare(b.rel_path),
      )
      .slice(0, limit);
    omittedCount = filtered.length - selected.length;
  }

  const lines = selected.map((entry) => {
    const syms = entry.symbols
      .slice(0, maxSyms)
      .map((s) => `${s.kind} ${s.name}`);
    const more =
      entry.symbols.length > maxSyms ? `, +${entry.symbols.length - maxSyms} more` : '';
    const symText = syms.length > 0 ? `: ${syms.join(', ')}${more}` : '';
    return `${entry.rel_path} (${entry.line_count}L)${symText}`;
  });

  if (omittedCount > 0) {
    lines.push(`... (+${omittedCount} more files; pass path or higher limit)`);
  }

  return {
    files_count: selected.length,
    omitted_count: omittedCount,
    content: lines.join('\n'),
  };
}
