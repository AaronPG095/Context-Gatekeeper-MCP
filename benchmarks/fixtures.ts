import type { OutputLine } from '../src/store/artifacts.js';

export interface BenchmarkFixture {
  name: string;
  command: string;
  exitCode: number;
  lines: OutputLine[];
  requiredSubstrings: string[];
}

function toLines(raw: string): OutputLine[] {
  return raw.split('\n').map((text) => ({ stream: 'stdout', text }));
}

export function createDotnetBuildFixture(): BenchmarkFixture {
  const rows: string[] = [
    'MSBuild version 17.11.9+a69bbaaf5 for .NET',
    '  Determining projects to restore...',
  ];
  for (let i = 1; i <= 40; i += 1) {
    rows.push(`  Restored C:\\repo\\src\\Module${i}\\Module${i}.csproj (in ${15 + i} ms).`);
  }
  for (let i = 1; i <= 120; i += 1) {
    rows.push(`  Module${i} -> C:\\repo\\src\\Module${i}\\bin\\Debug\\net10.0\\Module${i}.dll`);
    if (i % 6 === 0) {
      rows.push(
        `C:\\repo\\src\\Module${i}\\Service.cs(${i},12): warning CS0168: The variable 'unused' is declared but never used [C:\\repo\\src\\Module${i}\\Module${i}.csproj]`,
      );
    }
  }
  rows.push(
    `C:\\repo\\src\\Gatekeeper\\Indexer.cs(42,19): error CS1002: ; expected [C:\\repo\\src\\Gatekeeper\\Gatekeeper.csproj]`,
    `C:\\repo\\src\\Gatekeeper\\Parser.cs(88,25): error CS0246: The type or namespace name 'TreeNode' could not be found [C:\\repo\\src\\Gatekeeper\\Gatekeeper.csproj]`,
    '',
    'Build FAILED.',
    '',
    `C:\\repo\\src\\Gatekeeper\\Indexer.cs(42,19): error CS1002: ; expected [C:\\repo\\src\\Gatekeeper\\Gatekeeper.csproj]`,
    `C:\\repo\\src\\Gatekeeper\\Parser.cs(88,25): error CS0246: The type or namespace name 'TreeNode' could not be found [C:\\repo\\src\\Gatekeeper\\Gatekeeper.csproj]`,
    '    20 Warning(s)',
    '    2 Error(s)',
    'Time Elapsed 00:00:08.42',
  );

  return {
    name: 'dotnet build (verbose + 2 errors + 20 warnings)',
    command: 'dotnet build ContextGatekeeper.sln',
    exitCode: 1,
    lines: toLines(rows.join('\n')),
    requiredSubstrings: ['CS1002', 'CS0246', 'CS0168', 'Build FAILED'],
  };
}

export function createVitestFixture(): BenchmarkFixture {
  const rows: string[] = [
    '',
    ' RUN  v3.1.4 C:/repo/Context-Gatekeeper-MCP',
    '',
  ];
  for (let f = 1; f <= 8; f += 1) {
    for (let t = 1; t <= 22; t += 1) {
      rows.push(` ✓ test/suite-${f}.test.ts > handles scenario #${t} (${t + 1}ms)`);
    }
  }
  rows.push(
    ' × test/auth.test.ts > rejects expired JWT token 14ms',
    '   → expected 401 to be 200',
    ' × test/store.test.ts > evicts oldest artifacts past limit 9ms',
    '   → expected 201 to be 200',
    '',
    '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯',
    '',
    ' FAIL  test/auth.test.ts > rejects expired JWT token',
    'AssertionError: expected 401 to be 200',
    ' ❯ test/auth.test.ts:44:21',
    '    at processTicksAndRejections (node:internal/process/task_queues:105:5)',
    '    at async runTest (node_modules/@vitest/runner/dist/index.js:901:11)',
    '',
    ' FAIL  test/store.test.ts > evicts oldest artifacts past limit',
    'AssertionError: expected 201 to be 200',
    ' ❯ test/store.test.ts:71:18',
    '    at processTicksAndRejections (node:internal/process/task_queues:105:5)',
    '',
    ' Test Files  2 failed | 8 passed (10)',
    '      Tests  2 failed | 176 passed (178)',
    '   Duration  1.92s',
  );

  return {
    name: 'vitest run (176 passing + 2 failing)',
    command: 'npx vitest run',
    exitCode: 1,
    lines: toLines(rows.join('\n')),
    requiredSubstrings: [
      'rejects expired JWT token',
      'evicts oldest artifacts past limit',
      'Test Files  2 failed | 8 passed (10)',
    ],
  };
}

export function createGitDiffFixture(): BenchmarkFixture {
  const rows: string[] = [
    'diff --git a/package-lock.json b/package-lock.json',
    'index 1111111..2222222 100644',
    '--- a/package-lock.json',
    '+++ b/package-lock.json',
    '@@ -100,4 +100,180 @@',
  ];
  for (let i = 1; i <= 180; i += 1) {
    rows.push(`+    "node_modules/pkg-${i}": { "version": "1.0.${i}", "integrity": "sha512-abcdef${i}" },`);
  }
  rows.push(
    'diff --git a/src/tools/run-compact.ts b/src/tools/run-compact.ts',
    'index 3333333..4444444 100644',
    '--- a/src/tools/run-compact.ts',
    '+++ b/src/tools/run-compact.ts',
    '@@ -12,3 +12,5 @@ export async function runCompact(',
    '+  const timeoutMs = input.timeoutMs ?? 120_000;',
    '-  const timeoutMs = 60_000;',
  );

  return {
    name: 'git diff (lockfile noise + source hunk)',
    command: 'git diff',
    exitCode: 0,
    lines: toLines(rows.join('\n')),
    requiredSubstrings: ['package-lock.json', 'lockfile collapsed', 'src/tools/run-compact.ts'],
  };
}

export function getAllBenchmarkFixtures(): BenchmarkFixture[] {
  return [
    createDotnetBuildFixture(),
    createVitestFixture(),
    createGitDiffFixture(),
  ];
}
