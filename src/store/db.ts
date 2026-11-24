import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_DB_REL_PATH = join('.context-gatekeeper', 'index.db');

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
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts(created_at);

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
`;

/**
 * Opens (and initializes if needed) the Context Gatekeeper SQLite database
 * using Node's built-in `node:sqlite` (`DatabaseSync`) with FTS5 enabled.
 */
export function openDatabase(dbPath: string = DEFAULT_DB_REL_PATH): DatabaseSync {
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
  return db;
}
