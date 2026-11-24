import { normalizeRelPath, type SymbolStore } from '../store/symbols.js';

export interface SymbolOutlineInput {
  file: string;
}

export interface SymbolOutlineResult {
  file: string;
  symbol_count: number;
  content: string;
}

/**
 * Returns the symbol outline (classes, interfaces, functions, methods,
 * signatures, and `L<start>-L<end>` ranges without bodies) for an indexed file.
 */
export function symbolOutline(
  store: SymbolStore,
  input: SymbolOutlineInput,
): SymbolOutlineResult {
  const file = normalizeRelPath(input.file);
  const meta = store.getFileMeta(file);
  if (!meta) {
    throw new Error(`File not indexed: ${file}`);
  }

  const symbols = store.getFileSymbols(file);
  if (symbols.length === 0) {
    return {
      file,
      symbol_count: 0,
      content: `${file} (${meta.line_count}L): (no symbols extracted)`,
    };
  }

  const lines = [`${file} (${meta.line_count}L):`];
  for (const sym of symbols) {
    const indent = sym.parent_id ? '  ' : '';
    const exp = sym.is_exported ? 'exported ' : '';
    lines.push(
      `${indent}L${sym.start_line}-L${sym.end_line} [${exp}${sym.kind}] ${sym.qualified_name} — ${sym.signature}`,
    );
  }

  return {
    file,
    symbol_count: symbols.length,
    content: lines.join('\n'),
  };
}
