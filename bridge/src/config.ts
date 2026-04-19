// Config path helper. The config file lives at ~/.anya/config.json.

import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_FILE = join(homedir(), '.anya', 'config.json');

export function getConfigPath(): string {
  return CONFIG_FILE;
}
