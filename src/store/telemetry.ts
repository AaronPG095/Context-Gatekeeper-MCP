import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { getCacheDir, openDatabase } from './db.js';

export type ToolName =
  | 'run_compact'
  | 'fetch_chunk'
  | 'repo_map'
  | 'symbol_outline'
  | 'read_symbol'
  | 'find_references';

export interface RecordToolEventInput {
  tool: ToolName;
  target: string;
  baselineChars: number;
  returnedChars: number;
  durationMs: number;
  createdAt?: number;
}

export interface StatsOptions {
  sinceMs?: number;
}

export interface ToolStatsRow {
  tool: string;
  calls: number;
  baselineChars: number;
  returnedChars: number;
  baselineTokens: number;
  returnedTokens: number;
  savedTokens: number;
  savedPct: number;
  avgDurationMs: number;
}

export interface RuleStatsRow {
  rule: string;
  calls: number;
  baselineTokens: number;
  returnedTokens: number;
  savedTokens: number;
  savedPct: number;
}

export interface HeavyCallRow {
  repo: string;
  tool: string;
  target: string;
  baselineTokens: number;
  returnedTokens: number;
  durationMs: number;
  createdAt: number;
}

export interface RepoStatsSummary {
  dbPath: string;
  rootDir: string;
  calls: number;
  baselineChars: number;
  returnedChars: number;
  baselineTokens: number;
  returnedTokens: number;
  savedTokens: number;
  savedPct: number;
  genericCalls: number;
  byTool: ToolStatsRow[];
  byRule: RuleStatsRow[];
  topHeavyCalls: HeavyCallRow[];
}

export interface AggregateStatsSummary {
  repos: RepoStatsSummary[];
  calls: number;
  baselineChars: number;
  returnedChars: number;
  baselineTokens: number;
  returnedTokens: number;
  savedTokens: number;
  savedPct: number;
  genericCalls: number;
  byTool: ToolStatsRow[];
  byRule: RuleStatsRow[];
  topHeavyCalls: HeavyCallRow[];
}

function estimateTokens(chars: number): number {
  return Math.round(chars / 4);
}

function calcSavedPct(baselineTokens: number, savedTokens: number): number {
  if (baselineTokens <= 0) return 0;
  return Math.round((savedTokens / baselineTokens) * 1000) / 10;
}

/**
 * Stores and queries local per-repository tool-call telemetry (`meta` and `tool_events`).
 */
