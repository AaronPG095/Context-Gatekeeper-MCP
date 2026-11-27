---
title: Plan - Feature: v0.5 Telemetry-Driven Compression and Attribution Upgrades
ticket: local://CGK:CGK-Plan-v0-5-Telemetry-Driven-Compression-and-Attribution-Upgrades-2026-11
status: in-progress
priority: 
state: 
due: 
appetite: M
version: 
impact: 
dependsOn: 
devTicketKey: CGK:CGK-Plan-v0-5-Telemetry-Driven-Compression-and-Attribution-Upgrades-2026-11
agent: Gemini
branch: feat/v0-5-telemetry-driven-upgrades
worktree: Context-Gatekeeper-MCP
startedAt: 2026-11-27
reviewedBy: Gemini
reviewVerdict: pass
reviewSession: d0d8903f-b395-4f76-bbc4-969351aece53
baseBranch: main
reviewFingerprint: 3ad631cabb8713cfa0e73fd26928033b57f5610d01a6de4f6aae30b89f15eb0a
---
# v0.5 Telemetry-Driven Compression and Attribution Upgrades

## Summary

Ship `v0.5.0` bundling all 4 improvements surfaced by real-world `MCP-Audit` telemetry: (1) attribute `run_compact` and `fetch_chunk` artifacts/telemetry to `getWorkspace(cwd)` instead of `defaultCtx` and skip `EBUSY`/`EPERM` locked DBs in `stats --prune`; (2) eliminate `generic` wrapper bloat on clean short outputs (`exitCode === 0`, `<= 25` lines, `<= 1,500` chars); (3) prevent multi-command shell chains (`;`, `&&`, `||`) from misclassifying mixed outputs into narrow rules (`tsc`, `vitest`, etc.); and (4) cap `fetch_chunk` `line_range` reads (`max_lines`, default `120`) and tighten multi-file `git diff` inline hunks (`MAX_TOTAL_INLINE_DIFF_LINES = 80`) to curb the #1 real-world token leak.

## Context

- Live `stats --all` across 39 real calls showed **86.2% token savings** (`~68,395 -> ~9,453` est. tokens), while revealing:
  1. All 22 `run_compact` calls in `MCP-Audit` logged under `antigravity` (`defaultRoot`) instead of `getWorkspace(cwd)` in `src/server.ts`, and `pruneStaleCacheDbs()` threw `EBUSY` on live locked `.db` files on Windows (`src/store/telemetry.ts`).
  2. Clean short commands (`adw new`, `git commit`, `adw create`) grew larger than raw output in `src/compress/rules/generic.ts` due to `[generic]` header + `L<n>:` prefixes.
  3. Compound commands like `adw tick ...; git commit; git push; adw pack --test` matched `vitest` or `tsc` in `src/compress/registry.ts` and dropped output from the other chained commands.
  4. `git diff` + wide `fetch_chunk(line_range)` calls accounted for 50% of all returned tokens (`4,738 / 9,453` tok) (`src/compress/rules/git.ts`, `src/tools/fetch-chunk.ts`).

## Open questions

None

## Acceptance criteria

