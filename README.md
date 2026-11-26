# Context-Gatekeeper-MCP

A local-first **MCP server + CLI proxy** for coding agents (**Claude Code**, **OpenAI Codex**, **Google Antigravity / Gemini**, and **Cursor**) that cuts token burn by **89–97%** on verbose tool outputs and multi-file code exploration—without sacrificing accuracy.

- **Zero native build dependencies on Windows:** Runs on **Node.js 22+** using built-in `node:sqlite` (FTS5) and `web-tree-sitter` (WASM).
- **Ultra-lean tool surface:** 6 crisp tools totaling **613 `o200k_base` tokens** for the entire `tools/list` schema payload.

---

## The 6 Tools

| Tool | Purpose | Key Inputs |
| :--- | :--- | :--- |
| `run_compact` | Execute command, strip ANSI/noise, index raw output in SQLite FTS5, return compact summary (or delta on repeat runs) + `artifact_id` | `command`, `cwd?`, `timeout_ms?`, `delta?` |
| `fetch_chunk` | Retrieve exact matching lines/stack traces from `artifact_id` via FTS5 search or line range | `artifact_id`, `query?`, `line_range?`, `context_lines?` |
| `repo_map` | Compact structural overview of indexed files & exported symbols (ranked by inbound refs) or FTS5 symbol search via `query` | `path?`, `depth?`, `limit?`, `query?`, `root?` |
| `symbol_outline` | Classes, interfaces, functions, methods, Markdown headings, and `L<start>-L<end>` ranges (no bodies) | `file`, `root?` |
| `read_symbol` | Exact source body of one or more symbols (`symbol` or `symbols[]`), optionally with 1-hop callee signatures (`include_deps`) | `file`, `symbol?`, `symbols?`, `include_deps?`, `root?` |
| `find_references` | Indexed call sites & type references across TS/JS, C#, and Python | `symbol`, `limit?`, `root?` |

---

## Quickstart

```powershell
git clone https://github.com/AaronPG095/Context-Gatekeeper-MCP.git
cd Context-Gatekeeper-MCP
npm install
npm run build
```

### CLI Proxy Mode
```powershell
node --no-warnings dist/src/cli.js run "dotnet build MyApp.sln"
node --no-warnings dist/src/cli.js fetch art_1a2b3c4d --query CS1002 --context 3
```

---

## Drop-In MCP Client Configs (Windows / PowerShell-Safe)

Replace `C:/Users/Aaron/Desktop/CODING/Context-Gatekeeper-MCP` with your clone path (or use `npx -y context-gatekeeper-mcp` once published to npm).

### Antigravity / Gemini (`~/.gemini/config/mcp_config.json`)
```json
{
  "mcpServers": {
    "context-gatekeeper": {
      "command": "node",
      "args": [
        "--no-warnings",
        "C:/Users/Aaron/Desktop/CODING/Context-Gatekeeper-MCP/dist/src/cli.js"
      ]
    }
  }
}
```

### Claude Code (`~/.claude.json` or `.mcp.json`)
```json
{
  "mcpServers": {
    "context-gatekeeper": {
      "command": "node",
      "args": [
        "--no-warnings",
        "C:/Users/Aaron/Desktop/CODING/Context-Gatekeeper-MCP/dist/src/cli.js"
      ]
    }
  }
}
```

### OpenAI Codex (`~/.codex/config.toml`)
```toml
[mcp_servers.context-gatekeeper]
command = "node"
args = ["--no-warnings", "C:/Users/Aaron/Desktop/CODING/Context-Gatekeeper-MCP/dist/src/cli.js"]
```

### Cursor (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "context-gatekeeper": {
      "command": "node",
      "args": [
        "--no-warnings",
        "C:/Users/Aaron/Desktop/CODING/Context-Gatekeeper-MCP/dist/src/cli.js"
      ]
    }
  }
}
```

---

## Measured Token Savings (`gpt-tokenizer` `o200k_base`)

Run `npm run bench` to reproduce synthetic benchmarks, or inspect real-world usage across your repos with:

```powershell
node dist/src/cli.js stats --all --days 7
```

| Scenario | Raw Tokens | Gatekeeper Tokens | Reduction | Diagnostics |
| :--- | ---: | ---: | ---: | :---: |
| `dotnet build` (verbose + 2 errors + 20 warnings) | 5,126 | 248 | **95.2%** | PASS |
| `vitest run` (176 passing + 2 failing) | 3,274 | 125 | **96.2%** | PASS |
| `git diff` (lockfile noise + source hunk) | 5,899 | 105 | **98.2%** | PASS |
| AST Navigation (6-file TS + C# `repo_map` → `symbol_outline` → `read_symbol`) | 5,560 | 608 | **89.1%** | PASS |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture, SQLite schema, and `TokenHUD` cross-check methodology.
