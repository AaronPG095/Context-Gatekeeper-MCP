# Roadmap — Context-Gatekeeper-MCP

Prioritized token-efficiency improvements beyond **v0.1.1**.

---

## Shipped (`v0.2.0` – `v0.5.0`)

- **v0.2.0:** Delta-only re-runs (`run_compact` `delta`), batched `read_symbol` (`symbols[]`), `inbound_refs`-ranked `repo_map` (`limit`), Python & Markdown indexing.
- **v0.3.0 / v0.3.1:** 1-hop dependency context (`include_deps`), `symbols_fts` search (`repo_map(query)`), `tsc` / `eslint` / `biome` / `pytest` compressors, JSON array folding.
- **v0.4.0 / v0.4.1:** 100% local SQLite `tool_events` telemetry across all 6 tools, `stats [--all] [--days <n>] [--json] [--prune]` CLI, and `CGK_CACHE_DIR` test isolation.
- **v0.5.0:** Workspace-attributed `run_compact` & `fetch_chunk` telemetry, `EBUSY`-safe `stats --prune`, zero-bloat short-output pass-through in `generic`, quote- & chain-aware `selectRule()`, `fetch_chunk` `max_lines` safety cap (`120`), and multi-file `git diff` inline budget (`80` lines).

---

## Remaining / Future Candidates

1. **Pre-Tool Hook Interception (`PreToolUse`)**
   - Route raw shell `dotnet` / `vitest` / `git diff` commands through `context-gatekeeper-mcp run` automatically in client hooks so verbose output never leaks into context.
2. **Git-Recency Ranking in `repo_map`**
   - Blend `inbound_refs` with `git log -n 20` recency so actively edited files surface first.
3. **Additional Grammars & Compressors (Zero New Native Deps)**
   - Grammars already bundled in `tree-sitter-wasms`: **PowerShell**, **Go**, **Rust**.
   - Compressors: `cargo test`, `docker build`.

---

## Workflow & Prompt-Cache Principles

- **Deterministic Outputs:** Keep `AGENTS.md`, tool schemas (`546` `o200k_base` tokens), and `repo_map` output strictly deterministic (no volatile timestamps) to maximize LLM prompt-cache hit rates.
- **Compact Plain-Text Tool Formats:** Return terse line-oriented output (`file:L5 | snippet`) rather than indented JSON.
- **Model Tiering & Milestone Compaction:** Isolate noisy audits/reviews in lighter-model subagents and use `ticket.mjs handoff` + `/compact` between milestones.
