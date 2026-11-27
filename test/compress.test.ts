import { describe, expect, it } from 'vitest';
import {
  createDotnetBuildFixture,
  createGitDiffFixture,
  createVitestFixture,
} from '../benchmarks/fixtures.js';
import { compressOutput, selectRule } from '../src/compress/registry.js';
import { stripAnsi } from '../src/compress/runner.js';

describe('stripAnsi', () => {
  it('strips ANSI CSI/SGR codes and resolves carriage-return progress', () => {
    const raw = '\u001b[31mError\u001b[0m\r\n10%\r50%\r100% Done';
    expect(stripAnsi(raw)).toBe('Error\n100% Done');
  });
});

describe('compressOutput', () => {
  it('compresses dotnet build while preserving errors and deduping warnings', () => {
    const fixture = createDotnetBuildFixture();
    const res = compressOutput(fixture.command, fixture.lines, fixture.exitCode);
    expect(res.rule).toBe('dotnet');
    expect(res.summary).toContain('CS1002');
    expect(res.summary).toContain('CS0246');
    expect(res.summary).toContain('CS0168 x20');
    expect(res.summary).toContain('Build FAILED.');
    expect(res.summary).not.toContain('Restored C:\\repo\\src\\Module1\\');
  });

  it('compresses vitest output while keeping failing test names and totals', () => {
    const fixture = createVitestFixture();
    const res = compressOutput(fixture.command, fixture.lines, fixture.exitCode);
    expect(res.rule).toBe('vitest');
    expect(res.summary).toContain('rejects expired JWT token');
    expect(res.summary).toContain('evicts oldest artifacts past limit');
    expect(res.summary).toContain('Test Files  2 failed | 8 passed (10)');
    expect(res.summary).not.toContain('handles scenario #1');
  });

  it('compresses git diff by collapsing lockfiles and keeping small source hunks', () => {
    const fixture = createGitDiffFixture();
    const res = compressOutput(fixture.command, fixture.lines, fixture.exitCode);
    expect(res.rule).toBe('git');
    expect(res.summary).toContain('package-lock.json +180/-0');
    expect(res.summary).toContain('[lockfile collapsed]');
    expect(res.summary).toContain('src/tools/run-compact.ts +1/-1');
    expect(res.summary).toContain('const timeoutMs = input.timeoutMs ?? 120_000;');
  });

  it('falls back to generic compressor and deduplicates repeated lines', () => {
    const lines = [
      { stream: 'stdout' as const, text: 'heartbeat ok' },
      { stream: 'stdout' as const, text: 'heartbeat ok' },
      { stream: 'stdout' as const, text: 'heartbeat ok' },
      { stream: 'stderr' as const, text: 'Fetching https://example.com/pkg failed: 404' },
      { stream: 'stderr' as const, text: 'fatal: connection refused' },
    ];
    const res = compressOutput('custom-cli --watch', lines, 1);
    expect(res.rule).toBe('generic');
    expect(res.summary).toContain('heartbeat ok (x3)');
    expect(res.summary).toContain('Fetching https://example.com/pkg failed: 404');
    expect(res.summary).toContain('fatal: connection refused');
  });

  it('compresses tsc, eslint, pytest, and folds large JSON arrays', () => {
    const tscRes = compressOutput(
      'npx tsc --noEmit',
      [
        { stream: 'stdout', text: 'src/a.ts(10,3): error TS2345: Bad arg' },
        { stream: 'stdout', text: 'src/b.ts(20,5): error TS2345: Bad arg 2' },
        { stream: 'stdout', text: 'Found 2 errors in 2 files.' },
      ],
      2,
    );
    expect(tscRes.rule).toBe('tsc');
    expect(tscRes.summary).toContain('TS2345 x2');
    expect(tscRes.summary).toContain('Found 2 errors');

    const lintRes = compressOutput(
      'npx eslint src',
      [
        { stream: 'stdout', text: 'C:\\repo\\src\\a.ts' },
        { stream: 'stdout', text: '  4:9  error  Unexpected any  @typescript-eslint/no-explicit-any' },
        { stream: 'stdout', text: '  8:1  warning  Unused var  no-unused-vars' },
        { stream: 'stdout', text: '  9:1  warning  Unused var  no-unused-vars' },
        { stream: 'stdout', text: '✖ 3 problems (1 error, 2 warnings)' },
      ],
      1,
    );
    expect(lintRes.rule).toBe('eslint');
    expect(lintRes.summary).toContain('@typescript-eslint/no-explicit-any');
    expect(lintRes.summary).toContain('no-unused-vars x2');

    const pytestRes = compressOutput(
      'pytest -q',
      [
        { stream: 'stdout', text: '....' },
        { stream: 'stdout', text: 'FAILED tests/test_auth.py::test_expired - AssertionError' },
        { stream: 'stdout', text: 'E   assert 401 == 200' },
        { stream: 'stdout', text: '=== 1 failed, 12 passed in 0.41s ===' },
      ],
      1,
    );
    expect(pytestRes.rule).toBe('pytest');
    expect(pytestRes.summary).toContain('test_expired');
    expect(pytestRes.summary).toContain('1 failed, 12 passed');

    const jsonItems = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const jsonRes = compressOutput(
      'gh api /repos/a/b/issues',
      [{ stream: 'stdout', text: JSON.stringify(jsonItems, null, 2) }],
      0,
    );
    expect(jsonRes.rule).toBe('generic');
    expect(jsonRes.summary).toContain('Folded JSON array: 10 items, keys=[id, name]');
  });

  it('avoids wrapper bloat on short clean generic outputs', () => {
    const shortLines = [
      { stream: 'stdout' as const, text: 'Created plan: docs/plans/Foo.plan.md' },
      { stream: 'stdout' as const, text: 'Ticket set to Doing: local://FOO:1' },
    ];
    const res = compressOutput('adw new "Foo"', shortLines, 0);
    expect(res.rule).toBe('generic');
    expect(res.summary).toBe(
      'Created plan: docs/plans/Foo.plan.md\nTicket set to Doing: local://FOO:1',
    );
    expect(res.summary).not.toContain('[generic]');
    expect(res.summary).not.toContain('L1:');
  });

  it('prevents quoted args and mixed shell chains from misclassifying rules', () => {
    expect(
      selectRule(
        'adw tick plan.md "AC1" --verify-cmd "npm test"; if ($LASTEXITCODE -eq 0) { adw pack plan.md --test }',
      ),
    ).toBe('generic');
    expect(
      selectRule(
        'npm run typecheck; if ($LASTEXITCODE -eq 0) { adw tick plan.md "AC1"; git commit -m "feat: x"; git push }',
      ),
    ).toBe('generic');
    expect(selectRule('Set-Location "C:\\repo"; npm test')).toBe('vitest');
    expect(selectRule('tsc -p tsconfig.a.json && tsc -p tsconfig.b.json')).toBe('tsc');
  });

  it('caps total inline diff lines across multi-file git diffs', () => {
    const lines: Array<{ stream: 'stdout'; text: string }> = [];
    for (let f = 1; f <= 6; f += 1) {
      lines.push({ stream: 'stdout', text: `diff --git a/src/f${f}.ts b/src/f${f}.ts` });
      lines.push({ stream: 'stdout', text: '@@ -1,20 +1,20 @@' });
      for (let k = 1; k <= 20; k += 1) {
        lines.push({ stream: 'stdout', text: `+export const v${f}_${k} = ${k};` });
      }
    }
    const res = compressOutput('git diff main...HEAD', lines, 0);
    expect(res.rule).toBe('git');
    expect(res.summary).toContain('src/f1.ts +20/-0');
    expect(res.summary).toContain('+export const v1_1 = 1;');
    expect(res.summary).toContain('src/f6.ts +20/-0');
    expect(res.summary).toContain('[large diff collapsed; use fetch_chunk]');
  });
});
