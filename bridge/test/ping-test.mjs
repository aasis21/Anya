// Spawns the built bridge host, sends a length-prefixed ping frame on stdin,
// and asserts a length-prefixed pong frame comes back on stdout.
//
// Exit code 0 = success, 1 = failure.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hostPath = join(__dirname, '..', 'dist', 'host.js');

const child = spawn(process.execPath, [hostPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.on('data', (b) => {
  stderr += b.toString('utf8');
});

let stdoutBuf = Buffer.alloc(0);
let resolved = false;

const timer = setTimeout(() => {
  if (resolved) return;
  resolved = true;
  console.error('[ping-test] FAIL: timed out waiting for pong');
  console.error('--- stderr ---\n' + stderr);
  child.kill();
  process.exit(1);
}, 10_000);

child.stdout.on('data', (chunk) => {
  stdoutBuf = Buffer.concat([stdoutBuf, chunk]);
  while (stdoutBuf.length >= 4) {
    const len = stdoutBuf.readUInt32LE(0);
    if (stdoutBuf.length < 4 + len) return;
    const body = stdoutBuf.subarray(4, 4 + len).toString('utf8');
    stdoutBuf = stdoutBuf.subarray(4 + len);
    let frame;
    try {
      frame = JSON.parse(body);
    } catch (err) {
      console.error('[ping-test] FAIL: malformed JSON from host:', body);
      cleanup(1);
      return;
    }
    if (frame && frame.type === 'pong') {
      console.log('[ping-test] OK: received pong frame');
      cleanup(0);
      return;
    }
    // Ignore informational startup frames (hello, log, ...) — keep reading
    // until we see the pong or the timer fires.
  }
});

child.on('error', (err) => {
  console.error('[ping-test] FAIL: spawn error:', err);
  cleanup(1);
});

child.on('exit', (code, signal) => {
  if (resolved) return;
  console.error(`[ping-test] FAIL: host exited prematurely code=${code} signal=${signal}`);
  console.error('--- stderr ---\n' + stderr);
  process.exit(1);
});

function cleanup(code) {
  if (resolved) return;
  resolved = true;
  clearTimeout(timer);
  if (code !== 0) {
    console.error('--- stderr ---\n' + stderr);
  }
  try {
    child.stdin.end();
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    process.exit(code);
  }, 250);
}

const body = Buffer.from(JSON.stringify({ type: 'ping' }), 'utf8');
const header = Buffer.alloc(4);
header.writeUInt32LE(body.length, 0);
child.stdin.write(Buffer.concat([header, body]));
