// Reads ~/.anya/config.json. Lets the user set a Playwright MCP extension
// token once (copied from the extension's "connect" dialog) so playwright-cli
// auto-attaches to the user's browser without manual approval.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log, warn } from './log.js';

export interface AnyaConfig {
  /** Token from the Playwright MCP extension connect dialog. */
  playwrightExtensionToken?: string;
}

const CONFIG_DIR = join(homedir(), '.anya');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

let cached: AnyaConfig | null = null;

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function loadConfig(): AnyaConfig {
  if (cached) return cached;
  try {
    if (!existsSync(CONFIG_FILE)) {
      ensureConfigSkeleton();
      cached = {};
      return cached;
    }
    const raw = readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as AnyaConfig;
    cached = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    warn('config load failed:', err);
    cached = {};
  }
  return cached;
}

export function getPlaywrightToken(): string | undefined {
  // Env var takes precedence; falls back to config file.
  const fromEnv = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const tok = loadConfig().playwrightExtensionToken;
  return tok && tok.trim() ? tok.trim() : undefined;
}

function ensureConfigSkeleton(): void {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    const skeleton = {
      // Paste the token shown by the Playwright MCP extension's "connect"
      // dialog (https://playwright.dev/docs/getting-started-mcp). With this
      // set, the bridge spawns playwright-cli with PLAYWRIGHT_MCP_EXTENSION_TOKEN
      // and the extension auto-attaches without prompting.
      playwrightExtensionToken: '',
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(skeleton, null, 2) + '\n', 'utf8');
    log('wrote config skeleton at', CONFIG_FILE);
  } catch (err) {
    warn('could not create config skeleton:', err);
  }
}
