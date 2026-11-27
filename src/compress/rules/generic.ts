import type { OutputLine } from '../../store/artifacts.js';

const ERROR_LINE_RE = /\b(?:error|fatal|exception|failed|panic|traceback|unhandled)\b/i;
const PROGRESS_NOISE_RE = /^(?:\s*(?:\d+%|\[\s*[#=>.\s]+\s*\]|downloading|resolving|fetching)\b.*|[\\|/\-]\s*)$/i;

function tryFoldJsonArray(lines: OutputLine[], exitCode: number): string | null {
  const joined = lines.map((l) => l.text).join('\n').trim();
  if (!joined.startsWith('[') || !joined.endsWith(']')) return null;

  try {
    const parsed = JSON.parse(joined) as unknown;
    if (!Array.isArray(parsed) || parsed.length <= 5) return null;

    const first = parsed[0];
    const keys =
      first && typeof first === 'object' && !Array.isArray(first)
        ? Object.keys(first as Record<string, unknown>).slice(0, 10)
        : [];
    const sample = JSON.stringify(first);
    const trimmedSample = sample.length > 160 ? `${sample.slice(0, 157)}...` : sample;
    return [
      `[generic:json] exit=${exitCode} raw_lines=${lines.length}`,
      `Folded JSON array: ${parsed.length} items${keys.length > 0 ? `, keys=[${keys.join(', ')}]` : ''}`,
      `sample[0]: ${trimmedSample}`,
      '(use fetch_chunk for full items)',
    ].join('\n');
  } catch {
    return null;
  }
}

/**
 * Generic fallback compressor: folds large JSON arrays, strips blank runs and
 * progress-bar noise, deduplicates consecutive identical lines, extracts
 * error-like lines with `L<n>` pointers, and keeps a compact head/tail preview.
 */
export function compressGeneric(lines: OutputLine[], exitCode: number): string {
  const jsonFolded = tryFoldJsonArray(lines, exitCode);
  if (jsonFolded) return jsonFolded;

  const deduped: Array<{ lineNo: number; text: string; count: number }> = [];
  const errorLines: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const text = lines[i].text.trimEnd();
    if (!text.trim()) continue;

    const isError = ERROR_LINE_RE.test(text);
    if (isError && errorLines.length < 25) {
      errorLines.push(`L${lineNo}: ${text.trim()}`);
    }
    if (!isError && PROGRESS_NOISE_RE.test(text)) continue;

    const prev = deduped[deduped.length - 1];
    if (prev && prev.text === text) {
      prev.count += 1;
    } else {
      deduped.push({ lineNo, text, count: 1 });
    }
  }

  const hasDuplicates = deduped.some((e) => e.count > 1);
  const totalChars = deduped.reduce((sum, e) => sum + e.text.length, 0);

  if (
    exitCode === 0 &&
    errorLines.length === 0 &&
    !hasDuplicates &&
    deduped.length <= 25 &&
    totalChars <= 1_500
  ) {
    return deduped.length === 0
      ? '[generic] exit=0 (empty output)'
      : deduped.map((e) => e.text).join('\n');
  }

  const out: string[] = [`[generic] exit=${exitCode} raw_lines=${lines.length}`];

  if (errorLines.length > 0) {
    out.push(`Diagnostics (${errorLines.length}):`);
    for (const e of errorLines) out.push(`  ${e}`);
  }

  const formatEntry = (e: { lineNo: number; text: string; count: number }) =>
    e.count > 1 ? `L${e.lineNo}: ${e.text} (x${e.count})` : `L${e.lineNo}: ${e.text}`;

  if (deduped.length <= 20) {
    for (const entry of deduped) out.push(formatEntry(entry));
  } else {
    out.push('Head:');
    for (const entry of deduped.slice(0, 8)) out.push(`  ${formatEntry(entry)}`);
    out.push(`... (${deduped.length - 16} unique lines omitted; use fetch_chunk) ...`);
    out.push('Tail:');
    for (const entry of deduped.slice(-8)) out.push(`  ${formatEntry(entry)}`);
  }

  return out.join('\n');
}
