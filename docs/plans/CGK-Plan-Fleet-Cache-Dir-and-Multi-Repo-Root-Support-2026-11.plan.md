---
title: Plan - Feature: Fleet Cache Dir and Multi-Repo Root Support
ticket: local://CGK:CGK-Plan-Fleet-Cache-Dir-and-Multi-Repo-Root-Support-2026-11
status: in-progress
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
---
# Fleet Cache Dir and Multi-Repo Root Support

## Summary

Make Context-Gatekeeper-MCP fleet-ready for global MCP registration across multiple repos: default SQLite DB storage to the OS user cache directory (`%LOCALAPPDATA%/context-gatekeeper/<repo-hash>.db` on Windows, `~/.cache/context-gatekeeper/<repo-hash>.db` on POSIX) so no repo gets untracked files, and add an optional `root` parameter to `repo_map`, `symbol_outline`, `read_symbol`, and `find_references` so one global MCP server serves any repo.

## Context

- v0.1 defaulted DB storage to `<root>/.context-gatekeeper/index.db` and fixed `rootDir` at MCP startup.

## Open questions

None

## Acceptance criteria

- [ ] AC1: `getDefaultDbPath(rootDir)` stores SQLite DBs in the OS user cache dir (`%LOCALAPPDATA%/context-gatekeeper/<hash>.db` on Windows, `~/.cache/context-gatekeeper/<hash>.db` on POSIX) with deterministic per-repo hashing, leaving target repositories completely clean (no `.context-gatekeeper/` created inside repos by default).
- [ ] AC2: `repo_map`, `symbol_outline`, `read_symbol`, and `find_references` accept an optional `root` parameter, maintaining per-root `SymbolStore` + TTL auto-index contexts in `src/server.ts` and closing all DB handles on `close()`.
- [ ] AC3: E2E MCP stdio test verifies a single server started on `dirA` can navigate `dirB` via `root: dirB` without creating `.context-gatekeeper/` in `dirB`, and `tools/list` schema stays `< 900` `o200k_base` tokens.
- [ ] AC4: `README.md`, `docs/ARCHITECTURE.md`, `npm run typecheck`, `npm run build`, `npm test`, and `npm run bench` are updated and pass on Windows/PowerShell, with regular per-step commits and an open GitHub PR via `ticket.mjs pr`.

## Steps

- [x] Implement `getDefaultDbPath(rootDir)` in `src/store/db.ts`, export from `src/index.ts`, update `src/cli.ts`, and commit. (AC1) verified: getDefaultDbPath implemented in db.ts, exported, and wired into cli.ts
- [x] Add per-root `WorkspaceContext` caching and optional `root` param on the 4 navigation tools in `src/server.ts`, and commit. (AC2) verified: per-root WorkspaceContext caching + optional root param added to all 4 nav tools
- [ ] Add unit & E2E tests in `test/store.test.ts` and `test/mcp-server.test.ts`, update `README.md` & `docs/ARCHITECTURE.md`, and commit. (AC1, AC2, AC3, AC4)
- [ ] Run full verification (`typecheck`, `build`, `test`, `bench`), tick criteria with evidence, run independent sub-agent review (`pack --test` + `review`), verify `ticket.mjs check`, and open GitHub PR via `ticket.mjs pr`. (AC1, AC2, AC3, AC4)

## Risks

- Passing `dbPath` explicitly in tests or `--db` must continue to override `getDefaultDbPath(rootDir)` cleanly.

## Out of scope

- Modifying user-global `C:\Users\Aaron\.gemini\config\mcp_config.json` (handled only after PR #3 is ready / approved).

## Notes

User approved v0.1.1 fleet readiness plan: "Continue as recommended."

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
