import type { SymbolStore } from '../store/symbols.js';

export interface FindReferencesInput {
  symbol: string;
  limit?: number;
}

export interface FindReferencesResult {
  symbol: string;
  count: number;
  content: string;
}

/**
 * Finds indexed call sites and type references for `symbol` across the repo.
 */
export function findReferences(
  store: SymbolStore,
  input: FindReferencesInput,
): FindReferencesResult {
  const symbol = input.symbol.trim();
  const refs = store.findReferences(symbol, input.limit ?? 100);
  if (refs.length === 0) {
    return {
      symbol,
      count: 0,
      content: `(no references found for "${symbol}")`,
    };
  }

  const lines = refs.map((r) => `${r.rel_path}:L${r.line_no} | ${r.snippet}`);
  return {
    symbol,
    count: refs.length,
    content: lines.join('\n'),
  };
}
