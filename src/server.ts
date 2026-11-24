import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { indexWorkspace } from './ast/indexer.js';
import { ArtifactStore } from './store/artifacts.js';
import { DEFAULT_DB_REL_PATH, openDatabase } from './store/db.js';
import { SymbolStore } from './store/symbols.js';
import { fetchChunk } from './tools/fetch-chunk.js';
import { findReferences } from './tools/find-references.js';
import { readSymbol } from './tools/read-symbol.js';
import { repoMap } from './tools/repo-map.js';
import { runCompact } from './tools/run-compact.js';
import { symbolOutline } from './tools/symbol-outline.js';

export interface GatekeeperServerOptions {
  rootDir?: string;
  dbPath?: string;
  indexTtlMs?: number;
}

export interface GatekeeperServerInstance {
  server: McpServer;
  db: DatabaseSync;
  artifactStore: ArtifactStore;
  symbolStore: SymbolStore;
  close: () => void;
}

/**
 * Creates the Context-Gatekeeper MCP server with 6 low-schema-token tools
 * backed by SQLite FTS5 and incremental Tree-sitter WASM indexing.
 */
export function createGatekeeperServer(
  options: GatekeeperServerOptions = {},
): GatekeeperServerInstance {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const dbPath = options.dbPath ?? resolve(rootDir, DEFAULT_DB_REL_PATH);
  const indexTtlMs = options.indexTtlMs ?? 5_000;

  const db = openDatabase(dbPath);
  const artifactStore = new ArtifactStore(db);
  const symbolStore = new SymbolStore(db);

  let lastIndexedAt = 0;
  let inFlightIndex: Promise<void> | null = null;

  const ensureIndexed = async (): Promise<void> => {
    const now = Date.now();
    if (now - lastIndexedAt < indexTtlMs) return;
    if (!inFlightIndex) {
      inFlightIndex = indexWorkspace(symbolStore, rootDir)
        .then(() => {
          lastIndexedAt = Date.now();
        })
        .finally(() => {
          inFlightIndex = null;
        });
    }
    await inFlightIndex;
  };

  const server = new McpServer({
    name: 'context-gatekeeper-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'run_compact',
    {
      description: 'Run command, index raw output in FTS5, return compact summary + artifact_id.',
      inputSchema: {
        command: z.string(),
        cwd: z.string().optional(),
        timeout_ms: z.number().int().positive().optional(),
      },
    },
    async ({ command, cwd, timeout_ms }) => {
      const res = await runCompact(artifactStore, {
        command,
        cwd: cwd ?? rootDir,
        timeoutMs: timeout_ms,
      });
      return {
        content: [
          {
            type: 'text',
            text: `artifact_id=${res.artifact_id} exit=${res.exit_code} rule=${res.rule} lines=${res.raw_lines}->${res.summary_lines}\n${res.summary}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'fetch_chunk',
    {
      description: 'Fetch raw lines from artifact_id by FTS5 query or line_range (e.g. "10-40").',
      inputSchema: {
        artifact_id: z.string(),
        query: z.string().optional(),
        line_range: z.string().optional(),
        context_lines: z.number().int().min(0).optional(),
      },
    },
    ({ artifact_id, query, line_range, context_lines }) => {
      const res = fetchChunk(artifactStore, {
        artifact_id,
        query,
        line_range,
        context_lines,
      });
      return {
        content: [
          {
            type: 'text',
            text: `[${res.artifact_id} mode=${res.mode} lines=${res.returned_lines}/${res.total_lines}]\n${res.content}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'repo_map',
    {
      description: 'Compact map of indexed files and exported symbols.',
      inputSchema: {
        path: z.string().optional(),
        depth: z.number().int().min(0).optional(),
      },
    },
    async ({ path, depth }) => {
      await ensureIndexed();
      const res = repoMap(symbolStore, { path, depth });
      return { content: [{ type: 'text', text: res.content }] };
    },
  );

  server.registerTool(
    'symbol_outline',
    {
      description: 'List symbols, signatures, and line ranges in file (no bodies).',
      inputSchema: {
        file: z.string(),
      },
    },
    async ({ file }) => {
      await ensureIndexed();
      const res = symbolOutline(symbolStore, { file });
      return { content: [{ type: 'text', text: res.content }] };
    },
  );

  server.registerTool(
    'read_symbol',
    {
      description: 'Read exact source body of one symbol (Name or Parent.Name).',
      inputSchema: {
        file: z.string(),
        symbol: z.string(),
      },
    },
    async ({ file, symbol }) => {
      await ensureIndexed();
      const res = readSymbol(symbolStore, { rootDir, file, symbol });
      return {
        content: [
          {
            type: 'text',
            text: `${res.file} (${res.symbol} L${res.start_line}-L${res.end_line}):\n${res.content}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'find_references',
    {
      description: 'Find indexed call sites and type references for symbol.',
      inputSchema: {
        symbol: z.string(),
        limit: z.number().int().positive().optional(),
      },
    },
    async ({ symbol, limit }) => {
      await ensureIndexed();
      const res = findReferences(symbolStore, { symbol, limit });
      return { content: [{ type: 'text', text: res.content }] };
    },
  );

  return {
    server,
    db,
    artifactStore,
    symbolStore,
    close: () => {
      db.close();
    },
  };
}
