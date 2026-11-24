import { compressOutput, type CompressorRuleName } from '../compress/registry.js';
import { runCommand } from '../compress/runner.js';
import type { ArtifactStore } from '../store/artifacts.js';

export interface RunCompactInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
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
}

/**
 * Executes a shell command, indexes raw ANSI-stripped output in SQLite FTS5,
 * and returns a compact structured summary plus `artifact_id` handle.
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
  const record = store.saveArtifact({
    command: result.command,
    cwd: result.cwd,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    lines: result.lines,
    summaryText: compressed.summary,
  });

  const summaryLines = compressed.summary ? compressed.summary.split('\n').length : 0;

  return {
    artifact_id: record.id,
    command: record.command,
    exit_code: record.exit_code,
    duration_ms: record.duration_ms,
    raw_lines: record.raw_lines,
    summary_lines: summaryLines,
    rule: compressed.rule,
    summary: compressed.summary,
  };
}
