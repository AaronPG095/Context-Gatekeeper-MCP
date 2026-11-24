---
title: Plan - Feature: Milestone 2 Tree-sitter Indexer and Symbol Tools
ticket: local://CGK:CGK-Plan-Milestone-2-Tree-sitter-Indexer-and-Symbol-Tools-2026-11
status: in-progress
priority: 
state: 
due: 
appetite: L
version: 
impact: 
dependsOn: 
devTicketKey: CGK:CGK-Plan-Milestone-2-Tree-sitter-Indexer-and-Symbol-Tools-2026-11
agent: Gemini
branch: gemini/milestone-2-tree-sitter-indexer-and-symbol-tools
worktree: Context-Gatekeeper-MCP
startedAt: 2026-11-24
reviewedBy: Gemini
reviewVerdict: pass
reviewSession: c5b7bdf5-9ae2-4f20-9384-5739e88b7816
baseBranch: main
reviewFingerprint: 9a58ddc6a23a179c33a1c90c6ecdc1b80cdb67112add9b21fec70bb5a89886e8
---
# Milestone 2 Tree-sitter Indexer and Symbol Tools

## Summary

Implement Milestone 2 of Context-Gatekeeper-MCP: incremental `web-tree-sitter` WASM AST indexer (TypeScript/JavaScript/TSX and C#), SQLite `files`/`symbols`/`symbol_refs` schema & store, `repo_map`, `symbol_outline`, `read_symbol`, and `find_references` tools, tests, and a multi-file navigation `o200k_base` token benchmark.

## Context

- Zero native addons on Windows: uses `web-tree-sitter` WASM + `tree-sitter-wasms` prebuilt `.wasm` grammars on Node.js 22+ with `node:sqlite`.

## Open questions

None

## Acceptance criteria

- [x] AC1: Incremental `web-tree-sitter` WASM indexer indexes TypeScript/JavaScript and C# files into SQLite (`files`, `symbols`, `symbol_refs`), skips unchanged files on re-index (`mtime_ms`/`sha256`), respects `.gitignore` + default ignores (`node_modules`, `dist`, `bin`, `obj`), and prunes deleted files. verified: test/ast.test.ts verified TS+C# indexing, mtime/sha256 skip, .gitignore/default ignores, and pruning
- [x] AC2: `repo_map(path?, depth?)` returns a compact structural overview of indexed files and top-level exported symbols with line counts. verified: test/nav-tools.test.ts verified repoMap with path and depth filtering
- [x] AC3: `symbol_outline(file)` returns classes, interfaces, functions, methods, signatures, and `L<start>-L<end>` ranges without bodies, and `read_symbol(file, symbol)` returns the exact symbol body (supporting both `Name` and `Parent.Name`). verified: test/nav-tools.test.ts verified symbolOutline (no bodies) and readSymbol (Name and Parent.Name)
- [x] AC4: `find_references(symbol)` returns indexed call sites / references across the repo with `rel_path:L<line>` and code snippets. verified: test/nav-tools.test.ts verified findReferences cross-file hits with rel_path:L<line>
- [x] AC5: Navigation benchmark (`npm run bench`) measures `o200k_base` tokens for full-file reads vs. `repo_map` -> `symbol_outline` -> `read_symbol` on a multi-file TS + C# fixture, achieving `>= 70%` token reduction, and `npm run typecheck`, `npm run build`, and `npm test` all pass on Windows/PowerShell. verified: npm run bench: 89.1% reduction (5560 -> 608 o200k_base tokens); typecheck/build/test 11/11 passed

## Steps

- [x] Install `web-tree-sitter` and `tree-sitter-wasms` runtime dependencies. (AC1) verified: web-tree-sitter@0.24.7 + tree-sitter-wasms@0.1.13 loaded ts/tsx/js/c_sharp WASM cleanly
- [x] Extend SQLite schema (`src/store/db.ts`) with `files`, `symbols`, `symbol_refs` and implement `SymbolStore` (`src/store/symbols.ts`). (AC1, AC2, AC3, AC4) verified: files/symbols/symbol_refs DDL + SymbolStore implemented
- [x] Implement `web-tree-sitter` WASM parser loader (`src/ast/parser.ts`), TS/JS + C# symbol/reference extractor (`src/ast/extract.ts`), and `.gitignore`-aware incremental indexer (`src/ast/indexer.ts`). (AC1) verified: parser.ts, extract.ts, and indexer.ts implemented
- [x] Implement `repoMap`, `symbolOutline`, `readSymbol`, and `findReferences` tools (`src/tools/{repo-map,symbol-outline,read-symbol,find-references}.ts`) and export from `src/index.ts`. (AC2, AC3, AC4) verified: repoMap, symbolOutline, readSymbol, findReferences implemented and exported
- [x] Add unit/integration tests (`test/ast.test.ts`, `test/nav-tools.test.ts`) and multi-file navigation token benchmark (`benchmarks/nav-bench.ts` wired into `benchmarks/run.ts`). (AC1, AC2, AC3, AC4, AC5) verified: test/ast.test.ts, test/nav-tools.test.ts, and benchmarks/nav-bench.ts added
- [x] Run verification (`typecheck`, `build`, `test`, `bench`), tick all criteria with evidence, run independent sub-agent review (`pack --test` + `review`), verify `ticket.mjs check`, and open GitHub PR via `ticket.mjs pr`. (AC1, AC2, AC3, AC4, AC5) verified: typecheck, build, test (11/11), and bench (89.1% nav reduction) passed

## Risks

- Potential WASM ABI version mismatch between `web-tree-sitter` and `tree-sitter-wasms` grammars (verified during Step 1).

## Out of scope

- Milestone 3 (MCP stdio server transport, CLI entrypoint, client configs, and `ARCHITECTURE.md`).

## Notes

User approved Milestone 2 plan: "Agreed."

## Progress log

<!-- One line per session/review, added with `ticket.mjs log` or `ticket.mjs review` -->
- 2026-11-24 18:13 UTC, Gemini (review: pass): Milestone 2 satisfies all 5 acceptance criteria and passes typecheck, test (11/11), and bench (89.1% nav token reduction, 5560 -> 608 o200k_base tokens), with WASM Parser cleanup, TS method body isolation, path/LIKE escaping, and sha256/unqualified-Name test coverage verified. [reviewer: c5b7bdf5-9ae2-4f20-9384-5739e88b7816]
