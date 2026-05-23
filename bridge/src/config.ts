// Config loader for ~/.anya/config.json.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface AnyaConfig {
  [key: string]: unknown;
}

const CONFIG_FILE = join(homedir(), '.anya', 'config.json');

let cached: AnyaConfig | null = null;

export function getConfigPath(): string {
  return CONFIG_FILE;
}

function loadConfig(): AnyaConfig {
  if (cached) return cached;
  try {
    if (!existsSync(CONFIG_FILE)) { cached = {}; return cached; }
    const raw = readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cached = parsed && typeof parsed === 'object' ? parsed as AnyaConfig : {};
  } catch {
    cached = {};
  }
  return cached;
}

export const PLAYWRIGHT_CLI = process.env.ANYA_PLAYWRIGHT_CLI ?? 'playwright-cli';
