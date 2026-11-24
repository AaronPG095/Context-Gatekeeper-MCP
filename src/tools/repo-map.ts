import { normalizeRelPath, type SymbolStore } from '../store/symbols.js';

export interface RepoMapInput {
  path?: string;
  depth?: number;
  maxSymbolsPerFile?: number;
}

export interface RepoMapResult {
  files_count: number;
  content: string;
}

/**
 * Returns a compact structural overview of indexed files and top-level
 * exported symbols (with line counts), optionally filtered by `path` and `depth`.
 */
export function repoMap(
  store: SymbolStore,
  input: RepoMapInput = {},
): RepoMapResult {
  const prefix = input.path ? normalizeRelPath(input.path) : '';
  const maxDepth = input.depth;
  const maxSyms = input.maxSymbolsPerFile ?? 8;

  const entries = store.getRepoMapEntries(prefix || undefined).filter((entry) => {
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

  if (entries.length === 0) {
    return { files_count: 0, content: '(no indexed files match)' };
  }

  const lines = entries.map((entry) => {
    const syms = entry.symbols
      .slice(0, maxSyms)
      .map((s) => `${s.kind} ${s.name}`);
    const more =
      entry.symbols.length > maxSyms ? `, +${entry.symbols.length - maxSyms} more` : '';
    const symText = syms.length > 0 ? `: ${syms.join(', ')}${more}` : '';
    return `${entry.rel_path} (${entry.line_count}L)${symText}`;
  });

  return {
    files_count: entries.length,
    content: lines.join('\n'),
  };
}
