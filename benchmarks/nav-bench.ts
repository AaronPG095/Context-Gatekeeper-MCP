import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { indexWorkspace } from '../src/ast/indexer.js';
import { openDatabase } from '../src/store/db.js';
import { SymbolStore } from '../src/store/symbols.js';
import { readSymbol } from '../src/tools/read-symbol.js';
import { repoMap } from '../src/tools/repo-map.js';
import { symbolOutline } from '../src/tools/symbol-outline.js';

export const MIN_NAV_REDUCTION_PCT = 70;

export interface NavBenchResult {
  rawTokens: number;
  navTokens: number;
  reductionPct: number;
  passed: boolean;
}

function buildLongMethods(prefix: string, count: number): string[] {
  const lines: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    lines.push(
      `  processItem${i}(payload: string, flags: Record<string, boolean>): string {`,
      `    const normalized = payload.trim().toLowerCase();`,
      `    if (!normalized) return "${prefix}-empty-${i}";`,
      `    const suffix = flags.strict ? "strict" : "loose";`,
      `    return \`${prefix}-\${i}-\${normalized}-\${suffix}\`;`,
      `  }`,
    );
  }
  return lines;
}

function buildCSharpMethods(prefix: string, count: number): string[] {
  const lines: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    lines.push(
      `  public string EvaluateRule${i}(string input, bool strict) {`,
      `    if (string.IsNullOrWhiteSpace(input)) return "${prefix}_empty_${i}";`,
      `    var mode = strict ? "strict" : "relaxed";`,
      `    return $"{input.Trim()}:{mode}:${i}";`,
      `  }`,
    );
  }
  return lines;
}

/**
 * Benchmarks reading 6 full TS + C# files vs. navigating with
 * `repoMap` -> `symbolOutline` -> `readSymbol` using `o200k_base`.
 */
export async function runNavBenchmark(): Promise<NavBenchResult> {
  const dir = mkdtempSync(join(tmpdir(), 'cgk-nav-bench-'));
  const db = openDatabase(':memory:');
  try {
    mkdirSync(join(dir, 'src', 'services'), { recursive: true });
    mkdirSync(join(dir, 'dotnet'), { recursive: true });

    const files: Record<string, string> = {
      'src/services/auth.ts': [
        'export interface SessionToken { userId: string; expiresAt: number; }',
        'export class AuthService {',
        ...buildLongMethods('auth', 14),
        '  validateSession(token: SessionToken): boolean {',
        '    return token.expiresAt > Date.now();',
        '  }',
        '}',
      ].join('\n'),
      'src/services/billing.ts': [
        'export class BillingService {',
        ...buildLongMethods('bill', 14),
        '}',
      ].join('\n'),
      'src/services/notify.ts': [
        'export class NotifyService {',
        ...buildLongMethods('notify', 14),
        '}',
      ].join('\n'),
      'src/services/storage.ts': [
        'export class StorageService {',
        ...buildLongMethods('store', 14),
        '}',
      ].join('\n'),
      'dotnet/OrderProcessor.cs': [
        'namespace Gatekeeper.Orders;',
        'public class OrderProcessor {',
        ...buildCSharpMethods('order', 14),
        '}',
      ].join('\n'),
      'dotnet/AuditLogger.cs': [
        'namespace Gatekeeper.Audit;',
        'public class AuditLogger {',
        ...buildCSharpMethods('audit', 14),
        '}',
      ].join('\n'),
    };

    for (const [rel, body] of Object.entries(files)) {
      writeFileSync(join(dir, rel), body);
    }

    const store = new SymbolStore(db);
    await indexWorkspace(store, dir);

    const rawAll = Object.keys(files)
      .map((rel) => `// ${rel}\n${readFileSync(join(dir, rel), 'utf8')}`)
      .join('\n\n');

    const mapRes = repoMap(store);
    const outlineRes = symbolOutline(store, { file: 'src/services/auth.ts' });
    const symRes = readSymbol(store, {
      rootDir: dir,
      file: 'src/services/auth.ts',
      symbol: 'AuthService.validateSession',
    });

    const navAll = [mapRes.content, outlineRes.content, symRes.content].join('\n\n');
    const rawTokens = encode(rawAll).length;
    const navTokens = encode(navAll).length;
    const reductionPct = ((rawTokens - navTokens) / rawTokens) * 100;

    return {
      rawTokens,
      navTokens,
      reductionPct,
      passed: reductionPct >= MIN_NAV_REDUCTION_PCT && symRes.content.includes('validateSession'),
    };
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
