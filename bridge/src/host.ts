import { NativeMessagingTransport } from './native-messaging.js';
import { CopilotBridge } from './copilot-bridge.js';
import { error, getLogFilePath, log, setLogSink, warn } from './log.js';
import { getConfigPath, getPlaywrightMode } from './config.js';
import {
  bindTab,
  connectBrowser,
  disconnectBrowser,
  getBoundTab,
  getBoundTabFile,
  getCdpSessionId,
  loadFromDisk,
  setTabResolver,
  shutdown,
  unbindTab,
} from './sessions.js';

const transport = new NativeMessagingTransport();
const copilot = new CopilotBridge();

setLogSink((entry) => {
  try {
    transport.send({ type: 'log', ts: entry.ts, level: entry.level, message: entry.message });
  } catch {
    // never throw from the log sink
  }
});

log('bridge started; pid=', process.pid, 'logFile=', getLogFilePath() ?? '(none)');
log('config:', getConfigPath());
log('playwrightMode:', getPlaywrightMode());

transport.send({
  type: 'hello',
  version: '0.0.4',
  pid: process.pid,
  logFile: getLogFilePath(),
  playwrightMode: getPlaywrightMode(),
});

log('bound-tab store:', getBoundTabFile());
setTabResolver(async (sid, opts) => {
  try {
    const result = await copilot.callExtension<{
      tabId?: number; url?: string; title?: string; windowId?: number;
      ambiguous?: boolean; candidates?: number; method?: 'url' | 'marker';
    } | null>('resolve_pw_tab', { sid, url: opts.url, title: opts.title, useMarker: opts.useMarker });
    return result ?? null;
  } catch (err) {
    warn('tabResolver: resolve_pw_tab failed for', sid, err);
    return null;
  }
});
void loadFromDisk().catch((err) => warn('sessions: loadFromDisk failed:', err));

copilot.onEvent((event) => {
  switch (event.type) {
    case 'delta':
      transport.send({ type: 'delta', chatId: event.chatId, text: event.text });
      break;
    case 'message':
      log('→ message', event.chatId, `(${event.text.length} chars)`);
      transport.send({ type: 'message', chatId: event.chatId, text: event.text });
      break;
    case 'done':
      log('→ done', event.chatId);
      transport.send({ type: 'done', chatId: event.chatId });
      break;
    case 'error':
      log('→ error', event.chatId, event.message);
      transport.send({ type: 'error', chatId: event.chatId, message: event.message });
      break;
    case 'turn-start':
      transport.send({ type: 'turn-start', chatId: event.chatId });
      break;
    case 'intent':
      transport.send({ type: 'intent', chatId: event.chatId, text: event.text });
      break;
    case 'tool-request':
      log('→ tool-request', event.tool, 'id=', event.id);
      transport.send({ type: 'tool-request', id: event.id, tool: event.tool, args: event.args });
      break;
    case 'tool-start':
      log('→ tool-start', event.toolName, 'id=', event.toolCallId, 'chat=', event.chatId);
      transport.send({
        type: 'tool-start',
        chatId: event.chatId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        arguments: event.arguments,
        mcpServerName: event.mcpServerName,
      });
      break;
    case 'tool-progress':
      transport.send({
        type: 'tool-progress',
        chatId: event.chatId,
        toolCallId: event.toolCallId,
        message: event.message,
      });
      break;
    case 'tool-complete':
      log('→ tool-complete', event.toolCallId, 'success=', event.success);
      transport.send({
        type: 'tool-complete',
        chatId: event.chatId,
        toolCallId: event.toolCallId,
        success: event.success,
        resultPreview: event.resultPreview,
        error: event.error,
      });
      break;
  }
});

interface IncomingFrame {
  type?: string;
  text?: string;
  chatId?: string;
  [key: string]: unknown;
}

transport.onFrame(async (raw) => {
  const frame = (raw ?? {}) as IncomingFrame;
  log('← frame', frame.type ?? '(no type)',
    frame.type === 'prompt' ? `chat=${frame.chatId} (${(frame.text as string | undefined)?.length ?? 0} chars)`
    : frame.type === 'tool-response' ? `id=${frame.id} ok=${frame.ok}`
    : '');
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
      const chatId = typeof frame.chatId === 'string' ? frame.chatId : 'default';
      // Optional inline blob attachments (e.g. pasted images).
      const rawAttachments = Array.isArray(frame.attachments) ? frame.attachments : [];
      const attachments = rawAttachments
        .map((a) => a as { data?: unknown; mimeType?: unknown; displayName?: unknown })
        .filter((a) => typeof a.data === 'string' && typeof a.mimeType === 'string')
        .map((a) => ({
          data: a.data as string,
          mimeType: a.mimeType as string,
          displayName: typeof a.displayName === 'string' ? a.displayName : undefined,
        }));
      if (!text && attachments.length === 0) {
        transport.send({ type: 'error', chatId, message: 'prompt frame requires non-empty text or attachments' });
        return;
      }
      const cwd = typeof frame.cwd === 'string' && frame.cwd.trim() ? frame.cwd.trim() : undefined;
      const mode = frame.mode === 'immediate' ? 'immediate' as const : 'enqueue' as const;
      try {
        await copilot.sendPrompt(chatId, text, attachments.length ? attachments : undefined, cwd, mode);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        error('prompt failed:', err);
        transport.send({ type: 'error', chatId, message: msg });
      }
      break;
    }
    case 'chat-delete': {
      const chatId = typeof frame.chatId === 'string' ? frame.chatId : '';
      if (!chatId) return;
      await copilot.deleteChat(chatId);
      transport.send({ type: 'chat-deleted', chatId });
      break;
    }
    case 'stop': {
      const chatId = typeof frame.chatId === 'string' ? frame.chatId : '';
      if (!chatId) {
        warn('stop frame missing chatId');
        return;
      }
      const ok = await copilot.abortChat(chatId);
      transport.send({ type: 'stopped', chatId, ok });
      break;
    }
    case 'tool-response': {
      const id = typeof frame.id === 'string' ? frame.id : '';
      if (!id) {
        warn('tool-response missing id');
        return;
      }
      copilot.handleToolResponse({
        id,
        ok: frame.ok === true,
        result: frame.result,
        error: typeof frame.error === 'string' ? frame.error : undefined,
      });
      break;
    }
    case 'pw-status': {
      transport.send({
        type: 'pw-status-result',
        ok: true,
        boundTab: getBoundTab(),
        stateFile: getBoundTabFile(),
      });
      break;
    }
    case 'pw-bind': {
      const hint = typeof frame.hint === 'string' ? frame.hint : undefined;
      const tab = bindTab({ hint });
      transport.send({ type: 'pw-bind-result', ok: true, boundTab: tab });
      break;
    }
    case 'pw-unbind': {
      const ok = await unbindTab();
      transport.send({ type: 'pw-unbind-result', ok, boundTab: null });
      break;
    }
    default:
      warn('unknown frame type:', frame.type);
      transport.send({ type: 'error', message: `unknown frame type: ${String(frame.type)}` });
  }
});

transport.onClose(() => {
  log('transport closed; shutting down');
  shutdown();
  void copilot.stop().finally(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  error('uncaughtException:', err);
  try {
    transport.send({ type: 'error', message: `uncaughtException: ${err.message}` });
  } catch { /* ignore */ }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  error('unhandledRejection:', reason);
  try {
    transport.send({ type: 'error', message: `unhandledRejection: ${msg}` });
  } catch { /* ignore */ }
  process.exit(1);
});
