---
title: Plan - Feature: Roadmap and Workflow Sync
ticket: local://CGK:CGK-Plan-Roadmap-and-Workflow-Sync-2026-11
status: in-progress
priority: 
state: 
due: 
appetite: S
version: 
impact: 
dependsOn: 
devTicketKey: CGK:CGK-Plan-Roadmap-and-Workflow-Sync-2026-11
agent: Gemini
branch: gemini/roadmap-and-workflow-sync
worktree: Context-Gatekeeper-MCP
startedAt: 2026-11-25
reviewedBy: Gemini
reviewVerdict: pass
reviewSession: 71b89952-bed9-4c04-9146-c0485ff8555c
baseBranch: main
reviewFingerprint: 5de28d4226ac30ac982d200476214217a14596815df8aa6c4969e15d3b4a0f4b
---
# Roadmap and Workflow Sync

## Summary

Add `docs/ROADMAP.md` capturing prioritized v0.2 / v0.3+ token-efficiency ideas and sync `AGENTS.md` + `scripts/sync.mjs` from `AI-Dev-Workflow` so agents automatically prefer `context-gatekeeper` MCP tools.

## Context

- `AI-Dev-Workflow` PR #54 adds the `Token-lean tools` preference bullet to `renderDevProcessSection`.

## Open questions

None

## Acceptance criteria

- [x] AC1: `docs/ROADMAP.md` documents the prioritized v0.2 candidates (delta re-runs, batched `read_symbol`, graph-ranked `repo_map`, additional grammars/compressors, `PreToolUse` hook interception), v0.3+ intelligence (1-hop `symbol_context`, FTS5 symbol search, JSON/log folding), and workflow/prompt-cache principles. verified: docs/ROADMAP.md documents v0.2, v0.3+, and prompt-cache principles
- [x] AC2: `AGENTS.md` and `scripts/sync.mjs` are synced with `AI-Dev-Workflow` (`sync.mjs --check` exits 0) and `npm test` passes (`15/15`). verified: sync.mjs --check exited 0 and npm test 15/15 passed

## Steps

- [x] Sync `Context-Gatekeeper-MCP` from `AI-Dev-Workflow` (`sync.mjs`) and write `docs/ROADMAP.md`. (AC1, AC2) verified: AGENTS.md + scripts/sync.mjs synced and docs/ROADMAP.md written
- [x] Verify `sync.mjs --check` and `npm test`, tick criteria, run independent review (`pack --test` + `review`), verify `ticket.mjs check`, and ship/merge PR. (AC1, AC2) verified: sync.mjs --check exited 0 and npm test 15/15 passed

## Risks

- None beyond keeping `sync.mjs --check` clean after syncing.

## Out of scope

- Implementing v0.2 features (covered in future plans).

## Notes

User approved roadmap doc and workflow sync: "Do all."

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
- 2026-11-25 11:15 UTC, Gemini (review: pass): AC1 and AC2 satisfied: docs/ROADMAP.md added, AGENTS.md and sync.mjs synced, cli.ts dynamic imports suppress SQLite ExperimentalWarning without --no-warnings, 15/15 tests pass. [reviewer: 71b89952-bed9-4c04-9146-c0485ff8555c]
