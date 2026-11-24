import type { OutputLine } from '../store/artifacts.js';
import { compressDotnet } from './rules/dotnet.js';
import { compressGeneric } from './rules/generic.js';
import { compressGit } from './rules/git.js';
import { compressVitest } from './rules/vitest.js';

export type CompressorRuleName = 'dotnet' | 'vitest' | 'git' | 'generic';

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
    case 'generic':
      return { rule, summary: compressGeneric(lines, exitCode) };
  }
}
