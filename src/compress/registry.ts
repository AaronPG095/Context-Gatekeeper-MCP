import type { OutputLine } from '../store/artifacts.js';
import { compressDotnet } from './rules/dotnet.js';
import { compressEslint } from './rules/eslint.js';
import { compressGeneric } from './rules/generic.js';
import { compressGit } from './rules/git.js';
import { compressPytest } from './rules/pytest.js';
import { compressTsc } from './rules/tsc.js';
import { compressVitest } from './rules/vitest.js';

export type CompressorRuleName =
  | 'dotnet'
  | 'vitest'
  | 'git'
  | 'tsc'
  | 'eslint'
  | 'pytest'
  | 'generic';

export interface CompressedOutput {
  rule: CompressorRuleName;
  summary: string;
}

const SHELL_GLUE_RE =
  /^(?:cd|set-location|push-location|pop-location|pushd|popd|true|exit(?:\s+\$?\w+)?)\b/i;

function splitShellSegments(command: string): string[] {
  const rawSegments: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        buf += ch + command[++i];
        continue;
      }
      if (ch === '`' && quote === '"' && i + 1 < command.length) {
        buf += ch + command[++i];
        continue;
      }
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }

    if (ch === ';') {
      rawSegments.push(buf);
      buf = '';
      continue;
    }

    if ((ch === '&' || ch === '|') && command[i + 1] === ch) {
      rawSegments.push(buf);
      buf = '';
      i += 1;
      continue;
    }

    buf += ch;
  }
  rawSegments.push(buf);

  const cleaned: string[] = [];
  for (const raw of rawSegments) {
    let seg = raw.trim();
    // Unwrap PowerShell `if ($LASTEXITCODE ...) { ... }` wrappers around chained steps.
    seg = seg.replace(/^if\s*\([^)]*\)\s*\{\s*/i, '').replace(/\s*\}+\s*$/, '').trim();
    if (!seg || SHELL_GLUE_RE.test(seg)) continue;
    cleaned.push(seg);
  }
  return cleaned;
}

function stripQuotedArgs(segment: string): string {
  return segment.replace(/"(?:\\.|`.|[^"])*"|'[^']*'/g, '""');
}

function matchSegmentRule(segment: string): Exclude<CompressorRuleName, 'generic'> | null {
  const lower = stripQuotedArgs(segment).trim().toLowerCase();
  if (/\bdotnet\s+(?:build|test|restore|publish)\b/.test(lower)) {
    return 'dotnet';
  }
  if (/\b(?:vitest|npm\s+test|npm\s+run\s+test|pnpm\s+test)\b/.test(lower)) {
    return 'vitest';
  }
  if (/\bgit\s+(?:diff|status|log)\b/.test(lower)) {
    return 'git';
  }
  if (/\b(?:tsc|npm\s+run\s+typecheck)\b/.test(lower)) {
    return 'tsc';
  }
  if (/\b(?:eslint|biome|npm\s+run\s+lint)\b/.test(lower)) {
    return 'eslint';
  }
  if (/\bpytest\b/.test(lower)) {
    return 'pytest';
  }
  return null;
}

/**
 * Classifies a command string into a specialized compressor rule, falling back
 * to `generic` when no specialized rule matches or when a shell chain mixes
 * incompatible commands (so narrow rules never swallow output from chained tools).
 */
export function selectRule(command: string): CompressorRuleName {
  const segments = splitShellSegments(command);
  if (segments.length === 0) return 'generic';

  const rules = segments.map(matchSegmentRule);
  const first = rules[0];
  if (!first) return 'generic';

  for (let i = 1; i < rules.length; i += 1) {
    if (rules[i] !== first) {
      return 'generic';
    }
  }
  return first;
}

/**
 * Compresses raw command lines using the best-matching rule for `command`.
 */
export function compressOutput(
  command: string,
  lines: OutputLine[],
  exitCode: number,
): CompressedOutput {
  const rule = selectRule(command);
  switch (rule) {
    case 'dotnet':
      return { rule, summary: compressDotnet(lines, exitCode) };
    case 'vitest':
      return { rule, summary: compressVitest(lines, exitCode) };
    case 'git':
      return { rule, summary: compressGit(command, lines, exitCode) };
    case 'tsc':
      return { rule, summary: compressTsc(lines, exitCode) };
    case 'eslint':
      return { rule, summary: compressEslint(lines, exitCode) };
    case 'pytest':
      return { rule, summary: compressPytest(lines, exitCode) };
    case 'generic':
      return { rule, summary: compressGeneric(lines, exitCode) };
  }
}
