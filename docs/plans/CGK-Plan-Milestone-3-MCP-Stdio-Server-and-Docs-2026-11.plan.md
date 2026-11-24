---
title: Plan - Feature: Milestone 3 MCP Stdio Server and Docs
ticket: local://CGK:CGK-Plan-Milestone-3-MCP-Stdio-Server-and-Docs-2026-11
status: in-progress
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
---
# Milestone 3 MCP Stdio Server and Docs

## Summary

Ship the lean MCP stdio server (`src/server.ts`) and executable CLI (`src/cli.ts`) exposing all 6 tools (`run_compact`, `fetch_chunk`, `repo_map`, `symbol_outline`, `read_symbol`, `find_references`) with minimal schema overhead, E2E MCP stdio tests, and `README.md` + `docs/ARCHITECTURE.md` with Windows-safe client configs and measured `o200k_base` benchmarks.

## Context

- Core compression + FTS5 store (Milestone 1) and Tree-sitter WASM indexer + navigation tools (Milestone 2) are merged on `main` (`11/11` tests passing).

## Open questions

None

## Acceptance criteria

- [ ] AC1: MCP stdio server (`src/server.ts` + `src/cli.ts`) exposes all 6 tools with minimal JSON schemas (`< 900` total `o200k_base` tokens for the entire `tools/list` schema payload) and clean stdio (no stdout corruption or SQLite warning noise).
- [ ] AC2: Navigation tools auto-index the workspace incrementally on first call / when stale, and `cli.ts` supports `--root <dir>` and `--db <path>` plus `run` / `fetch` CLI proxy subcommands.
- [ ] AC3: End-to-end MCP stdio test (`test/mcp-server.test.ts`) connects a real MCP client over stdio to the built server, verifying `tools/list` and tool calls across both compression and AST navigation flows on Windows/PowerShell.
- [ ] AC4: `README.md` and `docs/ARCHITECTURE.md` document Windows-safe drop-in MCP config snippets for Claude Code, Codex, Antigravity, and Cursor, architecture overview, and measured `o200k_base` token-savings benchmarks + `TokenHUD` cross-check steps.
- [ ] AC5: `npm run typecheck`, `npm run build`, `npm test`, and `npm run bench` all pass cleanly on Windows/PowerShell, with regular per-step commits and an open GitHub PR via `node scripts/ticket.mjs pr`.

## Steps

- [ ] Install `@modelcontextprotocol/sdk` and `zod`, update `package.json` (`bin`, `main`, `types`, `files`, `pretest`), and commit. (AC1, AC5)
- [ ] Implement `src/server.ts` (6 low-schema-token MCP tools + auto-indexing) and `src/cli.ts` (MCP stdio + `run`/`fetch` CLI proxy), export from `src/index.ts`, and commit. (AC1, AC2)
- [ ] Add E2E MCP stdio test (`test/mcp-server.test.ts`) verifying all 6 tools and `< 900` `o200k_base` schema tokens, and commit. (AC1, AC2, AC3)
- [ ] Write `README.md` and `docs/ARCHITECTURE.md` with Windows-safe client configs (Claude Code, Codex, Antigravity, Cursor), architecture diagram, measured benchmarks, and `TokenHUD` cross-check methodology, and commit. (AC4)
- [ ] Run verification (`typecheck`, `build`, `test`, `bench`), tick all criteria with evidence, run independent sub-agent review (`pack --test` + `review`), verify `ticket.mjs check`, and open GitHub PR via `ticket.mjs pr`. (AC1, AC2, AC3, AC4, AC5)

## Risks

- Node 22 `ExperimentalWarning: SQLite` on stderr if invoked without `--no-warnings`; suppress `ExperimentalWarning` cleanly in `cli.ts` and document `--no-warnings` in client configs.

## Out of scope

- Publishing to npm registry (can be done after PR merge).

## Notes

User approved Milestone 3 plan: "Agreed, continue."

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
