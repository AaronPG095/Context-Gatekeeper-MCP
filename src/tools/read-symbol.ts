import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeRelPath, type SymbolStore } from '../store/symbols.js';

export interface ReadSymbolInput {
  rootDir: string;
  file: string;
  symbol: string;
}

export interface ReadSymbolResult {
  file: string;
  symbol: string;
  start_line: number;
  end_line: number;
  content: string;
}

/**
 * Reads the exact source lines for a single symbol (`Name` or `Parent.Name`)
 * from `file` using its indexed line range in `store`.
 */
export function readSymbol(
  store: SymbolStore,
  input: ReadSymbolInput,
): ReadSymbolResult {
  const file = normalizeRelPath(input.file);
  const sym = store.findSymbolInFile(file, input.symbol);
  if (!sym) {
    throw new Error(`Symbol "${input.symbol}" not found in "${file}"`);
  }

  const fullPath = resolve(input.rootDir, file);
  const rawLines = readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const slice = rawLines.slice(sym.start_line - 1, sym.end_line);
  const numbered = slice.map((text, idx) => `L${sym.start_line + idx}: ${text}`);

  return {
    file,
    symbol: sym.qualified_name,
    start_line: sym.start_line,
    end_line: sym.end_line,
    content: numbered.join('\n'),
  };
}
