// Request/response correlation for tool calls that bounce off the extension.
//
// Bridge defineTool() handlers call rpc.call('get_active_tab', args) which:
//   1. Generates an id.
//   2. Sends { type:'tool-request', id, tool, args } over native messaging.
//   3. Waits for { type:'tool-response', id, ok, result|error }.
//   4. Resolves/rejects the Promise.
//
// The extension is responsible for executing the tool and sending the response.

import { error, warn } from './log.js';

export interface ToolResponseFrame {
  type: 'tool-response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

type Sender = (frame: { type: 'tool-request'; id: string; tool: string; args: unknown }) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  tool: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class ToolRpc {
  private pending = new Map<string, Pending>();
  private nextId = 1;

  constructor(private send: Sender, private timeoutMs = DEFAULT_TIMEOUT_MS) {}

  call<T = unknown>(tool: string, args: unknown = {}): Promise<T> {
    const id = `t${Date.now().toString(36)}-${this.nextId++}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`tool '${tool}' timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
        tool,
      });
      try {
        this.send({ type: 'tool-request', id, tool, args });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  handleResponse(frame: ToolResponseFrame): void {
    const p = this.pending.get(frame.id);
    if (!p) {
      warn(`tool-response for unknown id ${frame.id}`);
      return;
    }
    this.pending.delete(frame.id);
    clearTimeout(p.timer);
    if (frame.ok) {
      p.resolve(frame.result);
    } else {
      p.reject(new Error(frame.error ?? `tool '${p.tool}' failed`));
    }
  }

  // When the transport drops, fail every outstanding call so the SDK gets a
  // clean error instead of hanging forever.
  rejectAll(reason: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      try {
        p.reject(new Error(`${reason} (tool '${p.tool}', id ${id})`));
      } catch (err) {
        error('rejectAll handler threw:', err);
      }
    }
    this.pending.clear();
  }
}
