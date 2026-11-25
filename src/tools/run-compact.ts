import { compressOutput, type CompressorRuleName } from '../compress/registry.js';
import { runCommand } from '../compress/runner.js';
import type { ArtifactRecord, ArtifactStore } from '../store/artifacts.js';

export interface RunCompactInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  delta?: boolean;
}

export interface RunCompactResult {
  artifact_id: string;
  command: string;
  exit_code: number;
  duration_ms: number;
  raw_lines: number;
  summary_lines: number;
  rule: CompressorRuleName;
  summary: string;
  prev_artifact_id?: string;
  is_delta?: boolean;
}

const stripLinePrefix = (line: string): string =>
  line.trim().replace(/^L\d+:\s*/, '');

function computeDeltaSummary(
  prev: ArtifactRecord,
  currentSummary: string,
  exitCode: number,
  rawLines: number,
): string | null {
  if (!prev.summary_text) return null;

  const prevBody = prev.summary_text.split('\n').slice(1);
  const currBody = currentSummary.split('\n').slice(1);

  const prevNormMap = new Map<string, string>();
  for (const line of prevBody) {
    const t = line.trim();
    if (!t || t.endsWith(':')) continue;
    prevNormMap.set(stripLinePrefix(t), t);
  }

  const currNormMap = new Map<string, string>();
  for (const line of currBody) {
    const t = line.trim();
    if (!t || t.endsWith(':')) continue;
    currNormMap.set(stripLinePrefix(t), t);
  }

  const resolved: string[] = [];
  for (const [norm, orig] of prevNormMap) {
    if (!currNormMap.has(norm)) resolved.push(orig);
  }

  const added: string[] = [];
  for (const [norm, orig] of currNormMap) {
    if (!prevNormMap.has(norm)) added.push(orig);
  }

  if (prev.exit_code === exitCode && resolved.length === 0 && added.length === 0) {
    return `[delta vs ${prev.id}] No change (exit=${exitCode}, raw_lines=${rawLines}).`;
  }

  const out: string[] = [
    `[delta vs ${prev.id}] exit=${exitCode} (was ${prev.exit_code}) raw_lines=${rawLines}`,
  ];
  if (resolved.length > 0) {
    out.push(`Resolved (${resolved.length}):`);
    for (const r of resolved) out.push(`  - ${r}`);
  }
  if (added.length > 0) {
    out.push(`New (${added.length}):`);
    for (const a of added) out.push(`  + ${a}`);
  }
  const unchangedCount = currNormMap.size - added.length;
  if (unchangedCount > 0) {
    out.push(`Unchanged: ${unchangedCount} item(s)`);
  }

  const deltaText = out.join('\n');
  return deltaText.length < currentSummary.length ? deltaText : null;
}

/**
 * Executes a shell command, indexes raw ANSI-stripped output in SQLite FTS5,
 * and returns a compact structured summary (or delta vs. previous run) + `artifact_id`.
 */
export async function runCompact(
  store: ArtifactStore,
  input: RunCompactInput,
): Promise<RunCompactResult> {
  const result = await runCommand(input.command, {
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
  });

  const compressed = compressOutput(input.command, result.lines, result.exitCode);
  const useDelta = input.delta !== false;
  const prev = useDelta
    ? store.getLatestArtifactForCommand(result.command, result.cwd)
    : undefined;

  const record = store.saveArtifact({
    command: result.command,
    cwd: result.cwd,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    lines: result.lines,
    summaryText: compressed.summary,
  });

  const deltaSummary = prev
    ? computeDeltaSummary(prev, compressed.summary, record.exit_code, record.raw_lines)
    : null;
  const finalSummary = deltaSummary ?? compressed.summary;
  const summaryLines = finalSummary ? finalSummary.split('\n').length : 0;

  return {
    artifact_id: record.id,
    command: record.command,
    exit_code: record.exit_code,
    duration_ms: record.duration_ms,
    raw_lines: record.raw_lines,
    summary_lines: summaryLines,
    rule: compressed.rule,
    summary: finalSummary,
    ...(deltaSummary && prev ? { prev_artifact_id: prev.id, is_delta: true } : {}),
  };
}