- [x] AC1: `run_compact` in `src/server.ts` stores artifacts and records telemetry in `getWorkspace(cwd)` (while keeping `options.dbPath` behavior when `cwd` matches `defaultRoot`), `fetch_chunk` resolves `artifact_id` across workspace stores and logs to the owning workspace, and `pruneStaleCacheDbs()` in `src/store/telemetry.ts` skips `EBUSY`/`EPERM` locked DBs cleanly (`skippedLocked` / `kept`). verified: Verified in test/telemetry.test.ts (attributes run_compact/fetch_chunk to getWorkspace(cwd) and skips locked DBs during prune)
- [x] AC2: `compressGeneric()` in `src/compress/rules/generic.ts` returns clean unprefixed output (no `[generic]` wrapper or `L<n>:` bloat) when `exitCode === 0`, no error lines or duplicates exist, `<= 25` non-empty lines, and `<= 1,500` chars, while preserving full deduplication, error extraction, JSON folding, and `runCompact` delta compatibility. verified: Verified in test/compress.test.ts and test/tools.test.ts (clean short pass-through + delta No change)
- [x] AC3: `selectRule()` in `src/compress/registry.ts` splits top-level shell chains (`;`, `&&`, `||`) outside quotes and only selects a narrow rule (`dotnet`, `vitest`, `git`, `tsc`, `eslint`, `pytest`) when all non-control segments belong to the same rule (or pure shell glue like `cd`/`Set-Location`/`if ($LASTEXITCODE...)`/`echo`), falling back to `generic` on mixed tool chains (e.g. `adw tick ...; git commit; adw pack --test`). verified: Verified in test/compress.test.ts (quoted --verify-cmd and mixed chains return generic; homogeneous/glue chains keep narrow rule)
- [x] AC4: `fetchChunk()` in `src/tools/fetch-chunk.ts` enforces a `max_lines` cap on `line_range` reads (default `120`, overridable via `max_lines` parameter on `fetch_chunk` while keeping MCP `tools/list` schema `< 900` `o200k_base` tokens) with a clear truncation footer, `compressGit()` caps total inline diff lines across multi-file diffs (`80` lines) so large multi-file diffs stay compact, and all unit + E2E tests pass on `v0.5.0`. verified: Verified in test/tools.test.ts, test/compress.test.ts, test/telemetry.test.ts; 7/7 files (28/28 tests) and npm run bench passed

## Steps

- [x] Update `src/store/telemetry.ts` (`EBUSY`-safe `pruneStaleCacheDbs`) and `src/server.ts` (workspace-scoped `run_compact` & `fetch_chunk` artifact/telemetry routing + `max_lines` param + version `0.5.0`). (AC1, AC4) verified: Updated src/store/telemetry.ts and src/server.ts
- [x] Add clean short-output pass-through in `src/compress/rules/generic.ts` and preserve `runCompact` delta compatibility in `src/tools/run-compact.ts`. (AC2) verified: Added clean short pass-through and splitSummaryBody() in run-compact.ts
- [x] Make `selectRule()` chain-aware in `src/compress/registry.ts`. (AC3) verified: Implemented splitShellSegments() and stripQuotedArgs() in src/compress/registry.ts
- [x] Add `max_lines` cap to `src/tools/fetch-chunk.ts` (`--max-lines` in `src/cli.ts`) and total inline diff budget in `src/compress/rules/git.ts`; update `package.json`, `README.md`, and `docs/ROADMAP.md`. (AC4) verified: Added DEFAULT_MAX_RANGE_LINES=120, MAX_TOTAL_INLINE_DIFF_LINES=80, CLI --max-lines, and v0.5.0 docs
- [x] Add comprehensive tests in `test/compress.test.ts`, `test/tools.test.ts`, and `test/telemetry.test.ts`; run `typecheck`, `build`, `npm test`, `adw pack`, independent sub-agent review, and ship `v0.5.0`. (AC1, AC2, AC3, AC4) verified: 7/7 test files (28/28 tests) and npm run bench passed

## Risks

1. Stripping `L<n>:` prefixes on short clean `generic` outputs could affect `computeDeltaSummary` in `src/tools/run-compact.ts` if line 0 is assumed to be a `[rule]` header; mitigated by checking `test/tools.test.ts` and ensuring `computeDeltaSummary` handles headerless pass-through summaries cleanly.
2. Splitting shell chains on `;` could misfire on `;` inside quoted strings (e.g., commit messages or `--summary "a; b"`); mitigated by quote-aware splitting in `selectRule()`.

## Out of scope

Adding new Tree-sitter WASM grammars or external network telemetry.

## Notes

User approved ("Bundle all in. /approved").

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
- 2026-11-27 11:49 UTC, Gemini (review: pass): v0.5.0 AC1-AC4 and follow-up fixes (RULE_HEADER_RE, NaN guards, README 634-token update) verified clean; 28/28 tests pass. [reviewer: d0d8903f-b395-4f76-bbc4-969351aece53]
