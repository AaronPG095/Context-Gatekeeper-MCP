import type { OutputLine } from '../../store/artifacts.js';

const FAILED_LINE_RE = /^FAILED\s+(.+)$/;
const ERROR_LINE_RE = /^E\s+(.+)$/;
const SUMMARY_RE = /^=+\s+(?:\d+\s+(?:failed|passed|skipped|error)[^=]*)=+$/i;

/**
 * Compresses `pytest` output by stripping passing test dots/lines and
 * retaining 100% of `FAILED` test names, `E ` assertion lines with `L<n>`
 * pointers, and the final summary bar.
 */
export function compressPytest(lines: OutputLine[], exitCode: number): string {
  const failures: string[] = [];
  const summary: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const text = lines[i].text.trim();
    if (!text) continue;

    const failMatch = text.match(FAILED_LINE_RE);
    if (failMatch) {
      failures.push(`L${lineNo}: ${failMatch[1]}`);
      continue;
    }

    const errMatch = text.match(ERROR_LINE_RE);
    if (errMatch && failures.length < 40) {
      failures.push(`L${lineNo}:   E ${errMatch[1].slice(0, 140)}`);
      continue;
    }

    if (SUMMARY_RE.test(text)) {
      summary.push(text);
    }
  }

  const out: string[] = [`[pytest] exit=${exitCode} raw_lines=${lines.length}`];
  if (failures.length > 0) {
    out.push(`Failures:`);
    for (const f of failures) out.push(`  ${f}`);
  }
  if (summary.length > 0) {
    out.push(...summary.slice(-2));
  } else if (failures.length === 0) {
    out.push(exitCode === 0 ? 'All pytest checks passed.' : 'pytest failed (see fetch_chunk).');
  }
  return out.join('\n');
}
