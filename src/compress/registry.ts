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

/**
 * Classifies a command string into a specialized compressor rule, falling back
 * to `generic` when no specialized rule matches.
 */
export function selectRule(command: string): CompressorRuleName {
  const lower = command.trim().toLowerCase();
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
  return 'generic';
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
