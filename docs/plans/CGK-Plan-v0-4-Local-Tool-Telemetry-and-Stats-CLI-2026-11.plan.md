---
title: Plan - Feature: v0.4 Local Tool Telemetry and Stats CLI
ticket: local://CGK:CGK-Plan-v0-4-Local-Tool-Telemetry-and-Stats-CLI-2026-11
status: in-progress
priority: 
state: 
due: 
appetite: M
version: 
impact: 
dependsOn: 
devTicketKey: CGK:CGK-Plan-v0-4-Local-Tool-Telemetry-and-Stats-CLI-2026-11
agent: Gemini
branch: feat/v0-4-local-telemetry-and-stats
worktree: Context-Gatekeeper-MCP
startedAt: 2026-11-26
---
# v0.4 Local Tool Telemetry and Stats CLI

## Summary

Add 100% local SQLite tool-call telemetry (`meta` + `tool_events` tables) and a CLI-only `stats [--all] [--days <n>] [--json]` command to `Context-Gatekeeper-MCP` (`v0.4.0`). This lets Aaron measure real token savings across all repositories and identify `generic` fallbacks or heavy calls for recursive improvement without adding any MCP schema tokens.

## Context

- `src/store/db.ts` stores per-repo SQLite DBs in `%LOCALAPPDATA%\context-gatekeeper\<12-hex>.db`, currently tracking only `artifacts` (from `run_compact`) and `files`/`symbols`/`symbol_refs`.
- `src/server.ts` registers the 6 MCP tools (`613` `o200k_base` schema tokens). Adding a 7th MCP tool was rejected to preserve zero schema bloat; `stats` belongs in `src/cli.ts`.
- `src/cli.ts` uses dynamic imports after `import './suppress-warnings.js'` so Node 22 SQLite warnings stay suppressed.

## Open questions

None

## Acceptance criteria

- [x] AC1: `src/store/db.ts` exports `getCacheDir()` and creates/auto-migrates `meta` and `tool_events` tables with indexes on `created_at` and `(tool, target)`. verified: getCacheDir(), meta, and tool_events added to src/store/db.ts and verified by npm run typecheck + test/telemetry.test.ts
- [x] AC2: `src/store/telemetry.ts` exports `TelemetryStore`, `listCacheDbPaths()`, `aggregateStats()`, and `formatStatsReport()` with accurate token estimation (`Math.round(chars / 4)`), `sinceMs` filtering, `generic` fallback counting, and cross-repo aggregation. verified: TelemetryStore, listCacheDbPaths, aggregateStats, formatStatsReport implemented in src/store/telemetry.ts and verified in test/telemetry.test.ts
- [x] AC3: All 6 MCP tool handlers in `src/server.ts` and `run`/`fetch` in `src/cli.ts` record fail-safe `tool_events` (and `meta.root_dir`) while keeping `tools/list` schema `< 900` `o200k_base` tokens and server version `0.4.0`. verified: All 6 MCP tools and CLI run/fetch instrumented; test/telemetry.test.ts + test/mcp-server.test.ts pass with tools/list < 900 tokens
- [x] AC4: `context-gatekeeper-mcp stats [--all] [--days <n>] [--json]` works via `src/cli.ts` with clean stderr, `test/telemetry.test.ts` passes alongside all existing tests, and `README.md` / `docs/ROADMAP.md` / `package.json` are updated for `v0.4.0`. verified: stats CLI verified with clean stderr in test/telemetry.test.ts; 7/7 test files (22/22 tests) passed

## Steps

- [x] Add `getCacheDir()`, `meta`, and `tool_events` schema to `src/store/db.ts`. (AC1) verified: Added getCacheDir() and meta/tool_events schema in src/store/db.ts
- [x] Implement `src/store/telemetry.ts` and export it from `src/index.ts`. (AC2) verified: Implemented TelemetryStore and aggregators in src/store/telemetry.ts and exported in src/index.ts
- [x] Instrument all 6 MCP tools in `src/server.ts` and `run`/`fetch` in `src/cli.ts`. (AC3) verified: Instrumented all 6 MCP handlers in src/server.ts and run/fetch in src/cli.ts
- [x] Add `stats` CLI subcommand, update `package.json`/`README.md`/`docs/ROADMAP.md`, and add `test/telemetry.test.ts`. (AC4) verified: Added stats subcommand, docs, v0.4.0 version bump, and 3 telemetry tests
- [ ] Run `typecheck`, `build`, `npm test`, `adw pack`, independent sub-agent review, and ship PR. (AC1, AC2, AC3, AC4)

## Risks

Telemetry DB writes could slow down or break a tool call if the DB is locked or read-only, or `stats` on an unindexed repo could accidentally create an empty `.db` file; mitigated by wrapping `recordEvent` in fail-safe `try/catch` and skipping nonexistent DB files in `stats`.

## Out of scope

External network telemetry, adding a 7th MCP tool to `tools/list`, or building new language grammars/compressors in this PR.

## Notes

User approved ("Approved.").

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
