import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { normalizeRelPath, type SymbolStore } from '../store/symbols.js';
import { extractFileAst, extractMarkdown } from './extract.js';
import { detectLanguage, getParserForLang, type SupportedLang } from './parser.js';
import type Parser from 'web-tree-sitter';

export interface IndexStats {
  indexed: number;
  skipped: number;
  pruned: number;
  totalFiles: number;
}

const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'bin',
  'obj',
  '.context-gatekeeper',
  '.worktrees',
  'coverage',
]);

interface GitignoreRule {
  dirOnly: boolean;
  regex: RegExp;
}

function compileGitignore(rootDir: string): GitignoreRule[] {
  const giPath = join(rootDir, '.gitignore');
  if (!existsSync(giPath)) return [];
  const raw = readFileSync(giPath, 'utf8');
  const rules: GitignoreRule[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    const dirOnly = trimmed.endsWith('/');
    let pat = dirOnly ? trimmed.slice(0, -1) : trimmed;
    const anchored = pat.startsWith('/');
    if (anchored) pat = pat.slice(1);

    const escaped = pat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');

    const regex = anchored
      ? new RegExp(`^${escaped}(?:/.*)?$`)
      : new RegExp(`(?:^|/)${escaped}(?:/.*)?$`);

    rules.push({ dirOnly, regex });
  }
  return rules;
}

function isIgnored(relPath: string, isDir: boolean, rules: GitignoreRule[]): boolean {
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.regex.test(relPath)) return true;
  }
  return false;
}

/**
 * Incrementally indexes all supported source files under `rootDir` into `store`,
 * skipping unchanged files by `mtime_ms` / `sha256` and pruning deleted files.
 */
export async function indexWorkspace(
  store: SymbolStore,
  rootDir: string,
): Promise<IndexStats> {
  const ignoreRules = compileGitignore(rootDir);
  const seenPaths = new Set<string>();
  const parsers = new Map<SupportedLang, Parser>();
  let indexed = 0;
  let skipped = 0;

  const getCachedParser = async (lang: SupportedLang): Promise<Parser> => {
    let p = parsers.get(lang);
    if (!p) {
      p = await getParserForLang(lang);
      parsers.set(lang, p);
    }
    return p;
  };

  const walk = async (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dir, entry.name);
      const relPath = normalizeRelPath(relative(rootDir, fullPath));

      if (entry.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
        if (isIgnored(relPath, true, ignoreRules)) continue;
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (isIgnored(relPath, false, ignoreRules)) continue;

      const lang = detectLanguage(entry.name);
      if (!lang) continue;

      seenPaths.add(relPath);
      const stat = statSync(fullPath);
      const mtimeMs = Math.trunc(stat.mtimeMs);
      const existing = store.getFileMeta(relPath);

      if (existing && existing.mtime_ms === mtimeMs) {
        skipped += 1;
        continue;
      }

      const source = readFileSync(fullPath, 'utf8');
      const sha256 = createHash('sha256').update(source).digest('hex');

      if (existing && existing.sha256 === sha256) {
        store.touchFileMtime(relPath, mtimeMs);
        skipped += 1;
        continue;
      }

      const extracted =
        lang === 'markdown'
          ? extractMarkdown(source)
          : extractFileAst(lang, source, await getCachedParser(lang));

      store.upsertFileIndex({
        relPath,
        lang,
        sha256,
        mtimeMs,
        lineCount: extracted.lineCount,
        symbols: extracted.symbols,
        refs: extracted.refs,
      });
      indexed += 1;
    }
  };

  try {
    await walk(rootDir);
    const pruned = store.pruneDeletedFiles(seenPaths);

    return {
      indexed,
      skipped,
      pruned,
      totalFiles: seenPaths.size,
    };
  } finally {
    for (const p of parsers.values()) {
      p.delete();
    }
  }
}
