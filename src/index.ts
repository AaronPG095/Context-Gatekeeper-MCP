export {
  openDatabase,
  getDefaultDbPath,
  DEFAULT_DB_REL_PATH,
} from './store/db.js';
export {
  ArtifactStore,
  buildSafeFtsQuery,
  type ArtifactLineRow,
  type ArtifactRecord,
  type OutputLine,
  type OutputStream,
  type SaveArtifactInput,
  type SearchLinesOptions,
} from './store/artifacts.js';
export {
  SymbolStore,
  normalizeRelPath,
  type FileRecord,
  type RepoMapFileEntry,
  type SymbolInput,
  type SymbolRecord,
  type SymbolRefInput,
  type SymbolRefRecord,
  type SymbolSearchHit,
  type UpsertFileIndexInput,
} from './store/symbols.js';
export {
  runCommand,
  stripAnsi,
  type RunCommandOptions,
  type RunCommandResult,
} from './compress/runner.js';
export {
  compressOutput,
  selectRule,
  type CompressedOutput,
  type CompressorRuleName,
} from './compress/registry.js';
export {
  runCompact,
  type RunCompactInput,
  type RunCompactResult,
} from './tools/run-compact.js';
export {
  fetchChunk,
  parseLineRange,
  type FetchChunkInput,
  type FetchChunkResult,
} from './tools/fetch-chunk.js';
export {
  detectLanguage,
  getParserForLang,
  initTreeSitter,
  type SupportedLang,
} from './ast/parser.js';
export {
  extractFileAst,
  type ExtractedFileAst,
} from './ast/extract.js';
export {
  indexWorkspace,
  type IndexStats,
} from './ast/indexer.js';
export {
  repoMap,
  type RepoMapInput,
  type RepoMapResult,
} from './tools/repo-map.js';
export {
  symbolOutline,
  type SymbolOutlineInput,
  type SymbolOutlineResult,
} from './tools/symbol-outline.js';
export {
  readSymbol,
  readSymbols,
  type ReadSymbolInput,
  type ReadSymbolResult,
  type ReadSymbolsInput,
  type ReadSymbolsResult,
} from './tools/read-symbol.js';
export {
  findReferences,
  type FindReferencesInput,
  type FindReferencesResult,
} from './tools/find-references.js';
export {
  createGatekeeperServer,
  type GatekeeperServerInstance,
  type GatekeeperServerOptions,
} from './server.js';
