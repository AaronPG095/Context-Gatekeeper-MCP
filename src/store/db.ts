import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_DB_REL_PATH = join('.context-gatekeeper', 'index.db');

/**
 * Computes a deterministic OS user-cache SQLite path for `rootDir` so target
 * repositories never get untracked `.context-gatekeeper/` files.
 */
export function getDefaultDbPath(rootDir: string = process.cwd()): string {
  const normRoot = resolve(rootDir);
  const key = process.platform === 'win32' ? normRoot.toLowerCase() : normRoot;
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
  const cacheBase =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
      : process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(cacheBase, 'context-gatekeeper', `${hash}.db`);
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  cwd TEXT NOT NULL,
  exit_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  raw_bytes INTEGER NOT NULL,
  raw_lines INTEGER NOT NULL,
  summary_bytes INTEGER NOT NULL,
  summary_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts(created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_cmd_cwd ON artifacts(command, cwd, created_at DESC);

CREATE TABLE IF NOT EXISTS artifact_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  stream TEXT NOT NULL,
  text TEXT NOT NULL,
  UNIQUE(artifact_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_artifact_lines_art_line ON artifact_lines(artifact_id, line_no);

CREATE VIRTUAL TABLE IF NOT EXISTS artifact_lines_fts USING fts5(
  text,
  artifact_id UNINDEXED,
  line_no UNINDEXED,
  content='artifact_lines',
  content_rowid='id',
  tokenize='unicode61 tokenchars ''_.-/'''
);

CREATE TRIGGER IF NOT EXISTS artifact_lines_ai AFTER INSERT ON artifact_lines BEGIN
  INSERT INTO artifact_lines_fts(rowid, text, artifact_id, line_no)
  VALUES (new.id, new.text, new.artifact_id, new.line_no);
END;

CREATE TRIGGER IF NOT EXISTS artifact_lines_ad AFTER DELETE ON artifact_lines BEGIN
  INSERT INTO artifact_lines_fts(artifact_lines_fts, rowid, text, artifact_id, line_no)
  VALUES ('delete', old.id, old.text, old.artifact_id, old.line_no);
END;

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_path TEXT UNIQUE NOT NULL,
  lang TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  signature TEXT NOT NULL,
  is_exported INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  parent_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_symbols_file_line ON symbols(file_id, start_line);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);

CREATE TABLE IF NOT EXISTS symbol_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  symbol_name TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  col_no INTEGER NOT NULL,
  snippet TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_symbol_refs_name ON symbol_refs(symbol_name);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  name,
  qualified_name,
  signature,
  content='symbols',
  content_rowid='id',
  tokenize='unicode61 tokenchars ''_.-/'''
);

CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
  INSERT INTO symbols_fts(rowid, name, qualified_name, signature)
  VALUES (new.id, new.name, new.qualified_name, new.signature);
END;

CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, qualified_name, signature)
  VALUES ('delete', old.id, old.name, old.qualified_name, old.signature);
END;
`;

/**
 * Opens (and initializes if needed) the Context Gatekeeper SQLite database
 * using Node's built-in `node:sqlite` (`DatabaseSync`) with FTS5 enabled.
 */
export function openDatabase(dbPath: string = getDefaultDbPath()): DatabaseSync {
  const isMemory = dbPath === ':memory:' || dbPath.startsWith('file::memory:');
  if (!isMemory) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  if (!isMemory) {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA_SQL);
  const artifactCols = db.prepare('PRAGMA table_info(artifacts)').all() as Array<{
    name: string;
  }>;
  if (!artifactCols.some((c) => c.name === 'summary_text')) {
    db.exec("ALTER TABLE artifacts ADD COLUMN summary_text TEXT NOT NULL DEFAULT '';");
  }
  const symCount = (db.prepare('SELECT COUNT(*) AS cnt FROM symbols').get() as { cnt: number }).cnt;
  if (symCount > 0) {
    const ftsCount = (db.prepare('SELECT COUNT(*) AS cnt FROM symbols_fts').get() as { cnt: number })
      .cnt;
    if (ftsCount === 0) {
      db.exec(
        "INSERT INTO symbols_fts(rowid, name, qualified_name, signature) SELECT id, name, qualified_name, signature FROM symbols;",
      );
    }
  }
  return db;
}
