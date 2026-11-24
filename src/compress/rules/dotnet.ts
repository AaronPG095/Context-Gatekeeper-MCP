import type { OutputLine } from '../../store/artifacts.js';

const MSBUILD_ERROR_RE = /\berror\s+([A-Z]{1,6}\d{3,5})\s*:\s*(.+)$/i;
const MSBUILD_WARN_RE = /\bwarning\s+([A-Z]{1,6}\d{3,5})\s*:\s*(.+)$/i;
const TEST_FAIL_RE = /^\s*(?:Failed|X|×)\s+([^\s\[].+)$/;
const TEST_SUMMARY_RE = /^\s*(?:Failed!|Passed!|Total tests:|Build FAILED\.|Build succeeded\.)/i;
const COUNTS_RE = /^\s*(?:\d+\s+(?:Warning|Error)\(s\)|Time Elapsed\s+)/i;

/**
 * Compresses `dotnet build` and `dotnet test` output by stripping restore/MSBuild
 * boilerplate and passing tests while retaining 100% of error diagnostics,
 * deduplicated warnings, failing test names, and `L<n>` pointers.
 */
export function compressDotnet(lines: OutputLine[], exitCode: number): string {
  const errors: string[] = [];
  const warnings = new Map<string, { count: number; firstLine: number; sample: string }>();
  const failedTests: string[] = [];
  const summaryLines: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const text = lines[i].text.trim();
    if (!text) continue;

    const errMatch = text.match(MSBUILD_ERROR_RE);
    if (errMatch) {
      errors.push(`L${lineNo}: ${text}`);
      continue;
    }

    const warnMatch = text.match(MSBUILD_WARN_RE);
    if (warnMatch) {
      const code = warnMatch[1].toUpperCase();
      const existing = warnings.get(code);
      if (existing) {
        existing.count += 1;
      } else {
        warnings.set(code, { count: 1, firstLine: lineNo, sample: text });
      }
      continue;
    }

    const failTest = text.match(TEST_FAIL_RE);
    if (failTest && !text.startsWith('Failed!')) {
      const next = lines[i + 1]?.text.trim();
      const reason =
        next && !next.startsWith('Stack Trace:') ? ` — ${next.slice(0, 140)}` : '';
      failedTests.push(`L${lineNo}: ${failTest[1]}${reason}`);
      continue;
    }

    if (TEST_SUMMARY_RE.test(text) || COUNTS_RE.test(text)) {
      summaryLines.push(text);
    }
  }

  const out: string[] = [`[dotnet] exit=${exitCode} raw_lines=${lines.length}`];

  if (errors.length > 0) {
    out.push(`Errors (${errors.length}):`);
    for (const err of errors) out.push(`  ${err}`);
  }

  if (failedTests.length > 0) {
    out.push(`Failed tests (${failedTests.length}):`);
    for (const ft of failedTests) out.push(`  ${ft}`);
  }

  if (warnings.size > 0) {
    const warnEntries = [...warnings.entries()].map(
      ([code, info]) => `${code} x${info.count} (first L${info.firstLine})`,
    );
    out.push(`Warnings: ${warnEntries.join(', ')}`);
  }

  if (summaryLines.length > 0) {
    out.push('Summary:');
    for (const s of summaryLines.slice(-6)) out.push(`  ${s}`);
  } else if (errors.length === 0 && failedTests.length === 0) {
    out.push(exitCode === 0 ? 'Build/test succeeded (no errors).' : 'Failed (see fetch_chunk).');
  }

  return out.join('\n');
}
