// Generates placeholder PNG icons (16/48/128) for the AgentEdge extension.
// Solid Edge-blue (#0078D4) background with a white "A" glyph.
//
// Pure-Node implementation using `pngjs` (devDep). No browser/canvas needed.

import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICON_DIR = resolve(__dirname, '..', 'public', 'icons');

const BG = { r: 0x00, g: 0x78, b: 0xd4, a: 0xff };
const FG = { r: 0xff, g: 0xff, b: 0xff, a: 0xff };

// 5x7 bitmap of the letter "A" (1 = foreground).
const GLYPH_A = [
  [0, 1, 1, 1, 0],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
];
const GLYPH_W = 5;
const GLYPH_H = 7;

function setPixel(png, x, y, c) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  png.data[idx] = c.r;
  png.data[idx + 1] = c.g;
  png.data[idx + 2] = c.b;
  png.data[idx + 3] = c.a;
}

function makeIcon(size) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPixel(png, x, y, BG);
    }
  }
  const scale = Math.max(1, Math.floor(size / 12));
  const glyphPxW = GLYPH_W * scale;
  const glyphPxH = GLYPH_H * scale;
  const ox = Math.floor((size - glyphPxW) / 2);
  const oy = Math.floor((size - glyphPxH) / 2);
  for (let gy = 0; gy < GLYPH_H; gy++) {
    for (let gx = 0; gx < GLYPH_W; gx++) {
      if (!GLYPH_A[gy][gx]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          setPixel(png, ox + gx * scale + dx, oy + gy * scale + dy, FG);
        }
      }
    }
  }
  return PNG.sync.write(png);
}

mkdirSync(ICON_DIR, { recursive: true });
for (const size of [16, 48, 128]) {
  const buf = makeIcon(size);
  const out = resolve(ICON_DIR, `icon${size}.png`);
  writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
}
