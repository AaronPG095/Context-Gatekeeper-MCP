---
title: Plan - Bug: v0.4.1 Cache Isolation and Clean Stats Output
ticket: local://CGK:CGK-Plan-v0-4-1-Cache-Isolation-and-Clean-Stats-Output-2026-11
status: in-progress
priority: 
state: 
due: 
appetite: S
version: 
impact: 
dependsOn: 
devTicketKey: CGK:CGK-Plan-v0-4-1-Cache-Isolation-and-Clean-Stats-Output-2026-11
agent: Gemini
branch: fix/v0-4-1-cache-isolation-and-stats-cleanup
worktree: Context-Gatekeeper-MCP
startedAt: 2026-11-26
---
# v0.4.1 Cache Isolation and Clean Stats Output

## Summary

Isolate test SQLite cache databases via `CGK_CACHE_DIR` in `getCacheDir()` and `test/mcp-server.test.ts` so tests never pollute `%LOCALAPPDATA%\context-gatekeeper\`, hide 0-call DBs from `formatStatsReport()`, and add `pruneStaleCacheDbs()` + `stats --prune` to clean up stale/orphaned test DBs.

## Context

- Running `stats --all` right after shipping `v0.4.0` revealed 56 `.db` files in `%LOCALAPPDATA%\context-gatekeeper\`, created by `test/mcp-server.test.ts` multi-repo tests (`cgk-repo-a-*`, `cgk-repo-b-*`) and earlier test runs.
- `formatStatsReport()` listed every 0-call DB line by line, drowning out active repos.

## Open questions

None

## Acceptance criteria

- [x] AC1: `getCacheDir()` in `src/store/db.ts` honors `process.env.CGK_CACHE_DIR` when set, and `test/mcp-server.test.ts` isolates its multi-repo test into a temp `CGK_CACHE_DIR` so tests never pollute `%LOCALAPPDATA%\context-gatekeeper\`. verified: getCacheDir() honors CGK_CACHE_DIR and test/mcp-server.test.ts isolates multi-repo test; verified in test/telemetry.test.ts and test/mcp-server.test.ts
- [x] AC2: `formatStatsReport()` in `src/store/telemetry.ts` lists only repos with `calls > 0` (reporting inactive DB count concisely in the header), and `pruneStaleCacheDbs()` + `stats --prune` removes stale/orphaned `.db` files (plus `-wal`/`-shm` sidecars) whose `root_dir` no longer exists or that have 0 events and 0 artifacts. verified: formatStatsReport() hides 0-call DBs and pruneStaleCacheDbs() + stats --prune implemented and exported
- [x] AC3: `test/telemetry.test.ts` covers `CGK_CACHE_DIR`, inactive-DB hiding, and `pruneStaleCacheDbs()`; `npm run typecheck`, `npm run build`, and `npm test` all pass. verified: npm run typecheck, npm run build, and npm test passed (7/7 files, 23/23 tests)

## Steps

- [x] Add `CGK_CACHE_DIR` support to `src/store/db.ts` and isolate `test/mcp-server.test.ts`. (AC1) verified: Added CGK_CACHE_DIR in src/store/db.ts and isolated test/mcp-server.test.ts
- [x] Update `formatStatsReport()`, add `pruneStaleCacheDbs()` in `src/store/telemetry.ts`, wire `stats --prune` in `src/cli.ts`, export in `src/index.ts`, and bump version to `0.4.1`. (AC2) verified: Implemented pruneStaleCacheDbs, stats --prune, inactive DB hiding, and v0.4.1 version bump
- [x] Add tests in `test/telemetry.test.ts`, run `typecheck`, `build`, `npm test`, `adw pack`, independent review, and ship `v0.4.1`. (AC3) verified: Added telemetry isolation/prune tests; 7/7 files (23/23 tests) passed

## Risks

`rmSync` on Windows could fail if SQLite still holds a lock, or `pruneStaleCacheDbs()` could delete an active repo DB if `meta.root_dir` wasn't set yet; mitigated by closing `DatabaseSync` before `rmSync` and only pruning DBs whose `root_dir` is missing from disk OR that have `0` `tool_events` AND `0` `artifacts`.

## Out of scope

Changing `run_compact` compressors or MCP tool schemas.

## Notes

User approved ("Yes.").

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
