# Workflow Lessons

<!-- Captured via `node scripts/ticket.mjs lesson` or `--retro` on `ship`/`pr`. Surfaced by `recall`, `review --prompt`, and `step --role reviewer`. -->
- 2026-11-26 | bug-fix · docs/plans/CGK-Plan-v0-4-1-Cache-Isolation-and-Clean-Stats-Output-2026-11.plan.md | Isolate test SQLite cache databases via `CGK_CACHE_DIR` in `getCacheDir()` and `test/mcp-server.test.ts` so tests never pollute `%LOCALAPPDATA%\context-gatekeeper\`, hide 0-call DBs from `formatStatsReport()`, and add `p
