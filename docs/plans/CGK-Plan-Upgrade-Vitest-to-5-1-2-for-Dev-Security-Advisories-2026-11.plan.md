---
title: Plan - Chore: Upgrade Vitest to 5.1.2 for Dev Security Advisories
ticket: local://CGK:CGK-Plan-Upgrade-Vitest-to-5-1-2-for-Dev-Security-Advisories-2026-11
status: in-progress
priority: 
state: 
due: 
appetite: S
version: 
impact: 
dependsOn: 
devTicketKey: CGK:CGK-Plan-Upgrade-Vitest-to-5-1-2-for-Dev-Security-Advisories-2026-11
agent: Gemini
branch: chore/upgrade-vitest-5
worktree: Context-Gatekeeper-MCP
startedAt: 2026-11-27
---
# Upgrade Vitest to 5.1.2 for Dev Security Advisories

## Summary

Upgrade devDependency `vitest` from `^3.1.4` to `^5.1.2` in `package.json` and `package-lock.json` to resolve the 3 dev-only `tinypool` / `@vitest/mocker` security advisories reported by Dependabot PRs #12 and #13 (both superseded and closed).

## Context

- `npm audit --omit=dev` already reports 0 production vulnerabilities.
- `npm audit` reported 2 critical (`tinypool <=2.1.1`) and 1 moderate (`@vitest/mocker <=4.1.11`) dev-only advisories resolved by upgrading `vitest` to `^5.1.2`.
- Dependabot PRs #12 and #13 were duplicates and lacked closed-out plans; both were closed in favor of this single planned PR.

## Open questions

None

## Acceptance criteria

- [ ] AC1: `package.json` and `package-lock.json` upgrade `vitest` to `^5.1.2` and `npm audit` reports 0 vulnerabilities.
- [ ] AC2: `npm run typecheck`, `npm run build`, and `npm test` (7/7 test files, 28/28 tests) pass cleanly on Vitest 5.

## Steps

- [ ] Upgrade `vitest` to `^5.1.2` via `npm install -D vitest@^5.1.2` and verify `npm audit` reports 0 vulnerabilities. (AC1)
- [ ] Run `npm run typecheck`, `npm run build`, and `npm test` to confirm zero regressions on Vitest 5. (AC2)
- [ ] Run `adw pack`, complete independent sub-agent review, and merge PR. (AC1, AC2)

## Risks

Vitest 5 is a major version bump from Vitest 3 and could change CLI entrypoints (`./node_modules/vitest/vitest.mjs`) or test runner defaults; mitigated by running `npm test` (all 7 files / 28 tests) and `npm run typecheck` + `npm run build`.

## Out of scope

Changing runtime dependencies (`@modelcontextprotocol/sdk`, `web-tree-sitter`, `tree-sitter-wasms`, `zod`) or source code unless required by Vitest 5 compatibility.

## Notes

User approved ("Do all as recommended.").

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
