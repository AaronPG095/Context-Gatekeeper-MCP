import type { OutputLine } from '../../store/artifacts.js';

const TSC_ERR_RE = /^(.+?\(\d+,\d+\)):\s+error\s+(TS\d+):\s+(.+)$/;
const TSC_TOTAL_RE = /^Found\s+\d+\s+errors?\b/i;

/**
 * Compresses TypeScript compiler (`tsc`) output by retaining 100% of `TSxxxx`
 * error lines with `L<n>` pointers and summarizing code counts.
 */
export function compressTsc(lines: OutputLine[], exitCode: number): string {
  const errors: string[] = [];
  const counts = new Map<string, number>();
  let totalLine: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const text = lines[i].text.trim();
    if (!text) continue;

    const match = text.match(TSC_ERR_RE);
    if (match) {
      const code = match[2];
      counts.set(code, (counts.get(code) ?? 0) + 1);
      errors.push(`L${lineNo}: ${match[1]} ${code}: ${match[3]}`);
      continue;
    }

    if (TSC_TOTAL_RE.test(text)) {
      totalLine = text;
    }
  }

  const out: string[] = [`[tsc] exit=${exitCode} raw_lines=${lines.length}`];
  if (errors.length > 0) {
    const codeSummary = [...counts.entries()]
      .map(([c, n]) => `${c} x${n}`)
      .join(', ');
    out.push(`Errors (${errors.length}: ${codeSummary}):`);
    for (const e of errors) out.push(`  ${e}`);
  }
  if (totalLine) {
    out.push(totalLine);
  } else if (errors.length === 0) {
    out.push(exitCode === 0 ? 'Typecheck succeeded (0 errors).' : 'Failed (see fetch_chunk).');
  }
  return out.join('\n');
}
