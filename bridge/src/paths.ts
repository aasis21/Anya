// Cross-platform path resolver for Anya bridge.
//
// All on-disk state (logs, sessions, bound-tab.json, the playwright cwd)
// lives under a single per-OS data directory:
//
//   Windows : %LOCALAPPDATA%\Anya
//   macOS   : ~/Library/Application Support/Anya
//   Linux   : ${XDG_DATA_HOME:-~/.local/share}/Anya
//
// Falls back to the system temp dir if the home/appdata lookup fails so
// the bridge never crashes on first call — callers can still write, the
// data just won't survive reboots.

import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_NAME = 'Anya';

let cached: string | null = null;

export function dataDir(): string {
  if (cached) return cached;
  cached = computeDataDir();
  return cached;
}

function computeDataDir(): string {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) return join(local, APP_NAME);
    const profile = process.env.USERPROFILE;
    if (profile) return join(profile, 'AppData', 'Local', APP_NAME);
  } else if (process.platform === 'darwin') {
    const home = homedir();
    if (home) return join(home, 'Library', 'Application Support', APP_NAME);
  } else {
    // Linux + every other POSIX
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg) return join(xdg, APP_NAME);
    const home = homedir();
    if (home) return join(home, '.local', 'share', APP_NAME);
  }
  return join(tmpdir(), APP_NAME);
}

export function sessionsDir(): string {
  return join(dataDir(), 'sessions');
}

export function playwrightCwd(): string {
  return join(dataDir(), 'playwright');
}

export function boundTabFile(): string {
  return join(dataDir(), 'bound-tab.json');
}

export function logFile(): string {
  return join(dataDir(), 'bridge.log');
}
