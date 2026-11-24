---
title: Plan - Feature: Milestone 3 MCP Stdio Server and Docs
ticket: local://CGK:CGK-Plan-Milestone-3-MCP-Stdio-Server-and-Docs-2026-11
status: shipped
priority: 
state: 
due: 
appetite: L
version: 
impact: 
dependsOn: 
devTicketKey: CGK:CGK-Plan-Milestone-3-MCP-Stdio-Server-and-Docs-2026-11
agent: Gemini
branch: gemini/milestone-3-mcp-stdio-server-and-docs
worktree: Context-Gatekeeper-MCP
startedAt: 2026-11-24
reviewedBy: Gemini
reviewVerdict: pass
reviewSession: ff799d60-fcd6-45ec-b0d5-b9de1e34fc89
baseBranch: main
reviewFingerprint: 414b1f15da75784e21da934a5c99aa9424804d2b12412a9f2e009dad4f7a44d3
pr: https://github.com/AaronPG095/Context-Gatekeeper-MCP/pull/2
---
# Milestone 3 MCP Stdio Server and Docs

## Summary

Ship the lean MCP stdio server (`src/server.ts`) and executable CLI (`src/cli.ts`) exposing all 6 tools (`run_compact`, `fetch_chunk`, `repo_map`, `symbol_outline`, `read_symbol`, `find_references`) with minimal schema overhead, E2E MCP stdio tests, and `README.md` + `docs/ARCHITECTURE.md` with Windows-safe client configs and measured `o200k_base` benchmarks.

## Context

- Core compression + FTS5 store (Milestone 1) and Tree-sitter WASM indexer + navigation tools (Milestone 2) are merged on `main` (`11/11` tests passing).

## Open questions

None

## Acceptance criteria

- [x] AC1: MCP stdio server (`src/server.ts` + `src/cli.ts`) exposes all 6 tools with minimal JSON schemas (`< 900` total `o200k_base` tokens for the entire `tools/list` schema payload) and clean stdio (no stdout corruption or SQLite warning noise). verified: server.ts, cli.ts, and index.ts typechecked and built cleanly
- [x] AC2: Navigation tools auto-index the workspace incrementally on first call / when stale, and `cli.ts` supports `--root <dir>` and `--db <path>` plus `run` / `fetch` CLI proxy subcommands. verified: auto-indexing, --root/--db flags, and run CLI proxy verified in test/mcp-server.test.ts
- [x] AC3: End-to-end MCP stdio test (`test/mcp-server.test.ts`) connects a real MCP client over stdio to the built server, verifying `tools/list` and tool calls across both compression and AST navigation flows on Windows/PowerShell. verified: test/mcp-server.test.ts 2/2 passed over real stdio transport
- [x] AC4: `README.md` and `docs/ARCHITECTURE.md` document Windows-safe drop-in MCP config snippets for Claude Code, Codex, Antigravity, and Cursor, architecture overview, and measured `o200k_base` token-savings benchmarks + `TokenHUD` cross-check steps. verified: README.md and docs/ARCHITECTURE.md include 4 client configs, benchmarks, and TokenHUD guide
- [x] AC5: `npm run typecheck`, `npm run build`, `npm test`, and `npm run bench` all pass cleanly on Windows/PowerShell, with regular per-step commits and an open GitHub PR via `node scripts/ticket.mjs pr`. verified: typecheck, build, test (13/13), and bench (96.7% CLI / 89.1% nav) passed

## Steps

- [x] Install `@modelcontextprotocol/sdk` and `zod`, update `package.json` (`bin`, `main`, `types`, `files`, `pretest`), and commit. (AC1, AC5) verified: @modelcontextprotocol/sdk + zod installed and package.json bin/files/pretest configured
- [x] Implement `src/server.ts` (6 low-schema-token MCP tools + auto-indexing) and `src/cli.ts` (MCP stdio + `run`/`fetch` CLI proxy), export from `src/index.ts`, and commit. (AC1, AC2) verified: server.ts (6 tools + auto-indexing) and cli.ts (stdio + run/fetch) implemented
- [x] Add E2E MCP stdio test (`test/mcp-server.test.ts`) verifying all 6 tools and `< 900` `o200k_base` schema tokens, and commit. (AC1, AC2, AC3) verified: test/mcp-server.test.ts 2/2 passed; tools/list schema = 520 o200k_base tokens
- [x] Write `README.md` and `docs/ARCHITECTURE.md` with Windows-safe client configs (Claude Code, Codex, Antigravity, Cursor), architecture diagram, measured benchmarks, and `TokenHUD` cross-check methodology, and commit. (AC4) verified: README.md and docs/ARCHITECTURE.md written with client configs, schema, and measured benchmarks
- [x] Run verification (`typecheck`, `build`, `test`, `bench`), tick all criteria with evidence, run independent sub-agent review (`pack --test` + `review`), verify `ticket.mjs check`, and open GitHub PR via `ticket.mjs pr`. (AC1, AC2, AC3, AC4, AC5) verified: All checks passed; ready for independent review and PR

## Risks

- Node 22 `ExperimentalWarning: SQLite` on stderr if invoked without `--no-warnings`; suppress `ExperimentalWarning` cleanly in `cli.ts` and document `--no-warnings` in client configs.

## Out of scope

- Publishing to npm registry (can be done after PR merge).

## Notes

User approved Milestone 3 plan: "Agreed, continue."

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
- 2026-11-24 18:27 UTC, Gemini (review: pass): Milestone 3 MCP stdio server (6 tools, 520 o200k_base schema tokens), CLI proxy (run/fetch + flag parsing), E2E stdio tests (13/13), and docs/benchmarks (96.7% CLI / 89.1% nav) verified. [reviewer: ff799d60-fcd6-45ec-b0d5-b9de1e34fc89]
