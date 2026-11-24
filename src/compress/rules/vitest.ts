import type { OutputLine } from '../../store/artifacts.js';

const FAIL_HEADER_RE = /^\s*FAIL\s+(.+)$/;
const FAIL_CASE_RE = /^\s*[×✗✕]\s+(.+)$/;
const SUMMARY_RE = /^\s*(?:Test Files|Tests|Start at|Duration)\s+/;
const ERROR_DETAIL_RE = /^(?:AssertionError|Error|TypeError|ReferenceError|Expected|Received):/;

/**
 * Compresses `vitest` / `npm test` output by stripping passing test lines (`✓`)
 * and runner banners while retaining 100% of failing file headers, failing test
 * names, concise assertion messages with `L<n>` pointers, and final totals.
 */
export function compressVitest(lines: OutputLine[], exitCode: number): string {
  const failedFiles: string[] = [];
  const failures: string[] = [];
  const summaryLines: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const text = lines[i].text.trim();
    if (!text) continue;

    const failHeader = text.match(FAIL_HEADER_RE);
    if (failHeader) {
      const entry = `L${lineNo}: ${failHeader[1]}`;
      if (!failedFiles.includes(entry)) failedFiles.push(entry);
      continue;
    }

    const failCase = text.match(FAIL_CASE_RE);
    if (failCase) {
      const details: string[] = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j += 1) {
        const next = lines[j].text.trim();
        if (!next || next.startsWith('❯') || next.startsWith('at ')) break;
        if (ERROR_DETAIL_RE.test(next) || details.length > 0) {
          details.push(next.slice(0, 140));
          if (details.length >= 2) break;
        }
      }
      const suffix = details.length > 0 ? ` — ${details.join(' | ')}` : '';
      failures.push(`L${lineNo}: ${failCase[1]}${suffix}`);
      continue;
    }

    if (SUMMARY_RE.test(text)) {
      summaryLines.push(text);
    }
  }

  const out: string[] = [`[vitest] exit=${exitCode} raw_lines=${lines.length}`];

  if (failedFiles.length > 0) {
    out.push(`Failed files (${failedFiles.length}):`);
    for (const ff of failedFiles) out.push(`  ${ff}`);
  }

  if (failures.length > 0) {
    out.push(`Failed tests (${failures.length}):`);
    for (const f of failures) out.push(`  ${f}`);
  }

  if (summaryLines.length > 0) {
    out.push('Summary:');
    for (const s of summaryLines.slice(-4)) out.push(`  ${s}`);
  } else if (failures.length === 0) {
    out.push(exitCode === 0 ? 'All tests passed.' : 'Test run failed (see fetch_chunk).');
  }

  return out.join('\n');
}
