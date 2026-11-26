import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { afterEach, describe, expect, it } from 'vitest';
import { createGatekeeperServer } from '../src/server.js';
import { openDatabase } from '../src/store/db.js';
import {
  TelemetryStore,
  aggregateStats,
  formatStatsReport,
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
});
