import type { OutputLine } from '../../store/artifacts.js';

const LOCKFILE_RE = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock)$/i;
const MAX_INLINE_HUNK_LINES = 30;

/**
 * Compresses `git diff`, `git status`, and `git log` outputs.
 * For `git diff`, reports per-file `+add/-del` stats, collapses lockfiles and
 * oversized hunks (>30 changed lines) to `L<start>-L<end>` pointers, and keeps
 * small source hunks inline.
 */
export function compressGit(
  command: string,
  lines: OutputLine[],
  exitCode: number,
): string {
  const lower = command.toLowerCase();
  if (/\bgit\s+status\b/.test(lower)) {
    return compressGitStatus(lines, exitCode);
  }
  if (/\bgit\s+log\b/.test(lower)) {
    return compressGitLog(lines, exitCode);
  }
  return compressGitDiff(lines, exitCode);
}

interface DiffFileBlock {
  file: string;
  startLine: number;
  endLine: number;
  added: number;
  deleted: number;
  isLockfile: boolean;
  bodyLines: string[];
}

function compressGitDiff(lines: OutputLine[], exitCode: number): string {
  const files: DiffFileBlock[] = [];
  let current: DiffFileBlock | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const text = lines[i].text;
    const headerMatch = text.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (headerMatch) {
      if (current) {
        current.endLine = lineNo - 1;
        files.push(current);
      }
      const file = headerMatch[2];
      current = {
        file,
        startLine: lineNo,
        endLine: lineNo,
        added: 0,
        deleted: 0,
        isLockfile: LOCKFILE_RE.test(file),
        bodyLines: [],
      };
      continue;
    }

    if (!current) continue;
    if (text.startsWith('+') && !text.startsWith('+++')) {
      current.added += 1;
      current.bodyLines.push(`L${lineNo}: ${text}`);
    } else if (text.startsWith('-') && !text.startsWith('---')) {
      current.deleted += 1;
      current.bodyLines.push(`L${lineNo}: ${text}`);
    } else if (text.startsWith('@@')) {
      current.bodyLines.push(`L${lineNo}: ${text}`);
    }
  }
  if (current) {
    current.endLine = lines.length;
    files.push(current);
  }

  if (files.length === 0) {
    return `[git diff] exit=${exitCode} raw_lines=${lines.length}\nNo diff hunks.`;
  }

  const out: string[] = [
    `[git diff] exit=${exitCode} files=${files.length} raw_lines=${lines.length}`,
  ];

  for (const f of files) {
    const stats = `+${f.added}/-${f.deleted} (L${f.startLine}-L${f.endLine})`;
    if (f.isLockfile) {
      out.push(`  ${f.file} ${stats} [lockfile collapsed]`);
    } else if (f.bodyLines.length > MAX_INLINE_HUNK_LINES) {
      out.push(`  ${f.file} ${stats} [large diff collapsed; use fetch_chunk]`);
    } else {
      out.push(`  ${f.file} ${stats}`);
      for (const b of f.bodyLines) {
        out.push(`    ${b}`);
      }
    }
  }

  return out.join('\n');
}

function compressGitStatus(lines: OutputLine[], exitCode: number): string {
  const nonEmpty = lines.map((l) => l.text).filter((t) => t.trim().length > 0);
  const head = nonEmpty.slice(0, 40);
  const extra = nonEmpty.length - head.length;
  const out = [`[git status] exit=${exitCode} lines=${lines.length}`, ...head];
  if (extra > 0) out.push(`... (${extra} more lines; use fetch_chunk)`);
  return out.join('\n');
}

function compressGitLog(lines: OutputLine[], exitCode: number): string {
  const nonEmpty = lines.map((l) => l.text.trim()).filter(Boolean);
  const head = nonEmpty.slice(0, 25);
  const extra = nonEmpty.length - head.length;
  const out = [`[git log] exit=${exitCode} lines=${lines.length}`, ...head];
  if (extra > 0) out.push(`... (${extra} more lines; use fetch_chunk)`);
  return out.join('\n');
}
