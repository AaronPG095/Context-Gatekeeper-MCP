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
`);
}

async function runCliProxy(
  subcommand: string,
  args: string[],
  rootDir: string,
  dbPath?: string,
): Promise<void> {
  const [{ ArtifactStore }, { getDefaultDbPath, openDatabase }, { fetchChunk }, { runCompact }] =
    await Promise.all([
      import('./store/artifacts.js'),
      import('./store/db.js'),
      import('./tools/fetch-chunk.js'),
      import('./tools/run-compact.js'),
    ]);

  const resolvedDb = dbPath ?? getDefaultDbPath(rootDir);
  const db = openDatabase(resolvedDb);
  const store = new ArtifactStore(db);

  try {
    if (subcommand === 'run') {
      const command = args.join(' ').trim();
      if (!command) {
        printHelp();
        process.exitCode = 1;
        return;
      }
      const res = await runCompact(store, { command, cwd: rootDir });
      console.log(`artifact_id=${res.artifact_id} exit=${res.exit_code} rule=${res.rule}`);
      console.log(res.summary);
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

      const res = fetchChunk(store, {
        artifact_id: artifactId,
        query,
        line_range: lineRange,
        context_lines: contextLines,
      });
      console.log(res.content);
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
