import { describe, expect, it } from 'vitest';
import {
  createDotnetBuildFixture,
  createGitDiffFixture,
  createVitestFixture,
} from '../benchmarks/fixtures.js';
import { compressOutput } from '../src/compress/registry.js';
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
});
