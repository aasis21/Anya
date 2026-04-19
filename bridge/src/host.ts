import { NativeMessagingTransport } from './native-messaging.js';
import { CopilotBridge } from './copilot-bridge.js';
import { error, log, warn } from './log.js';

const transport = new NativeMessagingTransport();
const copilot = new CopilotBridge();

log('bridge started; pid=', process.pid);

// Greet the extension immediately so its UI can flip to "connected"
// without having to wait for the user's first message.
transport.send({ type: 'hello', version: '0.0.1', pid: process.pid });

copilot.onEvent((event) => {
  switch (event.type) {
    case 'delta':
      transport.send({ type: 'delta', text: event.text });
      break;
    case 'message':
      transport.send({ type: 'message', text: event.text });
      break;
    case 'done':
      transport.send({ type: 'done' });
      break;
    case 'error':
      transport.send({ type: 'error', message: event.message });
      break;
    case 'permission-denied':
      transport.send({
        type: 'permission-denied',
        kind: event.kind,
        message: `Permission '${event.kind}' is denied in Phase 1.`,
      });
      break;
  }
});

interface IncomingFrame {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

transport.onFrame(async (raw) => {
  const frame = (raw ?? {}) as IncomingFrame;
  switch (frame.type) {
    case 'ping':
      transport.send({ type: 'pong' });
      break;
    case 'echo':
      transport.send({
        type: 'echo-reply',
        text: typeof frame.text === 'string' ? frame.text.toUpperCase() : '',
      });
      break;
    case 'prompt': {
      const text = typeof frame.text === 'string' ? frame.text : '';
      if (!text) {
        transport.send({ type: 'error', message: 'prompt frame requires non-empty text' });
        return;
      }
      try {
        await copilot.sendPrompt(text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        error('prompt failed:', err);
        transport.send({ type: 'error', message: msg });
      }
      break;
    }
    default:
      warn('unknown frame type:', frame.type);
      transport.send({ type: 'error', message: `unknown frame type: ${String(frame.type)}` });
  }
});

transport.onClose(() => {
  log('transport closed; shutting down');
  void copilot.stop().finally(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  error('uncaughtException:', err);
  try {
    transport.send({ type: 'error', message: `uncaughtException: ${err.message}` });
  } catch {
    /* ignore */
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  error('unhandledRejection:', reason);
  try {
    transport.send({ type: 'error', message: `unhandledRejection: ${msg}` });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
