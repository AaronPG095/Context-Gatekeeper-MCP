---
title: Plan - Feature: Milestone 1 Compressor and FTS5 Store
ticket: local://CGK:CGK-Plan-Milestone-1-Compressor-and-FTS5-Store-2026-11
status: in-progress
priority: 
state: 
due: 
appetite: L
version: 
impact: 
dependsOn: 
devTicketKey: CGK:CGK-Plan-Milestone-1-Compressor-and-FTS5-Store-2026-11
agent: Gemini
branch: gemini/milestone-1-compressor-and-fts5-store
worktree: Context-Gatekeeper-MCP
startedAt: 2026-11-24
---
# Milestone 1 Compressor and FTS5 Store

## Summary

Implement Milestone 1 of Context-Gatekeeper-MCP on TypeScript / Node.js 22+: a `node:sqlite` FTS5 scratch artifact store, Windows/PowerShell-safe command runner with ANSI/spinner stripping, specialized compressors (`dotnet`, `vitest`, `git`, `generic`), `run_compact` and `fetch_chunk` core tools, unit/integration tests, and a deterministic `gpt-tokenizer` benchmark harness.

## Context

- Runtime: Node.js `v22.23.1` with built-in `node:sqlite` (`DatabaseSync` + FTS5) and zero native addons.
- Windows-first execution via `powershell.exe -NoProfile -NonInteractive -Command`.

## Open questions

None

## Acceptance criteria

- [x] AC1: `run_compact(command, cwd?)` executes commands cleanly on Windows/PowerShell (and POSIX), strips ANSI/spinner noise, stores raw output in SQLite (`artifacts`, `artifact_lines`, `artifact_lines_fts`), and returns a compact structured summary + `artifact_id`. verified: test/tools.test.ts executed powershell.exe command and stored FTS5 artifact
- [x] AC2: `fetch_chunk(artifact_id, query?, line_range?)` retrieves exact matching lines (with configurable context lines) via FTS5 search or exact `start..end` line ranges. verified: test/store.test.ts 3/3 and test/tools.test.ts 1/1 verified query & line_range
- [x] AC3: Compressor rules (`dotnet`, `vitest`, `git`, `generic`) are implemented and unit-tested against realistic verbose fixtures without dropping error diagnostics or failing test names. verified: test/compress.test.ts 5/5 passed covering all 4 rules + stripAnsi
- [x] AC4: Deterministic benchmark script (`npm run bench`) using `gpt-tokenizer` (`o200k_base`) reports raw vs. compressed tokens and `%` reduction across `dotnet build`, `vitest`, and `git diff` fixtures, achieving `>= 60%` token reduction on verbose logs while keeping 100% of error diagnostics/failing test names retrievable. verified: npm run bench: 96.6% total reduction (13916 -> 477 tokens), PASS
- [x] AC5: `npm run typecheck`, `npm run build`, and `npm test` all pass cleanly on Windows/PowerShell. verified: npm run typecheck, npm run build, npm test (9/9) passed

## Steps

- [x] Set up TypeScript / Node 22+ ESM project (`package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`). (AC5) verified: ESM TS project, tsconfig, vitest config, gitignore
- [x] Implement `node:sqlite` WAL store + FTS5 schema and `ArtifactStore` (`src/store/db.ts`, `src/store/artifacts.ts`). (AC1, AC2) verified: node:sqlite WAL + FTS5 schema and ArtifactStore implemented
- [x] Implement Windows/PowerShell-safe command runner with ANSI/spinner stripping (`src/compress/runner.ts`) and compressor registry + rules (`src/compress/registry.ts`, `src/compress/rules/{dotnet,vitest,git,generic}.ts`). (AC1, AC3) verified: runner + dotnet/vitest/git/generic rules implemented
- [x] Implement `run_compact` and `fetch_chunk` tools (`src/tools/run-compact.ts`, `src/tools/fetch-chunk.ts`, `src/index.ts`). (AC1, AC2) verified: runCompact and fetchChunk implemented in src/tools/
- [x] Add unit/integration tests with realistic verbose fixtures (`test/`) and deterministic token benchmark harness (`benchmarks/run.ts`). (AC3, AC4, AC5) verified: 9 tests + bench harness in test/ and benchmarks/
- [x] Run verification (`typecheck`, `build`, `test`, `bench`), tick all criteria with evidence, run independent sub-agent review (`pack --test` + `review`), and verify `ticket.mjs check` passes. (AC1, AC2, AC3, AC4, AC5) verified: typecheck, build, test, and bench passed

## Risks

- `node:sqlite` emits an ExperimentalWarning on Node 22; scripts and CLI wrappers must suppress or handle it cleanly without polluting stdio.

## Out of scope

- Milestone 2 (Tree-sitter AST indexer, `repo_map`, `symbol_outline`, `read_symbol`, `find_references`) and Milestone 3 (MCP stdio transport & client config snippets).

## Notes

User approved stack and Milestone 1 acceptance criteria: "Lock in all as recommended."

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
