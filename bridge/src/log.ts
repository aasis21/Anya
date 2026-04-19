import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type Level = 'info' | 'warn' | 'error';

export type LogSink = (entry: { ts: string; level: Level; message: string }) => void;

let sink: LogSink | null = null;
let inSink = false;

export function setLogSink(fn: LogSink | null): void {
  sink = fn;
}

const logFilePath: string | null = (() => {
  const base = process.env.LOCALAPPDATA;
  if (!base) return null;
  try {
    const dir = join(base, 'AgentEdge');
    mkdirSync(dir, { recursive: true });
    return join(dir, 'bridge.log');
  } catch {
    return null;
  }
})();

export function getLogFilePath(): string | null {
  return logFilePath;
}

function format(level: Level, args: unknown[]): { ts: string; line: string; message: string } {
  const ts = new Date().toISOString();
  const parts = args.map((a) => {
    if (a instanceof Error) return a.stack ?? a.message;
    if (typeof a === 'string') return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  });
  const message = parts.join(' ');
  return { ts, line: `[${ts}] [${level}] ${message}`, message };
}

function emit(level: Level, args: unknown[]): void {
  const { ts, line, message } = format(level, args);
  try {
    process.stderr.write(line + '\n');
  } catch {
    // best effort
  }
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, line + '\n', 'utf8');
    } catch {
      // ignore logfile failures
    }
  }
  if (sink && !inSink) {
    inSink = true;
    try {
      sink({ ts, level, message });
    } catch {
      // never let a sink failure break the bridge
    } finally {
      inSink = false;
    }
  }
}

export function log(...args: unknown[]): void {
  emit('info', args);
}

export function warn(...args: unknown[]): void {
  emit('warn', args);
}

export function error(...args: unknown[]): void {
  emit('error', args);
}
