import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexWorkspace } from '../src/ast/indexer.js';
import { openDatabase } from '../src/store/db.js';
import { SymbolStore } from '../src/store/symbols.js';
import { findReferences } from '../src/tools/find-references.js';
import { readSymbol } from '../src/tools/read-symbol.js';
import { repoMap } from '../src/tools/repo-map.js';
import { symbolOutline } from '../src/tools/symbol-outline.js';

describe('Navigation tools (repoMap, symbolOutline, readSymbol, findReferences)', () => {
  const tempDirs: string[] = [];
  const dbs: Array<ReturnType<typeof openDatabase>> = [];

  afterEach(() => {
    while (dbs.length > 0) dbs.pop()?.close();
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('supports repoMap, symbolOutline, readSymbol, and findReferences across TS and C#', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cgk-nav-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'src', 'nested'), { recursive: true });

    writeFileSync(
      join(dir, 'src', 'token.ts'),
      [
        'export interface TokenStats {',
        '  raw: number;',
        '}',
        '',
        'export class TokenCounter {',
        '  count(text: string): number {',
        '    return text.length;',
        '  }',
        '}',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'src', 'nested', 'caller.ts'),
      [
        'import { TokenCounter } from "../token.js";',
        'export function runCount(input: string): number {',
        '  const counter = new TokenCounter();',
        '  return counter.count(input);',
        '}',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'src', 'Gatekeeper.cs'),
      [
        'namespace Gatekeeper;',
        'public class IndexService {',
        '  public int ComputeHash(string body) {',
        '    return body.Length;',
        '  }',
        '}',
      ].join('\n'),
    );

    const db = openDatabase(':memory:');
    dbs.push(db);
    const store = new SymbolStore(db);
    await indexWorkspace(store, dir);

    const topMap = repoMap(store, { path: 'src', depth: 0 });
    expect(topMap.files_count).toBe(2);
    expect(topMap.content).toContain('src/token.ts');
    expect(topMap.content).toContain('src/Gatekeeper.cs');
    expect(topMap.content).not.toContain('src/nested/caller.ts');

    const outline = symbolOutline(store, { file: 'src/token.ts' });
    expect(outline.symbol_count).toBe(3);
    expect(outline.content).toContain('L5-L9 [exported class] TokenCounter');
    expect(outline.content).toContain('L6-L8 [method] TokenCounter.count');
    expect(outline.content).not.toContain('return text.length;');

    const methodBody = readSymbol(store, {
      rootDir: dir,
      file: 'src/token.ts',
      symbol: 'TokenCounter.count',
    });
    expect(methodBody.start_line).toBe(6);
    expect(methodBody.end_line).toBe(8);
    expect(methodBody.content).toContain('return text.length;');

    const csMethod = readSymbol(store, {
      rootDir: dir,
      file: 'src/Gatekeeper.cs',
      symbol: 'IndexService.ComputeHash',
    });
    expect(csMethod.content).toContain('return body.Length;');

    const refs = findReferences(store, { symbol: 'TokenCounter' });
    expect(refs.count).toBeGreaterThanOrEqual(1);
    expect(refs.content).toContain('src/nested/caller.ts:L3');
  });
});
