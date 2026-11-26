#!/usr/bin/env node
import './suppress-warnings.js';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

function parseGlobalFlags(argv: string[]): {
  rootDir: string;
  dbPath?: string;
  rest: string[];
} {
  let rootDir = process.cwd();
  let dbPath: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1]) {
      rootDir = resolve(argv[++i]);
    } else if (arg === '--db' && argv[i + 1]) {
      dbPath = argv[++i];
    } else {
      rest.push(...argv.slice(i));
      break;
    }
  }
  return { rootDir, dbPath, rest };
}

function printHelp(): void {
  console.error(`context-gatekeeper-mcp — Local-first MCP server & CLI proxy

Usage:
  context-gatekeeper-mcp [--root <dir>] [--db <path>]         Start MCP stdio server
  context-gatekeeper-mcp run <command...>                     Run command & print compact summary
  context-gatekeeper-mcp fetch <artifact_id> [--query <q>] [--range <a..b>] [--context <n>]
  context-gatekeeper-mcp stats [--all] [--days <n>] [--json]  Show local token-savings telemetry
`);
}

async function runStatsCli(
  args: string[],
  rootDir: string,
  dbPath?: string,
): Promise<void> {
  const [{ getDefaultDbPath }, { aggregateStats, formatStatsReport, listCacheDbPaths }] =
    await Promise.all([import('./store/db.js'), import('./store/telemetry.js')]);

  let all = false;
  let json = false;
  let days: number | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--all') all = true;
    else if (arg === '--json') json = true;
    else if (arg === '--days' && args[i + 1]) {
      const parsed = Number(args[++i]);
      if (Number.isFinite(parsed) && parsed > 0) days = parsed;
    }
  }

  const sinceMs = days ? Date.now() - days * 86_400_000 : undefined;
  const targets = all ? listCacheDbPaths() : [dbPath ?? getDefaultDbPath(rootDir)];
  const summary = aggregateStats(targets, { sinceMs });

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatStatsReport(summary));
  }
}

async function runCliProxy(
  subcommand: string,
  args: string[],
  rootDir: string,
  dbPath?: string,
): Promise<void> {
  const [
    { ArtifactStore },
    { getDefaultDbPath, openDatabase },
    { TelemetryStore },
    { fetchChunk },
    { runCompact },
  ] = await Promise.all([
    import('./store/artifacts.js'),
    import('./store/db.js'),
    import('./store/telemetry.js'),
    import('./tools/fetch-chunk.js'),
    import('./tools/run-compact.js'),
  ]);

  const resolvedDb = dbPath ?? getDefaultDbPath(rootDir);
  const db = openDatabase(resolvedDb);
  const store = new ArtifactStore(db);
  const telemetry = new TelemetryStore(db);
  try {
    telemetry.setMeta('root_dir', rootDir);
  } catch {
    // Ignore metadata write failure.
  }

  try {
    if (subcommand === 'run') {
      const command = args.join(' ').trim();
      if (!command) {
        printHelp();
        process.exitCode = 1;
        return;
      }
      const started = Date.now();
      const res = await runCompact(store, { command, cwd: rootDir });
      const header = `artifact_id=${res.artifact_id} exit=${res.exit_code} rule=${res.rule}`;
      console.log(header);
      console.log(res.summary);
      try {
        const rawBytes = store.getArtifact(res.artifact_id)?.raw_bytes ?? header.length + res.summary.length + 1;
        telemetry.recordEvent({
          tool: 'run_compact',
          target: res.rule,
          baselineChars: Math.max(rawBytes, header.length + res.summary.length + 1),
          returnedChars: header.length + res.summary.length + 1,
          durationMs: Date.now() - started,
        });
      } catch {
        // Telemetry must never break CLI proxy.
      }
      process.exitCode = res.exit_code;
      return;
    }

    if (subcommand === 'fetch') {
      const artifactId = args[0];
      if (!artifactId) {
        printHelp();
        process.exitCode = 1;
        return;
      }
      let query: string | undefined;
      let lineRange: string | undefined;
      let contextLines: number | undefined;

      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === '--query' && args[i + 1]) query = args[++i];
        else if (args[i] === '--range' && args[i + 1]) lineRange = args[++i];
        else if (args[i] === '--context' && args[i + 1]) contextLines = Number(args[++i]);
      }

      const started = Date.now();
      const res = fetchChunk(store, {
        artifact_id: artifactId,
        query,
        line_range: lineRange,
        context_lines: contextLines,
      });
      console.log(res.content);
      try {
        const rawBytes = store.getArtifact(artifactId)?.raw_bytes ?? res.content.length;
        telemetry.recordEvent({
          tool: 'fetch_chunk',
          target: res.mode,
          baselineChars: Math.max(rawBytes, res.content.length),
          returnedChars: res.content.length,
          durationMs: Date.now() - started,
        });
      } catch {
        // Telemetry must never break CLI proxy.
      }
      return;
    }

    printHelp();
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const { rootDir, dbPath, rest } = parseGlobalFlags(process.argv.slice(2));
  const sub = rest[0];

  if (sub === '--help' || sub === '-h') {
    printHelp();
    return;
  }

  if (sub === 'stats') {
    await runStatsCli(rest.slice(1), rootDir, dbPath);
    return;
  }

  if (sub === 'run' || sub === 'fetch') {
    await runCliProxy(sub, rest.slice(1), rootDir, dbPath);
    return;
  }

  if (sub !== undefined && sub !== 'serve') {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const { createGatekeeperServer } = await import('./server.js');
  const instance = createGatekeeperServer({ rootDir, dbPath });
  const transport = new StdioServerTransport();
  const shutdown = () => {
    instance.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await instance.server.connect(transport);
}

void main();
