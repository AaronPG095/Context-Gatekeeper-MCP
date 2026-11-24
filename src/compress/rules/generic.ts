import type { OutputLine } from '../../store/artifacts.js';

const ERROR_LINE_RE = /\b(?:error|fatal|exception|failed|panic|traceback|unhandled)\b/i;
const PROGRESS_NOISE_RE = /^(?:\s*(?:\d+%|\[\s*[#=>.\s]+\s*\]|downloading|resolving|fetching)\b.*|[\\|/\-]\s*)$/i;

/**
 * Generic fallback compressor: strips blank runs and progress-bar noise,
 * deduplicates consecutive identical lines, extracts error-like lines with
 * `L<n>` pointers, and keeps a compact head/tail preview.
 */
export function compressGeneric(lines: OutputLine[], exitCode: number): string {
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
