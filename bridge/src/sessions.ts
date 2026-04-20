// Single-tab Playwright bind manager.
//
// `playwright-cli attach --extension` is fundamentally single-tab-per-session:
// each new attach REPLACES the prior binding, and tab-list only shows the
// one bound tab. So we model exactly that — one BoundTab at a time.
//
// `bindTab()` mints a fresh sid, kills the prior child if any, spawns a new
// `playwright-cli attach --extension --session=<sid>` (user picks
// the tab via the connect dialog), then polls tab-list until the user clicks
// Connect. The bridge persists the latest binding so the agent can read it
// from disk and the UI can subscribe.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { error, log, warn } from './log.js';
import { boundTabFile, playwrightCwd } from './paths.js';
import { PLAYWRIGHT_CLI } from './config.js';

type BindStatus = 'waiting-for-connect' | 'connected' | 'dead' | 'none';

export interface BoundTab {
  sessionId: string;
  status: BindStatus;
  url: string | null;
  title: string | null;
  hint: string | null;
  attachedAt: string;
  lastSeenAt: string | null;
  chromeTabId: number | null;
  chromeWindowId: number | null;
  markerInjected: boolean;
}

interface RuntimeBinding extends BoundTab {
  child: ChildProcess | null;
  pollTimer: NodeJS.Timeout | null;
}

let current: RuntimeBinding | null = null;
let counter = 0;

const STORE_FILE = boundTabFile();

// playwright-cli auto-creates `.playwright-cli/console-*.log` and dumps the
// stdout of `evaluate "<expr>"` calls into files named after the expression
// (e.g. `1+1`, `{document.title`, `window.__pw_marker`). Pin its cwd to a
// dedicated scratch dir so this junk doesn't pollute whatever directory the
// bridge happens to be launched from. mkdirSync once at module load.
const PLAYWRIGHT_CWD = playwrightCwd();
try { mkdirSync(PLAYWRIGHT_CWD, { recursive: true }); } catch { /* ignore */ }

export function getPlaywrightCwd(): string {
  return PLAYWRIGHT_CWD;
}

export function getBoundTabFile(): string {
  return STORE_FILE;
}

function snapshot(b: RuntimeBinding | null): BoundTab | null {
  if (!b) return null;
  const { child: _c, pollTimer: _t, ...rest } = b;
  return { ...rest };
}

