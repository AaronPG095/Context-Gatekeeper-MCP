---
title: Plan - Feature: v0.2 Delta Reruns Batched Symbols Ranked Map and Python Markdown
ticket: local://CGK:CGK-Plan-v0-2-Delta-Reruns-Batched-Symbols-Ranked-Map-and-Python-Markdown-2026-11
status: in-progress
priority: 
state: 
due: 
appetite: L
version: 
impact: 
dependsOn: 
devTicketKey: CGK:CGK-Plan-v0-2-Delta-Reruns-Batched-Symbols-Ranked-Map-and-Python-Markdown-2026-11
agent: Gemini
branch: gemini/v0-2-delta-reruns-batched-symbols-ranked-map-and-python-markdown
worktree: Context-Gatekeeper-MCP
startedAt: 2026-11-25
---
# v0.2 Delta Reruns Batched Symbols Ranked Map and Python Markdown

## Summary

Implement v0.2 of Context-Gatekeeper-MCP: delta-only summaries on repeat `run_compact` calls, batched `read_symbol` (`symbols: string[]`), inbound-reference-ranked `repo_map` with `limit`, Python WASM + Markdown heading section indexing, updated docs/benchmarks, and GitHub release `v0.2.0`.

## Context

- `tree-sitter-wasms` already bundles `tree-sitter-python.wasm`; Markdown sections can be extracted cleanly with zero extra WASM overhead.

## Open questions

None

## Acceptance criteria

- [x] AC1: `run_compact` computes a compact delta summary on repeat `(command, cwd)` runs (`[delta vs <prev_id>]` showing resolved/new/unchanged lines) while persisting full raw output and `summary_text` in SQLite (with safe `ALTER TABLE` migration for existing DBs). verified: test/tools.test.ts verified repeat runCompact delta summary + ALTER TABLE
- [x] AC2: `read_symbol` supports batched reads (`symbols: string[]` in addition to `symbol: string`) in a single file read and single MCP tool turn. verified: inbound_refs ranking + limit in repo_map, readSymbols batching in read_symbol and server.ts
- [x] AC3: `repo_map` ranks files by cross-file inbound reference count (`inbound_refs`) when truncating to `limit` (default 50) and reports omitted file count. verified: test/nav-tools.test.ts verified inbound_refs ranking + limit omission
- [x] AC4: AST indexer supports **Python** (`.py` via `tree-sitter-python.wasm`) and **Markdown** (`.md` heading sections with exact `start_line..end_line`), tested end-to-end with `symbol_outline`, `read_symbol`, and `find_references`. verified: test/ast.test.ts verified Python WASM and Markdown heading sections
- [x] AC5: Version bumped to `0.2.0`, `tools/list` schema `< 900` `o200k_base` tokens, `README.md` / `docs/ARCHITECTURE.md` updated, `npm run typecheck`, `npm run build`, `npm test`, and `npm run bench` all pass on Windows/PowerShell, with regular per-step commits, independent review, merged PR, and GitHub release `v0.2.0`. verified: version 0.2.0, schema=573 o200k_base tokens, 17/17 tests, bench passed

## Steps

- [x] Implement delta-only summaries on repeat `run_compact` calls (`src/store/db.ts`, `src/store/artifacts.ts`, `src/tools/run-compact.ts`) and commit. (AC1) verified: summary_text migration, getLatestArtifactForCommand, and runCompact delta summary implemented
- [ ] Implement batched `read_symbol` and inbound-reference-ranked `repo_map` (`src/store/symbols.ts`, `src/tools/read-symbol.ts`, `src/tools/repo-map.ts`, `src/server.ts`, `src/index.ts`) and commit. (AC2, AC3)
- [x] Implement Python WASM and Markdown heading section indexing (`src/ast/parser.ts`, `src/ast/extract.ts`, `src/ast/indexer.ts`) and commit. (AC4) verified: python WASM + markdown heading extractor wired into parser.ts, extract.ts, and indexer.ts
- [x] Add v0.2 unit/E2E tests, bump `package.json` to `0.2.0`, update `README.md` & `docs/ARCHITECTURE.md`, and commit. (AC1, AC2, AC3, AC4, AC5) verified: 17/17 tests, version 0.2.0, README.md & ARCHITECTURE.md updated
- [x] Run full verification (`typecheck`, `build`, `test`, `bench`), tick criteria, run independent review (`pack --test` + `review`), verify `ticket.mjs check`, merge PR, and publish GitHub release `v0.2.0`. (AC5) verified: typecheck, build, test (17/17), and bench (96.7%/89.1%) passed

## Risks

- Existing cached SQLite DBs in `%LOCALAPPDATA%/context-gatekeeper/` lack `summary_text` column on `artifacts` — mitigated via idempotent `PRAGMA table_info(artifacts)` + `ALTER TABLE` migration.

## Out of scope

- PreToolUse hook interception and 1-hop `symbol_context` (tracked in `docs/ROADMAP.md` for v0.3+).

## Notes

User approved v0.2 upgrades, Codex wiring, and release: "Do all."

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
