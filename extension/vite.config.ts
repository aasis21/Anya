import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';

const root = __dirname;
const distDir = resolve(root, 'dist');

function copyStaticAssets() {
  return {
    name: 'anya-copy-static',
    closeBundle() {
      mkdirSync(distDir, { recursive: true });

      const manifestSrc = resolve(root, 'manifest.json');
      if (existsSync(manifestSrc)) {
        copyFileSync(manifestSrc, resolve(distDir, 'manifest.json'));
      }

      // Copy offscreen.html
      const offscreenSrc = resolve(root, 'src/voice/offscreen.html');
      if (existsSync(offscreenSrc)) {
        copyFileSync(offscreenSrc, resolve(distDir, 'offscreen.html'));
      }

      // Copy mic-permission.html
      const micPermSrc = resolve(root, 'src/voice/mic-permission.html');
      if (existsSync(micPermSrc)) {
        copyFileSync(micPermSrc, resolve(distDir, 'mic-permission.html'));
      }

      const iconsSrc = resolve(root, 'public', 'icons');
      const iconsDest = resolve(distDir, 'icons');
      if (existsSync(iconsSrc)) {
        mkdirSync(iconsDest, { recursive: true });
        for (const f of readdirSync(iconsSrc)) {
          copyFileSync(resolve(iconsSrc, f), resolve(iconsDest, f));
        }
      }
    },
  };
}

export default defineConfig({
  root,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        sidebar: resolve(root, 'sidebar.html'),
        background: resolve(root, 'src/background.ts'),
        'page-bridge': resolve(root, 'src/page-bridge.ts'),
        offscreen: resolve(root, 'src/voice/offscreen.ts'),
        'mic-permission': resolve(root, 'src/voice/mic-permission.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js';
          if (chunk.name === 'page-bridge') return 'page-bridge.js';
          if (chunk.name === 'offscreen') return 'offscreen.js';
          if (chunk.name === 'mic-permission') return 'mic-permission.js';
          return 'assets/[name].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
        inlineDynamicImports: false,
      },
    },
  },
  plugins: [copyStaticAssets()],
});
