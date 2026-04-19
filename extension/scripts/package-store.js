// Build a clean store-ready zip from extension/dist.
//
// - Strips the developer `key` field (the store assigns its own extension ID).
// - Removes any source maps.
// - Refuses to package if .pem keys are anywhere near the bundle.
// - Writes extension/dist-store/<name>-<version>.zip
//
// Run after `npm run build`:
//   npm run package:store

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = resolve(__dirname, '..');
const distDir = join(extRoot, 'dist');
const stageDir = join(extRoot, 'dist-store', 'stage');
const outDir = join(extRoot, 'dist-store');

if (!existsSync(distDir)) {
  console.error('error: extension/dist not found. Run `npm run build` first.');
  process.exit(1);
}

// Reset stage
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// Copy dist → stage
cpSync(distDir, stageDir, { recursive: true });

// Walk + clean
function walk(dir, fn) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, fn);
    else fn(full);
  }
}

let stripped = 0;
walk(stageDir, (file) => {
  if (file.endsWith('.map')) {
    rmSync(file);
    stripped++;
  }
  if (file.endsWith('.pem') || file.endsWith('.crx')) {
    console.error(`error: refusing to package — found ${file}`);
    process.exit(1);
  }
});

// Sanitize manifest: strip `key` (store assigns extension ID) and any source-map references.
const manifestPath = join(stageDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const hadKey = 'key' in manifest;
delete manifest.key;
delete manifest.update_url; // never set on store builds
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const name = (manifest.name || 'extension').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const version = manifest.version || '0.0.0';
const zipName = `${name}-${version}.zip`;
const zipPath = join(outDir, zipName);
rmSync(zipPath, { force: true });

// Zip via .NET ZipFile on Windows (Compress-Archive silently drops top-level
// files when mixing files + directories), system `zip` elsewhere.
if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${stageDir}', '${zipPath}')`,
    ],
    { stdio: 'inherit' },
  );
} else {
  execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: stageDir, stdio: 'inherit' });
}

console.log('');
console.log(`✓ packaged ${zipName}`);
console.log(`  ${zipPath}`);
console.log(`  manifest.key stripped: ${hadKey}`);
console.log(`  source maps stripped:  ${stripped}`);
console.log('');
console.log('Upload at: https://chrome.google.com/webstore/devconsole');
