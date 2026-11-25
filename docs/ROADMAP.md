# Roadmap — Context-Gatekeeper-MCP

Prioritized token-efficiency improvements beyond **v0.1.1**.

---

## v0.2 — High-ROI Token Multipliers

1. **Delta-Only Re-Runs (`run_compact`)**
   - Compare repeat `dotnet build` / `vitest` runs against the previous artifact for the same command and return only the diff (`Resolved: CS1002 | Remaining: CS0246 | New: 0`), cutting iterative debug-loop tokens by ~50–80%.
2. **Batched Symbol Reads (`read_symbol`)**
   - Accept an array of symbol targets (e.g., `["Auth.login", "Auth.verify"]`) in a single tool call to eliminate extra conversation round-trips.
3. **Graph-Ranked `repo_map`**
   - Rank files by inbound `symbol_refs` count + git recency (`git log -n 20`) instead of alphabetical order so large repos surface only the most central files within budget.
4. **Additional Grammars & Compressors (Zero New Native Deps)**
   - Grammars already bundled in `tree-sitter-wasms`: **Markdown** (heading outline + `read_section`), **Python**, **PowerShell**, **Go**, **Rust**.
   - Compressors: `tsc`, `eslint` / `biome`, `pytest`, `cargo test`, `docker build`.
5. **Pre-Tool Hook Interception (`PreToolUse`)**
   - Route raw shell `dotnet` / `vitest` / `git diff` commands through `context-gatekeeper-mcp run` automatically in Claude Code / Antigravity hooks so verbose output never leaks into context.

---

## v0.3+ — Deeper Context-Selection Intelligence

1. **1-Hop Dependency Context (`symbol_context`)**
   - Return a symbol's body plus only the 1-line signatures (no bodies) of the types/functions it calls, eliminating follow-up lookup turns.
2. **FTS5 Symbol & Docstring Search**
   - Index symbol names, signatures, and docstrings in SQLite FTS5 so agents can jump directly from a concept (e.g. `"JWT expiry"`) to `file:symbol`.
3. **Structured JSON / Log Folding**
   - Collapse repetitive JSON arrays and API dumps into `{ schema, count, sample[0] }` + `artifact_id` for `fetch_chunk`.

---

## Workflow & Prompt-Cache Principles

- **Deterministic Outputs:** Keep `AGENTS.md`, tool schemas (`546` `o200k_base` tokens), and `repo_map` output strictly deterministic (no volatile timestamps) to maximize LLM prompt-cache hit rates.
- **Compact Plain-Text Tool Formats:** Return terse line-oriented output (`file:L5 | snippet`) rather than indented JSON.
- **Model Tiering & Milestone Compaction:** Isolate noisy audits/reviews in lighter-model subagents and use `ticket.mjs handoff` + `/compact` between milestones.
