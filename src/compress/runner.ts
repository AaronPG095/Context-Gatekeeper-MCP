import { spawn } from 'node:child_process';
import type { OutputLine, OutputStream } from '../store/artifacts.js';

export interface RunCommandOptions {
  cwd?: string;
  timeoutMs?: number;
}

export interface RunCommandResult {
  command: string;
  cwd: string;
  exitCode: number;
  durationMs: number;
  lines: OutputLine[];
}

// Matches ANSI CSI, OSC, and 2-byte ESC sequences.
const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b](?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

/**
 * Strips ANSI escape sequences, normalizes CRLF to LF, and resolves `\r`
 * carriage-return progress-bar overwrites to the final segment per line.
 */
export function stripAnsi(input: string): string {
  const noAnsi = input.replace(ANSI_REGEX, '').replace(/\r\n/g, '\n');
  const rawLines = noAnsi.split('\n');
  const normalized = rawLines.map((line) => {
    if (!line.includes('\r')) return line;
    const parts = line.split('\r');
    return parts[parts.length - 1] ?? '';
  });
  return normalized.join('\n');
}

/**
 * Executes a shell command cleanly on Windows (PowerShell) and POSIX (`/bin/sh`),
 * normalizing ANSI/CR noise and returning ordered stdout/stderr lines.
 */
export async function runCommand(
  command: string,
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const startedAt = Date.now();

  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'powershell.exe' : '/bin/sh';
  const args = isWindows
    ? ['-NoProfile', '-NonInteractive', '-Command', command]
    : ['-c', command];

  return new Promise<RunCommandResult>((resolve, reject) => {
    const child = spawn(shell, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const lines: OutputLine[] = [];
    const remainders: Record<OutputStream, string> = { stdout: '', stderr: '' };
    let timedOut = false;

    const pushChunk = (stream: OutputStream, raw: string) => {
      const text = stripAnsi(remainders[stream] + raw);
      const parts = text.split('\n');
      remainders[stream] = parts.pop() ?? '';
      for (const part of parts) {
        lines.push({ stream, text: part });
      }
    };

    child.stdout.on('data', (chunk: Buffer) => pushChunk('stdout', chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => pushChunk('stderr', chunk.toString('utf8')));

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killTree(child.pid);
          }, timeoutMs)
        : undefined;

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      for (const stream of ['stdout', 'stderr'] as const) {
        if (remainders[stream].length > 0) {
          lines.push({ stream, text: remainders[stream] });
        }
      }
      if (timedOut) {
        lines.push({
          stream: 'stderr',
          text: `[context-gatekeeper] Command timed out after ${timeoutMs}ms`,
        });
      }
      resolve({
        command,
        cwd,
        exitCode: timedOut ? 124 : (code ?? 1),
        durationMs: Date.now() - startedAt,
        lines,
      });
    });
  });
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process already exited.
    }
  }
}
