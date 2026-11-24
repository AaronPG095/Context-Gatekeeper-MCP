import { mkdtempSync, mkdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexWorkspace } from '../src/ast/indexer.js';
import { openDatabase } from '../src/store/db.js';
import { SymbolStore } from '../src/store/symbols.js';

describe('indexWorkspace (web-tree-sitter WASM + incremental SQLite)', () => {
  const tempDirs: string[] = [];
  const dbs: Array<ReturnType<typeof openDatabase>> = [];

  afterEach(() => {
    while (dbs.length > 0) dbs.pop()?.close();
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  function makeWorkspace() {
    const dir = mkdtempSync(join(tmpdir(), 'cgk-ast-'));
    tempDirs.push(dir);
    const db = openDatabase(':memory:');
    dbs.push(db);
    return { dir, store: new SymbolStore(db) };
  }

  it('indexes TS and C# files, respects .gitignore/default ignores, skips unchanged, and prunes deleted', async () => {
    const { dir, store } = makeWorkspace();
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(dir, 'bin', 'Debug'), { recursive: true });
    mkdirSync(join(dir, 'ignored_dir'), { recursive: true });

    writeFileSync(join(dir, '.gitignore'), 'ignored_dir/\n*.generated.ts\n');
    writeFileSync(
      join(dir, 'src', 'auth.ts'),
      [
        'export interface AuthOptions { secret: string; }',
        'export class AuthService {',
        '  verify(token: string): boolean {',
        '    return token.length > 0;',
        '  }',
        '}',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'src', 'Worker.cs'),
      [
        'namespace Gatekeeper;',
        'public class Worker {',
        '  public int RunTask(string name) {',
        '    return name.Length;',
        '  }',
        '}',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'node_modules', 'pkg', 'index.ts'), 'export const x = 1;');
    writeFileSync(join(dir, 'bin', 'Debug', 'App.cs'), 'public class Ignored {}');
    writeFileSync(join(dir, 'ignored_dir', 'skip.ts'), 'export const skip = true;');
    writeFileSync(join(dir, 'src', 'types.generated.ts'), 'export type Gen = string;');

    const first = await indexWorkspace(store, dir);
    expect(first).toEqual({ indexed: 2, skipped: 0, pruned: 0, totalFiles: 2 });
    expect(store.listFilePaths()).toEqual(['src/Worker.cs', 'src/auth.ts']);

    const second = await indexWorkspace(store, dir);
    expect(second).toEqual({ indexed: 0, skipped: 2, pruned: 0, totalFiles: 2 });

    // Touch mtime without changing content -> skipped via sha256 match.
    const future = new Date(Date.now() + 5000);
    utimesSync(join(dir, 'src', 'auth.ts'), future, future);
    const touched = await indexWorkspace(store, dir);
    expect(touched).toEqual({ indexed: 0, skipped: 2, pruned: 0, totalFiles: 2 });

    writeFileSync(
      join(dir, 'src', 'auth.ts'),
      'export function verifyQuick(t: string): boolean { return Boolean(t); }\n',
    );
    const third = await indexWorkspace(store, dir);
    expect(third).toEqual({ indexed: 1, skipped: 1, pruned: 0, totalFiles: 2 });

    unlinkSync(join(dir, 'src', 'Worker.cs'));
    const fourth = await indexWorkspace(store, dir);
    expect(fourth).toEqual({ indexed: 0, skipped: 1, pruned: 1, totalFiles: 1 });
    expect(store.listFilePaths()).toEqual(['src/auth.ts']);
  });
});
