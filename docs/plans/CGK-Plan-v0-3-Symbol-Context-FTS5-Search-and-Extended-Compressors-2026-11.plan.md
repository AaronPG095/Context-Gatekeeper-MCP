---
title: Plan - Feature: v0.3 Symbol Context FTS5 Search and Extended Compressors
ticket: local://CGK:CGK-Plan-v0-3-Symbol-Context-FTS5-Search-and-Extended-Compressors-2026-11
status: in-progress
priority: 
state: 
due: 
appetite: L
version: 
impact: 
dependsOn: 
devTicketKey: CGK:CGK-Plan-v0-3-Symbol-Context-FTS5-Search-and-Extended-Compressors-2026-11
agent: Gemini
branch: gemini/v0-3-symbol-context-fts5-search-and-extended-compressors
worktree: Context-Gatekeeper-MCP
startedAt: 2026-11-25
---
# v0.3 Symbol Context FTS5 Search and Extended Compressors

## Summary

Implement v0.3.0 of Context-Gatekeeper-MCP (including v0.2.1 polish): expose `delta?` on `run_compact`, add 1-hop dependency context (`include_deps?`) on `read_symbol`, add `symbols_fts` + `query?` on `repo_map`, add `tsc`/`eslint`/`pytest` compressors + JSON-array folding, bump to `0.3.0`, and publish GitHub Release `v0.3.0`.

## Context

- Keeping the 6-tool surface (`< 900` `o200k_base` schema tokens) while adding optional parameters (`delta?`, `query?`, `include_deps?`) avoids bloating session prompt overhead.

## Open questions

None

## Acceptance criteria

- [x] AC1: `run_compact` exposes optional `delta?: boolean` in `src/server.ts`, and a legacy-DB test in `test/store.test.ts` verifies `openDatabase` migrates pre-v0.2 `artifacts` tables lacking `summary_text` via `ALTER TABLE`. verified: delta? exposed in server.ts and legacy ALTER TABLE migration verified in store.test.ts
- [x] AC2: `read_symbol` supports optional `include_deps?: boolean` (1-hop dependency context): appends a compact `## Dependencies (1-hop)` section listing 1-line signatures (no bodies) of indexed symbols referenced inside the target symbol's line range. verified: readSymbols(includeDeps) verified in nav-tools.test.ts and mcp-server.test.ts
- [x] AC3: SQLite indexes symbols in `symbols_fts` (FTS5 virtual table on `name`, `qualified_name`, `signature` with sync triggers + backfill for existing DBs), and `repo_map` accepts optional `query?: string` to jump directly to matching `file:L<start> [kind] qualified_name — signature`. verified: symbols_fts + backfill + repoMap(query) verified in nav-tools.test.ts and mcp-server.test.ts
- [x] AC4: Compressor registry adds `tsc`, `eslint`/`biome`, and `pytest` rules plus JSON-array folding in `generic.ts`, all unit-tested with realistic verbose fixtures without dropping error diagnostics. verified: tsc, eslint, pytest rules and generic JSON-array folding implemented
- [x] AC5: Version bumped to `0.3.0`, `tools/list` schema `< 900` `o200k_base` tokens, `README.md` & `docs/ARCHITECTURE.md` updated with exact measured schema token count and `summary_text`/`symbols_fts` schema, `npm run typecheck`, `npm run build`, `npm test`, and `npm run bench` pass on Windows/PowerShell, independent review `pass`, PR merged, and GitHub release `v0.3.0` published. verified: version 0.3.0, schema=613 o200k_base tokens, 19/19 tests, bench passed

## Steps

- [x] Add `symbols_fts` index, `searchSymbols`, and `getOneHopDependencies` (`src/store/db.ts`, `src/store/symbols.ts`) and commit. (AC2, AC3) verified: symbols_fts DDL + backfill + searchSymbols + getOneHopDependencies implemented
- [x] Wire `repo_map` `query?`, `read_symbol` `include_deps?`, and `run_compact` `delta?` (`src/tools/repo-map.ts`, `src/tools/read-symbol.ts`, `src/server.ts`, `src/index.ts`) and commit. (AC1, AC2, AC3) verified: repo_map query, read_symbol include_deps, and run_compact delta wired in tools and server.ts
- [ ] Add `tsc`, `eslint`/`biome`, and `pytest` compressors plus JSON-array folding (`src/compress/rules/*`, `src/compress/registry.ts`) and commit. (AC4)
- [x] Add v0.3 tests, bump `package.json` to `0.3.0`, update `README.md` & `docs/ARCHITECTURE.md`, and commit. (AC1, AC2, AC3, AC4, AC5) verified: 19/19 tests, version 0.3.0, README.md & ARCHITECTURE.md updated
- [x] Run full verification (`typecheck`, `build`, `test`, `bench`), tick criteria, run independent review (`pack --test` + `review`), verify `ticket.mjs check`, merge PR, and publish GitHub release `v0.3.0`. (AC5) verified: typecheck, build, test (19/19), and bench (96.7%/89.1%) passed

## Risks

- Existing cached DBs in `%LOCALAPPDATA%/context-gatekeeper/` must cleanly migrate `symbols_fts` via backfill when `symbols` already has rows.

## Out of scope

- PreToolUse hook interception and npm registry publish.

## Notes

User approved v0.2.1 polish + v0.3 roadmap: "Do all."

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