function persist(): void {
  try {
    mkdirSync(dirname(STORE_FILE), { recursive: true });
    writeFileSync(STORE_FILE, JSON.stringify(snapshot(current) ?? {}, null, 2), 'utf8');
  } catch (err) {
    warn('sessions: persist failed', err);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

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

// ---------------- chrome-tab resolver ----------------
interface ResolveOpts { url: string; title: string; useMarker: boolean }
interface ResolveResult {
  tabId?: number; url?: string; title?: string; windowId?: number;
  ambiguous?: boolean; candidates?: number; method?: 'url' | 'marker';
}
type TabResolver = (sessionId: string, opts: ResolveOpts) => Promise<ResolveResult | null>;

let tabResolver: TabResolver | null = null;
export function setTabResolver(fn: TabResolver | null): void { tabResolver = fn; }

async function injectMarker(sessionId: string): Promise<boolean> {
  const expr =
    `() => { try { window.name = 'anya:' + ${JSON.stringify(sessionId)}; } catch {}; ` +
    `try { document.documentElement.setAttribute('data-anya-sid', ${JSON.stringify(sessionId)}); } catch {}; ` +
    `try { sessionStorage.setItem('__anya_sid', ${JSON.stringify(sessionId)}); } catch {}; ` +
    `return 'ok'; }`;
  const r = await runPlaywrightCmd(['eval', expr], sessionId, 8_000);
  return r.ok;
}

async function removeMarker(sessionId: string): Promise<void> {
  const expr =
    `() => { try { window.name = ''; } catch {}; ` +
    `try { document.documentElement.removeAttribute('data-anya-sid'); } catch {}; ` +
    `try { sessionStorage.removeItem('__anya_sid'); } catch {}; ` +
    `return 'ok'; }`;
  await runPlaywrightCmd(['eval', expr], sessionId, 8_000);
}

async function resolveChromeTab(): Promise<void> {
  if (!tabResolver || !current || !current.url) return;
  const sid = current.sessionId;
  const url = current.url;
  const title = current.title ?? '';
  try {
    let found = await tabResolver(sid, { url, title, useMarker: false });
    if (found && typeof found.tabId === 'number') {
      if (current && current.sessionId === sid) {
        current.chromeTabId = found.tabId;
        if (typeof found.windowId === 'number') current.chromeWindowId = found.windowId;
        persist();
        log('sessions: resolved', sid, '→ chromeTabId', found.tabId, '(by url)');
      }
      return;
    }
    if (!found || !found.ambiguous) return;
    const injected = await injectMarker(sid);
    if (current && current.sessionId === sid) {
      current.markerInjected = injected;
      persist();
    }
    if (!injected) return;
    found = await tabResolver(sid, { url, title, useMarker: true });
    if (found && typeof found.tabId === 'number' && current && current.sessionId === sid) {
      current.chromeTabId = found.tabId;
      if (typeof found.windowId === 'number') current.chromeWindowId = found.windowId;
      persist();
      log('sessions: resolved', sid, '→ chromeTabId', found.tabId, '(by marker)');
      await removeMarker(sid);
      if (current && current.sessionId === sid) {
        current.markerInjected = false;
        persist();
      }
    }
  } catch (err) {
    warn('sessions: resolveChromeTab threw', err);
  }
}

function parseTabList(stdout: string): Array<{ index: number; url: string; title: string; current: boolean }> {
  const tabs: Array<{ index: number; url: string; title: string; current: boolean }> = [];
  const lineRe = /^\s*[-*]\s*(\d+):\s*(.*)$/;
  for (const raw of stdout.split(/\r?\n/)) {
    const m = raw.match(lineRe);
    if (!m) continue;
    const index = Number(m[1]);
    let rest = (m[2] ?? '').trim();
    const isCurrent = /\((?:current|active|selected)\)|\[(?:current|active|selected)\]/i.test(rest);
    rest = rest.replace(/\((?:current|active|selected)\)|\[(?:current|active|selected)\]/gi, '').trim();
    let url = ''; let title = '';
    const link = rest.match(/^\[([^\]]*)\]\((\S+?)\)\s*$/);
    if (link) { title = link[1].trim(); url = link[2].trim(); }
    else {
      const um = rest.match(/(https?:\/\/\S+|about:\S+|chrome:\/\/\S+|chrome-extension:\/\/\S+|edge:\/\/\S+|file:\/\/\S+)/);
      if (um) { url = um[1]; title = rest.replace(url, '').replace(/^\s*-\s*/, '').replace(/\s*-\s*$/, '').trim(); }
      else title = rest;
    }
    tabs.push({ index, url, title, current: isCurrent });
  }
  return tabs;
}

async function pollOnce(): Promise<void> {
  if (!current) return;
  const sid = current.sessionId;
  const result = await runPlaywrightCmd(['tab-list'], sid, 8_000);
  if (!current || current.sessionId !== sid) return;
  if (!result.ok) {
    if (current.status === 'connected') {
      current.status = 'dead';
      current.lastSeenAt = nowIso();
      persist();
      log('sessions: bound tab', sid, 'is now dead:', result.stderr.trim().split(/\r?\n/)[0]);
    }
    return;
  }
  const tabs = parseTabList(result.stdout);
  const tab = tabs.find((t) => t.current) ?? tabs[0];
  if (!tab) return;
  const wasWaiting = current.status === 'waiting-for-connect';
  current.url = tab.url || current.url;
  current.title = tab.title || current.title;
  current.status = 'connected';
  current.lastSeenAt = nowIso();
  persist();
  if (wasWaiting) log('sessions: bound', sid, 'connected to', current.url);
  if (tabResolver && current.chromeTabId == null) void resolveChromeTab();
}

function startPolling(): void {
  if (!current || current.pollTimer) return;
  let interval = 1500;
  const mySid = current.sessionId;
  const tick = async () => {
    await pollOnce();
    // Bail if binding was replaced/cleared during the await — prevents orphan
    // ticks from scheduling timers on the new binding.
    if (!current || current.sessionId !== mySid) return;
    interval = current.status === 'connected' ? 8_000 : 2_000;
    current.pollTimer = setTimeout(tick, interval);
  };
  current.pollTimer = setTimeout(tick, interval);
}

function stopPolling(): void {
  if (!current || !current.pollTimer) return;
  clearTimeout(current.pollTimer);
  current.pollTimer = null;
}

// ---------------- public API ----------------
interface BindOptions { hint?: string; browser?: string }

export function bindTab(opts: BindOptions = {}): BoundTab {
  // Replace any prior binding cleanly.
  if (current) {
    const prior = current.sessionId;
    log('sessions: replacing prior binding', prior);
    void unbindTab();
  }
  const sessionId = mintSessionId();
  const browser = opts.browser ?? 'msedge';
  log('sessions: binding session=', sessionId, 'browser=', browser, 'hint=', opts.hint ?? '(none)');
  let child: ChildProcess | null = null;
  try {
    // Ensure no stale token env var interferes with the connect dialog.
    const env = { ...process.env };
    delete env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
    child = spawn(
      PLAYWRIGHT_CLI,
      ['attach', '--extension=' + browser, '--session=' + sessionId],
      { shell: true, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'], cwd: PLAYWRIGHT_CWD },
    );
  } catch (err) {
    error('sessions: spawn failed for', sessionId, err);
  }
  current = {
    sessionId,
    status: 'waiting-for-connect',
    url: null,
    title: null,
    hint: opts.hint ?? null,
    attachedAt: nowIso(),
    lastSeenAt: null,
    chromeTabId: null,
    chromeWindowId: null,
    markerInjected: false,
    child,
    pollTimer: null,
  };
  if (child) {
    child.stdout?.on('data', (b: Buffer) => {
      const s = b.toString('utf8').trim();
      if (s) log('[pw-bind', sessionId + ']', s.split(/\r?\n/)[0]);
    });
    child.stderr?.on('data', (b: Buffer) => {
      const s = b.toString('utf8').trim();
      if (s) warn('[pw-bind', sessionId + ']', s.split(/\r?\n/)[0]);
    });
    child.on('close', (code) => {
      log('sessions: child for', sessionId, 'exited code=', code);
      if (current && current.sessionId === sessionId) {
        current.status = 'dead';
        current.lastSeenAt = nowIso();
        current.child = null;
        persist();
      }
    });
  }
  persist();
  startPolling();
  return snapshot(current)!;
}

export async function unbindTab(): Promise<boolean> {
  if (!current) return false;
  const sid = current.sessionId;
  stopPolling();
  if (current.child && !current.child.killed) {
    try { current.child.kill(); } catch { /* ignore */ }
  }
  void runPlaywrightCmd(['close'], sid, 5_000).catch(() => undefined);
  current = null;
  persist();
  log('sessions: unbound', sid);
  return true;
}

export function getBoundTab(): BoundTab | null {
  return snapshot(current);
}

export function shutdown(): void {
  void unbindTab();
}

export async function loadFromDisk(): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(STORE_FILE, 'utf8');
  } catch {
    return;
  }
  let parsed: BoundTab;
  try {
    parsed = JSON.parse(raw) as BoundTab;
  } catch (err) {
    warn('sessions: parse failed', err);
    return;
  }
  if (!parsed?.sessionId) return;
  // Verify the underlying playwright session is still alive.
  const list = await runPlaywrightCmd(['list'], undefined, 5_000);
  if (!list.ok) return;
  const alive = new Set<string>();
  for (const line of list.stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*(\S+):/);
    if (m) alive.add(m[1]);
  }
  if (!alive.has(parsed.sessionId)) {
    persist();
    return;
  }
  current = {
    ...parsed,
    status: 'connected',
    lastSeenAt: nowIso(),
    chromeTabId: null,
    chromeWindowId: null,
    markerInjected: false,
    child: null,
    pollTimer: null,
  };
  startPolling();
  log('sessions: re-hydrated bound tab', parsed.sessionId);
}

// ==================== CDP mode ====================
// Attaches to the running browser via Chrome DevTools Protocol.
// Unlike extension mode, CDP gives full multi-tab control.

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
