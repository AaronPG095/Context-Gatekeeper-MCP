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

export interface ReadSymbolsInput {
  rootDir: string;
  file: string;
  symbols: string[];
}

export interface ReadSymbolsResult {
  file: string;
  items: ReadSymbolResult[];
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
  const batch = readSymbols(store, {
    rootDir: input.rootDir,
    file: input.file,
    symbols: [input.symbol],
  });
  return batch.items[0];
}

/**
 * Reads exact source bodies for one or more symbols in `file` with a single
 * disk read.
 */
export function readSymbols(
  store: SymbolStore,
  input: ReadSymbolsInput,
): ReadSymbolsResult {
  const file = normalizeRelPath(input.file);
  if (input.symbols.length === 0) {
    throw new Error('At least one symbol name must be provided.');
  }

  const found = input.symbols.map((name) => {
    const sym = store.findSymbolInFile(file, name);
    if (!sym) {
      throw new Error(`Symbol "${name}" not found in "${file}"`);
    }
    return sym;
  });

  const fullPath = resolve(input.rootDir, file);
  const rawLines = readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n').split('\n');

  const items: ReadSymbolResult[] = found.map((sym) => {
    const slice = rawLines.slice(sym.start_line - 1, sym.end_line);
    const numbered = slice.map((text, idx) => `L${sym.start_line + idx}: ${text}`);
    return {
      file,
      symbol: sym.qualified_name,
      start_line: sym.start_line,
      end_line: sym.end_line,
      content: numbered.join('\n'),
    };
  });

  const content = items
    .map((item) => `## ${item.symbol} (L${item.start_line}-L${item.end_line})\n${item.content}`)
    .join('\n---\n');

  return { file, items, content };
}
