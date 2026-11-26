---
title: Plan - Feature: Fleet Cache Dir and Multi-Repo Root Support
ticket: local://CGK:CGK-Plan-Fleet-Cache-Dir-and-Multi-Repo-Root-Support-2026-11
status: shipped
priority: 
state: 
due: 
appetite: M
version: 
impact: 
dependsOn: 
devTicketKey: CGK:CGK-Plan-Fleet-Cache-Dir-and-Multi-Repo-Root-Support-2026-11
agent: Gemini
branch: gemini/fleet-cache-dir-and-multi-repo-root-support
worktree: Context-Gatekeeper-MCP
startedAt: 2026-11-24
reviewedBy: Gemini
reviewVerdict: pass
reviewSession: 0e11c274-37b7-46fc-91c9-6efd31653f7a
baseBranch: main
reviewFingerprint: 4a24730ab0672bc83ef6e4b63e696b29b650d395eda39d0aabefb10a24188da1
pr: https://github.com/AaronPG095/Context-Gatekeeper-MCP/pull/3
---
# Fleet Cache Dir and Multi-Repo Root Support

## Summary

Make Context-Gatekeeper-MCP fleet-ready for global MCP registration across multiple repos: default SQLite DB storage to the OS user cache directory (`%LOCALAPPDATA%/context-gatekeeper/<repo-hash>.db` on Windows, `~/.cache/context-gatekeeper/<repo-hash>.db` on POSIX) so no repo gets untracked files, and add an optional `root` parameter to `repo_map`, `symbol_outline`, `read_symbol`, and `find_references` so one global MCP server serves any repo.

## Context

- v0.1 defaulted DB storage to `<root>/.context-gatekeeper/index.db` and fixed `rootDir` at MCP startup.

## Open questions

None

## Acceptance criteria

- [x] AC1: `getDefaultDbPath(rootDir)` stores SQLite DBs in the OS user cache dir (`%LOCALAPPDATA%/context-gatekeeper/<hash>.db` on Windows, `~/.cache/context-gatekeeper/<hash>.db` on POSIX) with deterministic per-repo hashing, leaving target repositories completely clean (no `.context-gatekeeper/` created inside repos by default). verified: getDefaultDbPath(rootDir) tested in store.test.ts and mcp-server.test.ts
- [x] AC2: `repo_map`, `symbol_outline`, `read_symbol`, and `find_references` accept an optional `root` parameter, maintaining per-root `SymbolStore` + TTL auto-index contexts in `src/server.ts` and closing all DB handles on `close()`. verified: server.ts per-root WorkspaceContext + optional root on 4 nav tools + close() cleanup
- [x] AC3: E2E MCP stdio test verifies a single server started on `dirA` can navigate `dirB` via `root: dirB` without creating `.context-gatekeeper/` in `dirB`, and `tools/list` schema stays `< 900` `o200k_base` tokens. verified: mcp-server.test.ts verified dirB nav via root param with zero .context-gatekeeper/ in dirA/dirB and <900 schema tokens
- [x] AC4: `README.md`, `docs/ARCHITECTURE.md`, `npm run typecheck`, `npm run build`, `npm test`, and `npm run bench` are updated and pass on Windows/PowerShell, with regular per-step commits and an open GitHub PR via `ticket.mjs pr`. verified: README.md, ARCHITECTURE.md, typecheck, build, test (15/15), and bench passed

## Steps

- [x] Implement `getDefaultDbPath(rootDir)` in `src/store/db.ts`, export from `src/index.ts`, update `src/cli.ts`, and commit. (AC1) verified: getDefaultDbPath implemented in db.ts, exported, and wired into cli.ts
- [x] Add per-root `WorkspaceContext` caching and optional `root` param on the 4 navigation tools in `src/server.ts`, and commit. (AC2) verified: per-root WorkspaceContext caching + optional root param added to all 4 nav tools
- [x] Add unit & E2E tests in `test/store.test.ts` and `test/mcp-server.test.ts`, update `README.md` & `docs/ARCHITECTURE.md`, and commit. (AC1, AC2, AC3, AC4) verified: store.test.ts (4/4), mcp-server.test.ts (3/3), README.md, and ARCHITECTURE.md updated (546 schema tokens)
- [x] Run full verification (`typecheck`, `build`, `test`, `bench`), tick criteria with evidence, run independent sub-agent review (`pack --test` + `review`), verify `ticket.mjs check`, and open GitHub PR via `ticket.mjs pr`. (AC1, AC2, AC3, AC4) verified: typecheck, build, test (15/15), and bench (96.7%/89.1%) passed

## Risks

- Passing `dbPath` explicitly in tests or `--db` must continue to override `getDefaultDbPath(rootDir)` cleanly.

## Out of scope

- Modifying user-global `~/.gemini/config/mcp_config.json` (handled only after PR #3 is ready / approved).

## Notes

User approved v0.1.1 fleet readiness plan: "Continue as recommended."

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
- 2026-11-24 18:42 UTC, Gemini (review: pass): v0.1.1 fleet readiness satisfies all 4 acceptance criteria: OS cache dir DBs, per-root WorkspaceContext with optional root on 4 nav tools, 546 o200k_base schema tokens, 15/15 tests, and 96.7%/89.1% benchmarks. [reviewer: 0e11c274-37b7-46fc-91c9-6efd31653f7a]
