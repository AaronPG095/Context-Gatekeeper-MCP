import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normalizeRelPath,
  type SymbolSearchHit,
  type SymbolStore,
} from '../store/symbols.js';

export interface ReadSymbolInput {
  rootDir: string;
  file: string;
  symbol: string;
  includeDeps?: boolean;
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
  includeDeps?: boolean;
}

export interface ReadSymbolsResult {
  file: string;
  items: ReadSymbolResult[];
  dependencies: SymbolSearchHit[];
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
    includeDeps: input.includeDeps,
  });
  return batch.items[0];
}

/**
 * Reads exact source bodies for one or more symbols in `file` with a single
 * disk read, optionally appending 1-hop callee/type signatures.
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

  const sections = items.map(
    (item) => `## ${item.symbol} (L${item.start_line}-L${item.end_line})\n${item.content}`,
  );

  let dependencies: SymbolSearchHit[] = [];
  if (input.includeDeps) {
    const selfNames = new Set(found.flatMap((s) => [s.name, s.qualified_name]));
    const depMap = new Map<string, SymbolSearchHit>();
    for (const sym of found) {
      const hits = store.getOneHopDependencies(file, sym.start_line, sym.end_line);
      for (const hit of hits) {
        if (hit.rel_path === file && selfNames.has(hit.qualified_name)) continue;
        const key = `${hit.rel_path}:${hit.qualified_name}`;
        if (!depMap.has(key)) depMap.set(key, hit);
      }
    }
    dependencies = [...depMap.values()];
    if (dependencies.length > 0) {
      const depLines = dependencies.map(
        (d) => `  ${d.rel_path}:L${d.start_line} [${d.kind}] ${d.signature}`,
      );
      sections.push(`## Dependencies (1-hop)\n${depLines.join('\n')}`);
    }
  }

  return { file, items, dependencies, content: sections.join('\n---\n') };
}
