import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type Level = 'info' | 'warn' | 'error';

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

function format(level: Level, args: unknown[]): string {
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
  return `[${ts}] [${level}] ${parts.join(' ')}`;
}

function emit(level: Level, args: unknown[]): void {
  const line = format(level, args);
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
