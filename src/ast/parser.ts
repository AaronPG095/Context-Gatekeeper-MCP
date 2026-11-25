import { createRequire } from 'node:module';
import { extname } from 'node:path';
import Parser from 'web-tree-sitter';

export type SupportedLang =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'csharp'
  | 'python'
  | 'markdown';

const EXT_TO_LANG: Record<string, SupportedLang> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.cs': 'csharp',
  '.py': 'python',
  '.md': 'markdown',
};

const LANG_TO_WASM: Partial<Record<SupportedLang, string>> = {
  typescript: 'tree-sitter-wasms/out/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-wasms/out/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-wasms/out/tree-sitter-javascript.wasm',
  csharp: 'tree-sitter-wasms/out/tree-sitter-c_sharp.wasm',
  python: 'tree-sitter-wasms/out/tree-sitter-python.wasm',
};

const require = createRequire(import.meta.url);
let initPromise: Promise<void> | null = null;
const languageCache = new Map<SupportedLang, Promise<Parser.Language>>();

/**
 * Maps a file path's extension to a supported Tree-sitter language, or `null`.
 */
export function detectLanguage(filePath: string): SupportedLang | null {
  return EXT_TO_LANG[extname(filePath).toLowerCase()] ?? null;
}

/**
 * Initializes the `web-tree-sitter` WASM runtime once per process.
 */
export function initTreeSitter(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  return initPromise;
}

/**
 * Returns a configured `Parser` instance for `lang`, caching loaded WASM grammars.
 */
export async function getParserForLang(lang: SupportedLang): Promise<Parser> {
  const wasmRel = LANG_TO_WASM[lang];
  if (!wasmRel) {
    throw new Error(`No Tree-sitter WASM grammar configured for "${lang}"`);
  }
  await initTreeSitter();
  let langPromise = languageCache.get(lang);
  if (!langPromise) {
    const wasmPath = require.resolve(wasmRel);
    langPromise = Parser.Language.load(wasmPath);
    languageCache.set(lang, langPromise);
  }
  const grammar = await langPromise;
  const parser = new Parser();
  parser.setLanguage(grammar);
  return parser;
}
