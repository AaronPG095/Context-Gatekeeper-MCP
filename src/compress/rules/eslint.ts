import type { OutputLine } from '../../store/artifacts.js';

const FILE_HEADER_RE = /^(?:[A-Za-z]:\\|\/|\.\.?\/)[^\s]+$/;
const LINT_DIAG_RE = /^\s*(\d+:\d+)\s+(error|warning)\s+(.+?)\s{2,}([\w\-/@]+)\s*$/;
const SUMMARY_RE = /^\s*[✖×]\s+\d+\s+problems?\b|^\s*Checked\s+\d+\s+files?\b/i;

/**
 * Compresses `eslint` / `biome` output: keeps 100% of error diagnostics with
 * file + `L<n>` pointers and deduplicates warnings by rule ID.
 */
export function compressEslint(lines: OutputLine[], exitCode: number): string {
  const errors: string[] = [];
  const warnings = new Map<string, { count: number; firstLine: number }>();
  const summary: string[] = [];
  let currentFile = '';

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i].text;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (FILE_HEADER_RE.test(trimmed)) {
      currentFile = trimmed;
      continue;
    }

    const diag = raw.match(LINT_DIAG_RE);
    if (diag) {
      const [, loc, level, msg, ruleId] = diag;
      if (level === 'error') {
        const prefix = currentFile ? `${currentFile}:${loc}` : loc;
        errors.push(`L${lineNo}: ${prefix} ${ruleId}: ${msg.trim()}`);
      } else {
        const prev = warnings.get(ruleId);
        if (prev) prev.count += 1;
        else warnings.set(ruleId, { count: 1, firstLine: lineNo });
      }
      continue;
    }

    if (SUMMARY_RE.test(trimmed)) {
      summary.push(trimmed);
    }
  }

  const out: string[] = [`[eslint] exit=${exitCode} raw_lines=${lines.length}`];
  if (errors.length > 0) {
    out.push(`Errors (${errors.length}):`);
    for (const e of errors) out.push(`  ${e}`);
  }
  if (warnings.size > 0) {
    const warnStr = [...warnings.entries()]
      .map(([r, info]) => `${r} x${info.count} (first L${info.firstLine})`)
      .join(', ');
    out.push(`Warnings: ${warnStr}`);
  }
  if (summary.length > 0) {
    out.push(...summary.slice(-3));
  } else if (errors.length === 0 && warnings.size === 0) {
    out.push(exitCode === 0 ? 'Lint passed (0 problems).' : 'Lint failed (see fetch_chunk).');
  }
  return out.join('\n');
}
