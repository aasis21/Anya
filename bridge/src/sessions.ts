// CDP-only Playwright session manager.
//
// Attaches to the running browser via Chrome DevTools Protocol, giving full
// multi-tab control without a connect dialog.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { error, log, warn } from './log.js';
import { playwrightCwd } from './paths.js';
import { PLAYWRIGHT_CLI } from './config.js';

// playwright-cli auto-creates `.playwright-cli/console-*.log` and dumps the
// stdout of `evaluate "<expr>"` calls into files named after the expression.
// Pin its cwd to a dedicated scratch dir so this junk doesn't pollute whatever
// directory the bridge happens to be launched from.
const PLAYWRIGHT_CWD = playwrightCwd();
try { mkdirSync(PLAYWRIGHT_CWD, { recursive: true }); } catch { /* ignore */ }

export function getPlaywrightCwd(): string {
  return PLAYWRIGHT_CWD;
}

let counter = 0;

function mintSessionId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

interface PwResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function runPlaywrightCmd(argv: string[], sessionId?: string, timeoutMs = 30_000): Promise<PwResult> {
  return new Promise((resolve) => {
    const finalArgv = sessionId ? [`-s=${sessionId}`, ...argv] : argv;
    const child = spawn(PLAYWRIGHT_CLI, finalArgv, {
      shell: true, windowsHide: true, env: { ...process.env }, cwd: PLAYWRIGHT_CWD,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const finish = (r: PwResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish({ ok: false, exitCode: null, stdout: Buffer.concat(out).toString('utf8'), stderr: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on('data', (b: Buffer) => out.push(b));
    child.stderr?.on('data', (b: Buffer) => err.push(b));
    child.on('error', (e) => finish({ ok: false, exitCode: null, stdout: '', stderr: e.message }));
    child.on('close', (code) => finish({
      ok: code === 0,
      exitCode: code,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
    }));
  });
}

// ==================== CDP mode ====================

let cdpSessionId: string | null = null;

export async function connectBrowser(browser = 'msedge'): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  // If already connected, return the existing session.
  if (cdpSessionId) {
    const check = await runPlaywrightCmd(['tab-list'], cdpSessionId, 8_000);
    if (check.ok) {
      return { ok: true, sessionId: cdpSessionId };
    }
    // Dead session — clean up and re-attach below.
    cdpSessionId = null;
  }
  const sessionId = mintSessionId();
  const result = await runPlaywrightCmd(
    ['attach', `--cdp=${browser}`, `--session=${sessionId}`],
    undefined,
    15_000,
  );
  if (!result.ok) {
    const stderr = result.stderr.trim();
    if (stderr.includes('DevToolsActivePort') || stderr.includes('remote debugging')) {
      const inspectUrl = browser === 'chrome' || browser === 'chromium'
        ? 'chrome://inspect/#remote-debugging'
        : browser === 'brave'
        ? 'brave://inspect/#remote-debugging'
        : browser === 'vivaldi'
        ? 'vivaldi://inspect/#remote-debugging'
        : 'edge://inspect/#remote-debugging';
      return {
        ok: false,
        error:
          `Remote debugging is not enabled. Call open_tab with url "${inspectUrl}" ` +
          `to open the settings page, then ask the user to check "Allow remote debugging for this ` +
          `browser instance" and retry connect_browser.`,
      };
    }
    return { ok: false, error: `CDP attach failed: ${stderr.split(/\r?\n/)[0]}` };
  }
  cdpSessionId = sessionId;
  log('sessions: CDP connected, session=', sessionId);
  return { ok: true, sessionId };
}

export async function disconnectBrowser(): Promise<boolean> {
  if (!cdpSessionId) return false;
  const sid = cdpSessionId;
  cdpSessionId = null;
  await runPlaywrightCmd(['close'], sid, 5_000).catch(() => undefined);
  log('sessions: CDP disconnected', sid);
  return true;
}

export function getCdpSessionId(): string | null {
  return cdpSessionId;
}

export function isCdpConnected(): boolean {
  return cdpSessionId !== null;
}
