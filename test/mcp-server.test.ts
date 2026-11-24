import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
      args: [CLI_PATH, '--root', dir, '--db', dbPath],
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

  it('supports CLI proxy run subcommand', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cgk-cli-proxy-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'cli.db');
    const out = execFileSync(
      process.execPath,
      [CLI_PATH, '--root', dir, '--db', dbPath, 'run', 'node -e "console.log(\'hello cli\')"'],
      { encoding: 'utf8' },
    );
    expect(out).toMatch(/artifact_id=art_[0-9a-f]{8}/);
    expect(out).toContain('hello cli');
  });
});
