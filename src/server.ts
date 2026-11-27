import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { indexWorkspace } from './ast/indexer.js';
import { ArtifactStore } from './store/artifacts.js';
import { getDefaultDbPath, openDatabase } from './store/db.js';
import { SymbolStore } from './store/symbols.js';
import {
  type RecordToolEventInput,
  TelemetryStore,
} from './store/telemetry.js';
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
  telemetryStore: TelemetryStore;
  close: () => void;
}

interface WorkspaceContext {
  rootDir: string;
  db: DatabaseSync;
  artifactStore: ArtifactStore;
  symbolStore: SymbolStore;
  telemetryStore: TelemetryStore;
  ensureIndexed: () => Promise<void>;
}

function safeRecord(telemetry: TelemetryStore, input: RecordToolEventInput): void {
  try {
    telemetry.recordEvent(input);
  } catch {
    // Telemetry must never break tool execution.
  }
}

function safeFileSize(rootDir: string, relFile: string): number {
  try {
    return statSync(resolve(rootDir, relFile)).size;
  } catch {
    return 0;
  }
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
  const workspaces = new Map<string, WorkspaceContext>();
  const artifactOwners = new Map<string, WorkspaceContext>();

  const createWorkspaceContext = (
    wsRoot: string,
    wsDb: DatabaseSync,
  ): WorkspaceContext => {
    const wsArtifactStore = new ArtifactStore(wsDb);
    const wsSymbolStore = new SymbolStore(wsDb);
    const wsTelemetryStore = new TelemetryStore(wsDb);
    try {
      wsTelemetryStore.setMeta('root_dir', wsRoot);
    } catch {
      // Ignore metadata write failure.
    }
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
      artifactStore: wsArtifactStore,
      symbolStore: wsSymbolStore,
      telemetryStore: wsTelemetryStore,
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

  const resolveArtifactWorkspace = (artifactId: string): WorkspaceContext => {
    const tracked = artifactOwners.get(artifactId);
    if (tracked) return tracked;
    if (defaultCtx.artifactStore.getArtifact(artifactId)) return defaultCtx;
    for (const ctx of workspaces.values()) {
      if (ctx !== defaultCtx && ctx.artifactStore.getArtifact(artifactId)) {
        artifactOwners.set(artifactId, ctx);
        return ctx;
      }
    }
    return defaultCtx;
  };

  const server = new McpServer({
    name: 'context-gatekeeper-mcp',
    version: '0.5.0',
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
      const started = Date.now();
      const ws = getWorkspace(cwd);
      const res = await runCompact(ws.artifactStore, {
        command,
        cwd: ws.rootDir,
        timeoutMs: timeout_ms,
        delta,
      });
      artifactOwners.set(res.artifact_id, ws);
      const text = `artifact_id=${res.artifact_id} exit=${res.exit_code} rule=${res.rule} lines=${res.raw_lines}->${res.summary_lines}\n${res.summary}`;
      const rawBytes = ws.artifactStore.getArtifact(res.artifact_id)?.raw_bytes ?? text.length;
      safeRecord(ws.telemetryStore, {
        tool: 'run_compact',
        target: res.rule,
        baselineChars: Math.max(rawBytes, text.length),
        returnedChars: text.length,
        durationMs: Date.now() - started,
      });
      return {
        content: [{ type: 'text', text }],
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
        max_lines: z.number().int().positive().optional(),
      },
    },
    ({ artifact_id, query, line_range, context_lines, max_lines }) => {
      const started = Date.now();
      const ws = resolveArtifactWorkspace(artifact_id);
      const res = fetchChunk(ws.artifactStore, {
        artifact_id,
        query,
        line_range,
        context_lines,
        max_lines,
      });
      const text = `[${res.artifact_id} mode=${res.mode} lines=${res.returned_lines}/${res.total_lines}]\n${res.content}`;
      const rawBytes = ws.artifactStore.getArtifact(artifact_id)?.raw_bytes ?? text.length;
      safeRecord(ws.telemetryStore, {
        tool: 'fetch_chunk',
        target: res.mode,
        baselineChars: Math.max(rawBytes, text.length),
        returnedChars: text.length,
        durationMs: Date.now() - started,
      });
      return {
        content: [{ type: 'text', text }],
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
      const started = Date.now();
      const ws = getWorkspace(root);
      await ws.ensureIndexed();
      const res = repoMap(ws.symbolStore, { path, depth, limit, query });
      safeRecord(ws.telemetryStore, {
        tool: 'repo_map',
        target: query ? `query:${query}` : (path ?? '.'),
        baselineChars: res.content.length,
        returnedChars: res.content.length,
        durationMs: Date.now() - started,
      });
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
      const started = Date.now();
      const ws = getWorkspace(root);
      await ws.ensureIndexed();
      const res = symbolOutline(ws.symbolStore, { file });
      safeRecord(ws.telemetryStore, {
        tool: 'symbol_outline',
        target: res.file,
        baselineChars: Math.max(safeFileSize(ws.rootDir, res.file), res.content.length),
        returnedChars: res.content.length,
        durationMs: Date.now() - started,
      });
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
      const started = Date.now();
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
      const text = `${res.file}:\n${res.content}`;
      safeRecord(ws.telemetryStore, {
        tool: 'read_symbol',
        target: `${res.file}:${targets.join(',')}`,
        baselineChars: Math.max(safeFileSize(ws.rootDir, res.file), text.length),
        returnedChars: text.length,
        durationMs: Date.now() - started,
      });
      return {
        content: [{ type: 'text', text }],
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
      const started = Date.now();
      const ws = getWorkspace(root);
      await ws.ensureIndexed();
      const res = findReferences(ws.symbolStore, { symbol, limit });
      safeRecord(ws.telemetryStore, {
        tool: 'find_references',
        target: symbol,
        baselineChars: res.content.length,
        returnedChars: res.content.length,
        durationMs: Date.now() - started,
      });
      return { content: [{ type: 'text', text: res.content }] };
    },
  );

  return {
    server,
    db,
    artifactStore: defaultCtx.artifactStore,
    symbolStore: defaultCtx.symbolStore,
    telemetryStore: defaultCtx.telemetryStore,
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
