import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { indexWorkspace } from './ast/indexer.js';
import { ArtifactStore } from './store/artifacts.js';
import { getDefaultDbPath, openDatabase } from './store/db.js';
import { SymbolStore } from './store/symbols.js';
import { fetchChunk } from './tools/fetch-chunk.js';
import { findReferences } from './tools/find-references.js';
import { readSymbols } from './tools/read-symbol.js';
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

interface WorkspaceContext {
  rootDir: string;
  db: DatabaseSync;
  symbolStore: SymbolStore;
  ensureIndexed: () => Promise<void>;
}

/**
 * Creates the Context-Gatekeeper MCP server with 6 low-schema-token tools
 * backed by SQLite FTS5 and incremental Tree-sitter WASM indexing.
 */
export function createGatekeeperServer(
  options: GatekeeperServerOptions = {},
): GatekeeperServerInstance {
  const defaultRoot = resolve(options.rootDir ?? process.cwd());
  const defaultDbPath = options.dbPath ?? getDefaultDbPath(defaultRoot);
  const indexTtlMs = options.indexTtlMs ?? 5_000;

  const db = openDatabase(defaultDbPath);
  const artifactStore = new ArtifactStore(db);

  const workspaces = new Map<string, WorkspaceContext>();

  const createWorkspaceContext = (
    wsRoot: string,
    wsDb: DatabaseSync,
  ): WorkspaceContext => {
    const wsSymbolStore = new SymbolStore(wsDb);
    let lastIndexedAt = 0;
    let inFlightIndex: Promise<void> | null = null;

    const ensureIndexed = async (): Promise<void> => {
      const now = Date.now();
      if (now - lastIndexedAt < indexTtlMs) return;
      if (!inFlightIndex) {
        inFlightIndex = indexWorkspace(wsSymbolStore, wsRoot)
          .then(() => {
            lastIndexedAt = Date.now();
          })
          .finally(() => {
            inFlightIndex = null;
          });
      }
      await inFlightIndex;
    };

    return {
      rootDir: wsRoot,
      db: wsDb,
      symbolStore: wsSymbolStore,
      ensureIndexed,
    };
  };

  const toRootKey = (p: string) =>
    process.platform === 'win32' ? p.toLowerCase() : p;

  const defaultCtx = createWorkspaceContext(defaultRoot, db);
  workspaces.set(toRootKey(defaultRoot), defaultCtx);

  const getWorkspace = (requestedRoot?: string): WorkspaceContext => {
    const target = resolve(requestedRoot ?? defaultRoot);
    const key = toRootKey(target);
    const existing = workspaces.get(key);
    if (existing) return existing;

    const wsDb = openDatabase(getDefaultDbPath(target));
    const ctx = createWorkspaceContext(target, wsDb);
    workspaces.set(key, ctx);
    return ctx;
  };

  const server = new McpServer({
    name: 'context-gatekeeper-mcp',
    version: '0.3.1',
  });

  server.registerTool(
    'run_compact',
    {
      description: 'Run command, index raw output in FTS5, return compact summary + artifact_id.',
      inputSchema: {
        command: z.string(),
        cwd: z.string().optional(),
        timeout_ms: z.number().int().positive().optional(),
        delta: z.boolean().optional(),
      },
    },
    async ({ command, cwd, timeout_ms, delta }) => {
      const res = await runCompact(artifactStore, {
        command,
        cwd: cwd ?? defaultRoot,
        timeoutMs: timeout_ms,
        delta,
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
      description: 'Compact map of indexed files/symbols or FTS5 symbol search via query.',
      inputSchema: {
        path: z.string().optional(),
        depth: z.number().int().min(0).optional(),
        limit: z.number().int().positive().optional(),
        query: z.string().optional(),
        root: z.string().optional(),
      },
    },
    async ({ path, depth, limit, query, root }) => {
      const ws = getWorkspace(root);
      await ws.ensureIndexed();
      const res = repoMap(ws.symbolStore, { path, depth, limit, query });
      return { content: [{ type: 'text', text: res.content }] };
    },
  );

  server.registerTool(
    'symbol_outline',
    {
      description: 'List symbols, signatures, and line ranges in file (no bodies).',
      inputSchema: {
        file: z.string(),
        root: z.string().optional(),
      },
    },
    async ({ file, root }) => {
      const ws = getWorkspace(root);
      await ws.ensureIndexed();
      const res = symbolOutline(ws.symbolStore, { file });
      return { content: [{ type: 'text', text: res.content }] };
    },
  );

  server.registerTool(
    'read_symbol',
    {
      description: 'Read exact body of one or more symbols (Name or Parent.Name).',
      inputSchema: {
        file: z.string(),
        symbol: z.string().optional(),
        symbols: z.array(z.string()).min(1).optional(),
        include_deps: z.boolean().optional(),
        root: z.string().optional(),
      },
    },
    async ({ file, symbol, symbols, include_deps, root }) => {
      const targets = symbols?.length ? symbols : symbol ? [symbol] : [];
      if (targets.length === 0) {
        throw new Error('Provide "symbol" or "symbols".');
      }
      const ws = getWorkspace(root);
      await ws.ensureIndexed();
      const res = readSymbols(ws.symbolStore, {
        rootDir: ws.rootDir,
        file,
        symbols: targets,
        includeDeps: include_deps,
      });
      return {
        content: [{ type: 'text', text: `${res.file}:\n${res.content}` }],
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
        root: z.string().optional(),
      },
    },
    async ({ symbol, limit, root }) => {
      const ws = getWorkspace(root);
      await ws.ensureIndexed();
      const res = findReferences(ws.symbolStore, { symbol, limit });
      return { content: [{ type: 'text', text: res.content }] };
    },
  );

  return {
    server,
    db,
    artifactStore,
    symbolStore: defaultCtx.symbolStore,
    close: () => {
      const closed = new Set<DatabaseSync>();
      for (const ctx of workspaces.values()) {
        if (!closed.has(ctx.db)) {
          ctx.db.close();
          closed.add(ctx.db);
        }
      }
      if (!closed.has(db)) {
        db.close();
      }
    },
  };
}
