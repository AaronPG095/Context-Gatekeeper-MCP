import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { afterEach, describe, expect, it } from 'vitest';
import { createGatekeeperServer } from '../src/server.js';
import { getCacheDir, getDefaultDbPath, openDatabase } from '../src/store/db.js';
import {
  TelemetryStore,
  aggregateStats,
  formatStatsReport,
  pruneStaleCacheDbs,
} from '../src/store/telemetry.js';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('TelemetryStore and stats aggregation', () => {
  it('records meta root_dir, filters by sinceMs, and computes token savings', () => {
    const dir = makeTempDir('cgk-telemetry-');
    const dbPath = join(dir, 'repo-a.db');
    const db = openDatabase(dbPath);
    try {
      const store = new TelemetryStore(db);
      store.setMeta('root_dir', 'C:\\Repos\\RepoA');
      expect(store.getMeta('root_dir')).toBe('C:\\Repos\\RepoA');

      const now = Date.now();
      store.recordEvent({
        tool: 'run_compact',
        target: 'dotnet',
        baselineChars: 4000,
        returnedChars: 400,
        durationMs: 120,
        createdAt: now - 10 * 86_400_000,
      });
      store.recordEvent({
        tool: 'run_compact',
        target: 'generic',
        baselineChars: 2000,
        returnedChars: 800,
        durationMs: 50,
        createdAt: now - 1_000,
      });

      const allSummary = store.getSummary(dbPath);
      expect(allSummary.calls).toBe(2);
      expect(allSummary.baselineTokens).toBe(1500);
      expect(allSummary.returnedTokens).toBe(300);
      expect(allSummary.savedTokens).toBe(1200);
      expect(allSummary.savedPct).toBe(80);
      expect(allSummary.genericCalls).toBe(1);

      const recentSummary = store.getSummary(dbPath, { sinceMs: now - 86_400_000 });
      expect(recentSummary.calls).toBe(1);
      expect(recentSummary.byRule[0].rule).toBe('generic');
    } finally {
      db.close();
    }
  });

  it('aggregates multiple DBs and formats a readable report', () => {
    const dir = makeTempDir('cgk-agg-');
    const dbA = join(dir, 'a.db');
    const dbB = join(dir, 'b.db');
    const missing = join(dir, 'missing.db');

    const connA = openDatabase(dbA);
    const connB = openDatabase(dbB);
    try {
      const storeA = new TelemetryStore(connA);
      storeA.setMeta('root_dir', 'C:\\Repos\\Alpha');
      storeA.recordEvent({
        tool: 'run_compact',
        target: 'vitest',
        baselineChars: 8000,
        returnedChars: 400,
        durationMs: 200,
      });

      const storeB = new TelemetryStore(connB);
      storeB.setMeta('root_dir', 'C:\\Repos\\Beta');
      storeB.recordEvent({
        tool: 'read_symbol',
        target: 'src/app.ts:main',
        baselineChars: 1600,
        returnedChars: 320,
        durationMs: 15,
      });
      storeB.recordEvent({
        tool: 'run_compact',
        target: 'generic',
        baselineChars: 1200,
        returnedChars: 600,
        durationMs: 40,
      });
    } finally {
      connA.close();
      connB.close();
    }

    const agg = aggregateStats([dbA, dbB, missing]);
    expect(agg.repos).toHaveLength(2);
    expect(agg.calls).toBe(3);
    expect(agg.genericCalls).toBe(1);
    expect(agg.savedTokens).toBeGreaterThan(2000);

    const report = formatStatsReport(agg);
    expect(report).toContain('Alpha');
    expect(report).toContain('Beta');
    expect(report).toContain('[fallback candidate]');
    expect(report).toContain('Top Heavy Calls');
  });

  it('instruments MCP tools without exceeding schema token budget and serves stats CLI', async () => {
    const ws = makeTempDir('cgk-mcp-tel-');
    const dbPath = join(ws, 'tel.db');
    writeFileSync(
      join(ws, 'sample.ts'),
      [
        '// Padding comment to make the full file noticeably larger than one function.',
        'export function helperA(): number {',
        '  return 1;',
        '}',
        '',
        'export function helperB(): number {',
        '  return 2;',
        '}',
      ].join('\n'),
      'utf8',
    );

    const instance = createGatekeeperServer({ rootDir: ws, dbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await instance.server.connect(serverTransport);
    const client = new Client({ name: 'telemetry-test', version: '0.4.0' });
    await client.connect(clientTransport);

    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(6);
      const schemaTokens = encode(JSON.stringify(tools)).length;
      expect(schemaTokens).toBeLessThan(900);

      await client.callTool({ name: 'symbol_outline', arguments: { file: 'sample.ts' } });
      await client.callTool({
        name: 'read_symbol',
        arguments: { file: 'sample.ts', symbol: 'helperA' },
      });

      const summary = instance.telemetryStore.getSummary(dbPath);
      expect(summary.calls).toBe(2);
      expect(summary.byTool.map((t) => t.tool).sort()).toEqual([
        'read_symbol',
        'symbol_outline',
      ]);
      expect(summary.baselineChars).toBeGreaterThanOrEqual(summary.returnedChars);
    } finally {
      await client.close();
      instance.close();
    }

    const cliPath = resolve('dist/src/cli.js');
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliPath, '--db', dbPath, 'stats', '--json'],
      { env: process.env },
    );
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout) as { calls: number; repos: Array<{ rootDir: string }> };
    expect(parsed.calls).toBe(2);
    expect(parsed.repos[0].rootDir).toBe(ws);
  });

  it('honors CGK_CACHE_DIR, hides inactive DBs in report, and prunes stale DBs', () => {
    const cacheDir = makeTempDir('cgk-prune-cache-');
    const realRepo = makeTempDir('cgk-real-repo-');
    const deletedRepo = join(cacheDir, 'does-not-exist-repo');

    const prevEnv = process.env.CGK_CACHE_DIR;
    process.env.CGK_CACHE_DIR = cacheDir;
    try {
      expect(getCacheDir()).toBe(cacheDir);
    } finally {
      if (prevEnv === undefined) delete process.env.CGK_CACHE_DIR;
      else process.env.CGK_CACHE_DIR = prevEnv;
    }

    const activeDb = join(cacheDir, 'active.db');
    const inactiveRealDb = join(cacheDir, 'inactive-real.db');
    const deletedRootDb = join(cacheDir, 'deleted-root.db');
    const orphanEmptyDb = join(cacheDir, 'orphan-empty.db');

    const c1 = openDatabase(activeDb);
    try {
      const s1 = new TelemetryStore(c1);
      s1.setMeta('root_dir', realRepo);
      s1.recordEvent({
        tool: 'run_compact',
        target: 'vitest',
        baselineChars: 2000,
        returnedChars: 200,
        durationMs: 25,
      });
    } finally {
      c1.close();
    }

    const c2 = openDatabase(inactiveRealDb);
    try {
      new TelemetryStore(c2).setMeta('root_dir', realRepo);
    } finally {
      c2.close();
    }

    const c3 = openDatabase(deletedRootDb);
    try {
      const s3 = new TelemetryStore(c3);
      s3.setMeta('root_dir', deletedRepo);
      s3.recordEvent({
        tool: 'repo_map',
        target: '.',
        baselineChars: 100,
        returnedChars: 100,
        durationMs: 5,
      });
    } finally {
      c3.close();
    }

    openDatabase(orphanEmptyDb).close();

    const agg = aggregateStats([activeDb, inactiveRealDb]);
    const report = formatStatsReport(agg);
    expect(report).toContain('1 active repo, 1 inactive DB(s)');
    expect(report).not.toContain('inactive-real.db');

    const pruned = pruneStaleCacheDbs(cacheDir);
    expect(pruned).toEqual({ removed: 2, kept: 2 });
    expect(existsSync(activeDb)).toBe(true);
    expect(existsSync(inactiveRealDb)).toBe(true);
    expect(existsSync(deletedRootDb)).toBe(false);
    expect(existsSync(orphanEmptyDb)).toBe(false);
  });

  it('attributes run_compact and fetch_chunk to getWorkspace(cwd) and skips locked DBs during prune', async () => {
    const cacheDir = makeTempDir('cgk-ws-attr-cache-');
    const defaultRepo = makeTempDir('cgk-default-repo-');
    const otherRepo = makeTempDir('cgk-other-repo-');

    const prevEnv = process.env.CGK_CACHE_DIR;
    process.env.CGK_CACHE_DIR = cacheDir;

    try {
      const instance = createGatekeeperServer({ rootDir: defaultRepo });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await instance.server.connect(serverTransport);
      const client = new Client({ name: 'attr-test', version: '0.5.0' });
      await client.connect(clientTransport);

      try {
        const runRes = await client.callTool({
          name: 'run_compact',
          arguments: {
            command: 'node -e "console.log(\'hello from other repo\')"',
            cwd: otherRepo,
          },
        });
        const text = (runRes.content as Array<{ text: string }>)[0].text;
        const artMatch = text.match(/artifact_id=(art_[0-9a-f]{8})/);
        expect(artMatch).not.toBeNull();

        await client.callTool({
          name: 'fetch_chunk',
          arguments: {
            artifact_id: artMatch![1],
            line_range: '1-5',
          },
        });

        // Create an orphan empty DB and hold an open SQLite handle on Windows to simulate EBUSY.
        const lockedOrphanDb = join(cacheDir, 'locked-orphan.db');
        const heldConn = openDatabase(lockedOrphanDb);
        try {
          const pruneRes = pruneStaleCacheDbs(cacheDir);
          expect(pruneRes.kept).toBeGreaterThanOrEqual(2);
        } finally {
          heldConn.close();
        }
      } finally {
        await client.close();
        instance.close();
      }

      const otherDbPath = getDefaultDbPath(otherRepo);
      const agg = aggregateStats([getDefaultDbPath(defaultRepo), otherDbPath]);
      const otherSummary = agg.repos.find((r) => r.rootDir === otherRepo);
      const defaultSummary = agg.repos.find((r) => r.rootDir === defaultRepo);
      expect(otherSummary?.calls).toBe(2);
      expect(defaultSummary?.calls).toBe(0);
    } finally {
      if (prevEnv === undefined) delete process.env.CGK_CACHE_DIR;
      else process.env.CGK_CACHE_DIR = prevEnv;
    }
  });
});
