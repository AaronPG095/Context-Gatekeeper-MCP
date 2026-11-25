import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { afterEach, describe, expect, it } from 'vitest';

const CLI_PATH = resolve(process.cwd(), 'dist', 'src', 'cli.js');

describe('MCP stdio server & CLI proxy E2E', () => {
  const tempDirs: string[] = [];
  const transports: StdioClientTransport[] = [];

  afterEach(async () => {
    while (transports.length > 0) {
      await transports.pop()!.close().catch(() => {});
    }
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('exposes 6 low-schema-token tools and executes compression + AST tools over stdio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cgk-mcp-e2e-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'greeter.ts'),
      [
        'export class Greeter {',
        '  greet(name: string): string {',
        '    return `Hello, ${name}!`;',
        '  }',
        '}',
        'export function runGreet(): string {',
        '  return new Greeter().greet("world");',
        '}',
      ].join('\n'),
    );

    const dbPath = join(dir, '.context-gatekeeper', 'index.db');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--no-warnings', CLI_PATH, '--root', dir, '--db', dbPath],
      env: process.env as Record<string, string>,
      stderr: 'pipe',
    });
    transports.push(transport);

    let stderrText = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString('utf8');
    });

    const client = new Client({ name: 'cgk-test-client', version: '0.1.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'fetch_chunk',
      'find_references',
      'read_symbol',
      'repo_map',
      'run_compact',
      'symbol_outline',
    ]);

    const schemaTokens = encode(JSON.stringify(tools)).length;
    expect(schemaTokens).toBeLessThan(900);

    // 1. run_compact -> fetch_chunk
    writeFileSync(
      join(dir, 'emit.mjs'),
      "for (let i = 1; i <= 12; i++) console.log(i === 7 ? 'ERR_MCP: boom' : 'ok ' + i);\n",
    );
    const runRes = await client.callTool({
      name: 'run_compact',
      arguments: {
        command: 'node emit.mjs',
      },
    });
    const runText = (runRes.content as Array<{ text: string }>)[0].text;
    const match = runText.match(/artifact_id=(art_[0-9a-f]{8})/);
    expect(match).not.toBeNull();

    const fetchRes = await client.callTool({
      name: 'fetch_chunk',
      arguments: {
        artifact_id: match![1],
        query: 'ERR_MCP',
        context_lines: 1,
      },
    });
    const fetchText = (fetchRes.content as Array<{ text: string }>)[0].text;
    expect(fetchText).toContain('*L7: ERR_MCP: boom');

    // 2. repo_map -> symbol_outline -> read_symbol -> find_references (auto-indexed)
    const mapRes = await client.callTool({ name: 'repo_map', arguments: {} });
    const mapText = (mapRes.content as Array<{ text: string }>)[0].text;
    expect(mapText).toContain('src/greeter.ts');

    const outlineRes = await client.callTool({
      name: 'symbol_outline',
      arguments: { file: 'src/greeter.ts' },
    });
    const outlineText = (outlineRes.content as Array<{ text: string }>)[0].text;
    expect(outlineText).toContain('Greeter.greet');

    const readRes = await client.callTool({
      name: 'read_symbol',
      arguments: { file: 'src/greeter.ts', symbol: 'Greeter.greet' },
    });
    const readText = (readRes.content as Array<{ text: string }>)[0].text;
    expect(readText).toContain('return `Hello, ${name}!`;');

    const refsRes = await client.callTool({
      name: 'find_references',
      arguments: { symbol: 'Greeter' },
    });
    const refsText = (refsRes.content as Array<{ text: string }>)[0].text;
    expect(refsText).toContain('src/greeter.ts:L7');

    // ExperimentalWarning should be suppressed cleanly.
    expect(stderrText).not.toContain('ExperimentalWarning');
  }, 15_000);

  it('supports CLI proxy run and fetch subcommands', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cgk-cli-proxy-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'cli.db');
    const runOut = execFileSync(
      process.execPath,
      [CLI_PATH, '--root', dir, '--db', dbPath, 'run', 'node -e "console.log(\'hello cli\')"'],
      { encoding: 'utf8' },
    );
    const idMatch = runOut.match(/artifact_id=(art_[0-9a-f]{8})/);
    expect(idMatch).not.toBeNull();
    expect(runOut).toContain('hello cli');

    const fetchOut = execFileSync(
      process.execPath,
      [CLI_PATH, '--root', dir, '--db', dbPath, 'fetch', idMatch![1], '--range', '1..1'],
      { encoding: 'utf8' },
    );
    expect(fetchOut).toContain('L1: hello cli');
  });

  it('navigates a second repo via optional root parameter without polluting it', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'cgk-repo-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'cgk-repo-b-'));
    tempDirs.push(dirA, dirB);

    mkdirSync(join(dirB, 'src'), { recursive: true });
    writeFileSync(
      join(dirB, 'src', 'calc.ts'),
      [
        'export function addNums(a: number, b: number): number {',
        '  return a + b;',
        '}',
        'export function useAdd(): number {',
        '  return addNums(2, 3);',
        '}',
      ].join('\n'),
    );

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI_PATH, '--root', dirA],
      env: process.env as Record<string, string>,
      stderr: 'pipe',
    });
    transports.push(transport);

    const client = new Client({ name: 'cgk-multi-repo-test', version: '0.1.0' });
    await client.connect(transport);

    const mapB = await client.callTool({ name: 'repo_map', arguments: { root: dirB } });
    expect((mapB.content as Array<{ text: string }>)[0].text).toContain('src/calc.ts');

    const outlineB = await client.callTool({
      name: 'symbol_outline',
      arguments: { file: 'src/calc.ts', root: dirB },
    });
    expect((outlineB.content as Array<{ text: string }>)[0].text).toContain('addNums');

    const readB = await client.callTool({
      name: 'read_symbol',
      arguments: { file: 'src/calc.ts', symbol: 'addNums', root: dirB },
    });
    expect((readB.content as Array<{ text: string }>)[0].text).toContain('return a + b;');

    const refsB = await client.callTool({
      name: 'find_references',
      arguments: { symbol: 'addNums', root: dirB },
    });
    expect((refsB.content as Array<{ text: string }>)[0].text).toContain('src/calc.ts:L5');

    // Neither repo gets a .context-gatekeeper folder (OS cache dir is used).
    expect(existsSync(join(dirA, '.context-gatekeeper'))).toBe(false);
    expect(existsSync(join(dirB, '.context-gatekeeper'))).toBe(false);
  }, 15_000);
});