export class TelemetryStore {
  constructor(private readonly db: DatabaseSync) {}

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  recordEvent(input: RecordToolEventInput): void {
    const returnedChars = Math.max(0, Math.round(input.returnedChars));
    const baselineChars = Math.max(returnedChars, Math.round(input.baselineChars));
    const durationMs = Math.max(0, Math.round(input.durationMs));
    const createdAt = input.createdAt ?? Date.now();

    this.db
      .prepare(
        `INSERT INTO tool_events(tool, target, baseline_chars, returned_chars, duration_ms, created_at)
         VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(input.tool, input.target, baselineChars, returnedChars, durationMs, createdAt);
  }

  getSummary(dbPath: string, options: StatsOptions = {}): RepoStatsSummary {
    const sinceMs = options.sinceMs ?? 0;
    const rootDir = this.getMeta('root_dir') ?? dbPath;

    const toolRows = this.db
      .prepare(
        `SELECT
           tool,
           COUNT(*) AS calls,
           COALESCE(SUM(baseline_chars), 0) AS baseline_chars,
           COALESCE(SUM(returned_chars), 0) AS returned_chars,
           COALESCE(AVG(duration_ms), 0) AS avg_duration_ms
         FROM tool_events
         WHERE created_at >= ?
         GROUP BY tool
         ORDER BY calls DESC, tool ASC`,
      )
      .all(sinceMs) as Array<{
      tool: string;
      calls: number;
      baseline_chars: number;
      returned_chars: number;
      avg_duration_ms: number;
    }>;

    const byTool: ToolStatsRow[] = toolRows.map((row) => {
      const baselineTokens = estimateTokens(row.baseline_chars);
      const returnedTokens = estimateTokens(row.returned_chars);
      const savedTokens = Math.max(0, baselineTokens - returnedTokens);
      return {
        tool: row.tool,
        calls: row.calls,
        baselineChars: row.baseline_chars,
        returnedChars: row.returned_chars,
        baselineTokens,
        returnedTokens,
        savedTokens,
        savedPct: calcSavedPct(baselineTokens, savedTokens),
        avgDurationMs: Math.round(row.avg_duration_ms),
      };
    });

    const ruleRows = this.db
      .prepare(
        `SELECT
           target AS rule,
           COUNT(*) AS calls,
           COALESCE(SUM(baseline_chars), 0) AS baseline_chars,
           COALESCE(SUM(returned_chars), 0) AS returned_chars
         FROM tool_events
         WHERE tool = 'run_compact' AND created_at >= ?
         GROUP BY target
         ORDER BY calls DESC, target ASC`,
      )
      .all(sinceMs) as Array<{
      rule: string;
      calls: number;
      baseline_chars: number;
      returned_chars: number;
    }>;

    const byRule: RuleStatsRow[] = ruleRows.map((row) => {
      const baselineTokens = estimateTokens(row.baseline_chars);
      const returnedTokens = estimateTokens(row.returned_chars);
      const savedTokens = Math.max(0, baselineTokens - returnedTokens);
      return {
        rule: row.rule,
        calls: row.calls,
        baselineTokens,
        returnedTokens,
        savedTokens,
        savedPct: calcSavedPct(baselineTokens, savedTokens),
      };
    });

    const heavyRows = this.db
      .prepare(
        `SELECT tool, target, baseline_chars, returned_chars, duration_ms, created_at
         FROM tool_events
         WHERE created_at >= ?
         ORDER BY returned_chars DESC, created_at DESC
         LIMIT 5`,
      )
      .all(sinceMs) as Array<{
      tool: string;
      target: string;
      baseline_chars: number;
      returned_chars: number;
      duration_ms: number;
      created_at: number;
    }>;

    const repoLabel = rootDir === dbPath ? basename(dbPath) : basename(rootDir) || rootDir;
    const topHeavyCalls: HeavyCallRow[] = heavyRows.map((row) => ({
      repo: repoLabel,
      tool: row.tool,
      target: row.target,
      baselineTokens: estimateTokens(row.baseline_chars),
      returnedTokens: estimateTokens(row.returned_chars),
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    }));

    const calls = byTool.reduce((sum, r) => sum + r.calls, 0);
    const baselineChars = byTool.reduce((sum, r) => sum + r.baselineChars, 0);
    const returnedChars = byTool.reduce((sum, r) => sum + r.returnedChars, 0);
    const baselineTokens = estimateTokens(baselineChars);
    const returnedTokens = estimateTokens(returnedChars);
    const savedTokens = Math.max(0, baselineTokens - returnedTokens);
    const genericCalls = byRule.find((r) => r.rule === 'generic')?.calls ?? 0;

    return {
      dbPath,
      rootDir,
      calls,
      baselineChars,
      returnedChars,
      baselineTokens,
      returnedTokens,
      savedTokens,
      savedPct: calcSavedPct(baselineTokens, savedTokens),
      genericCalls,
      byTool,
      byRule,
      topHeavyCalls,
    };
  }
}

/**
 * Lists all `.db` files inside the Context Gatekeeper cache directory.
 */
export function listCacheDbPaths(cacheDir: string = getCacheDir()): string[] {
  if (!existsSync(cacheDir)) return [];
  return readdirSync(cacheDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.db'))
    .map((entry) => join(cacheDir, entry.name))
    .sort();
}

/**
 * Aggregates local telemetry summaries across one or more SQLite cache databases.
 */
export function aggregateStats(
  dbPaths: string[],
  options: StatsOptions = {},
): AggregateStatsSummary {
  const repos: RepoStatsSummary[] = [];

  for (const dbPath of dbPaths) {
    if (!existsSync(dbPath)) continue;
    const db = openDatabase(dbPath);
    try {
      const store = new TelemetryStore(db);
      repos.push(store.getSummary(dbPath, options));
    } finally {
      db.close();
    }
  }

  repos.sort((a, b) => b.calls - a.calls || a.rootDir.localeCompare(b.rootDir));

  const toolMap = new Map<
    string,
    { calls: number; baselineChars: number; returnedChars: number; weightedDuration: number }
  >();
  const ruleMap = new Map<
    string,
    { calls: number; baselineTokens: number; returnedTokens: number }
  >();
  const allHeavy: HeavyCallRow[] = [];

  for (const repo of repos) {
    for (const row of repo.byTool) {
      const prev = toolMap.get(row.tool) ?? {
        calls: 0,
        baselineChars: 0,
        returnedChars: 0,
        weightedDuration: 0,
      };
      prev.calls += row.calls;
      prev.baselineChars += row.baselineChars;
      prev.returnedChars += row.returnedChars;
      prev.weightedDuration += row.avgDurationMs * row.calls;
      toolMap.set(row.tool, prev);
    }
    for (const row of repo.byRule) {
      const prev = ruleMap.get(row.rule) ?? {
        calls: 0,
        baselineTokens: 0,
        returnedTokens: 0,
      };
      prev.calls += row.calls;
      prev.baselineTokens += row.baselineTokens;
      prev.returnedTokens += row.returnedTokens;
      ruleMap.set(row.rule, prev);
    }
    allHeavy.push(...repo.topHeavyCalls);
  }

  const byTool: ToolStatsRow[] = [...toolMap.entries()]
    .map(([tool, agg]) => {
      const baselineTokens = estimateTokens(agg.baselineChars);
      const returnedTokens = estimateTokens(agg.returnedChars);
      const savedTokens = Math.max(0, baselineTokens - returnedTokens);
      return {
        tool,
        calls: agg.calls,
        baselineChars: agg.baselineChars,
        returnedChars: agg.returnedChars,
        baselineTokens,
        returnedTokens,
        savedTokens,
        savedPct: calcSavedPct(baselineTokens, savedTokens),
        avgDurationMs: agg.calls > 0 ? Math.round(agg.weightedDuration / agg.calls) : 0,
      };
    })
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));

  const byRule: RuleStatsRow[] = [...ruleMap.entries()]
    .map(([rule, agg]) => {
      const savedTokens = Math.max(0, agg.baselineTokens - agg.returnedTokens);
      return {
        rule,
        calls: agg.calls,
        baselineTokens: agg.baselineTokens,
        returnedTokens: agg.returnedTokens,
        savedTokens,
        savedPct: calcSavedPct(agg.baselineTokens, savedTokens),
      };
    })
    .sort((a, b) => b.calls - a.calls || a.rule.localeCompare(b.rule));

  allHeavy.sort((a, b) => b.returnedTokens - a.returnedTokens || b.createdAt - a.createdAt);

  const calls = repos.reduce((sum, r) => sum + r.calls, 0);
  const baselineChars = repos.reduce((sum, r) => sum + r.baselineChars, 0);
  const returnedChars = repos.reduce((sum, r) => sum + r.returnedChars, 0);
  const baselineTokens = estimateTokens(baselineChars);
  const returnedTokens = estimateTokens(returnedChars);
  const savedTokens = Math.max(0, baselineTokens - returnedTokens);
  const genericCalls = repos.reduce((sum, r) => sum + r.genericCalls, 0);

  return {
    repos,
    calls,
    baselineChars,
    returnedChars,
    baselineTokens,
    returnedTokens,
    savedTokens,
    savedPct: calcSavedPct(baselineTokens, savedTokens),
    genericCalls,
    byTool,
    byRule,
    topHeavyCalls: allHeavy.slice(0, 8),
  };
}

/**
 * Formats an aggregated telemetry summary into a concise plain-text CLI report.
 */
export function formatStatsReport(summary: AggregateStatsSummary): string {
  if (summary.calls === 0) {
    return 'Context Gatekeeper Stats: 0 recorded tool calls yet.';
  }

  const lines: string[] = [
    `Context Gatekeeper Stats (${summary.repos.length} repo${summary.repos.length === 1 ? '' : 's'}, ${summary.calls} calls)`,
    `Overall: ~${summary.baselineTokens.toLocaleString('en-US')} -> ~${summary.returnedTokens.toLocaleString('en-US')} est. tokens (saved ~${summary.savedTokens.toLocaleString('en-US')}, ${summary.savedPct}%)`,
  ];

  if (summary.repos.length > 0) {
    lines.push('', 'Repos:');
    for (const repo of summary.repos) {
      const label = basename(repo.rootDir) || repo.rootDir;
      lines.push(
        `  - ${label}: ${repo.calls} calls | saved ~${repo.savedTokens.toLocaleString('en-US')} (${repo.savedPct}%) | generic=${repo.genericCalls}`,
      );
    }
  }

  if (summary.byTool.length > 0) {
    lines.push('', 'By Tool:');
    for (const row of summary.byTool) {
      lines.push(
        `  - ${row.tool}: ${row.calls} calls | ~${row.baselineTokens} -> ~${row.returnedTokens} tok (saved ${row.savedPct}%) | avg ${row.avgDurationMs}ms`,
      );
    }
  }

  if (summary.byRule.length > 0) {
    lines.push('', 'run_compact Rules:');
    for (const row of summary.byRule) {
      const note = row.rule === 'generic' ? ' [fallback candidate]' : '';
      lines.push(
        `  - ${row.rule}: ${row.calls} calls | ~${row.baselineTokens} -> ~${row.returnedTokens} tok (saved ${row.savedPct}%)${note}`,
      );
    }
  }

  if (summary.topHeavyCalls.length > 0) {
    lines.push('', 'Top Heavy Calls (returned tokens):');
    for (const call of summary.topHeavyCalls) {
      lines.push(
        `  - [${call.repo}] ${call.tool} (${call.target}): ~${call.returnedTokens} tok (baseline ~${call.baselineTokens}, ${call.durationMs}ms)`,
      );
    }
  }

  return lines.join('\n');
}
