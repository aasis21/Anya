import { CopilotClient, type CopilotSession } from '@github/copilot-sdk';
import type {
  PermissionRequest,
  PermissionRequestResult,
  SessionEvent,
} from '@github/copilot-sdk';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { error, log, warn } from './log.js';

const SESSIONS_ROOT = join(
  process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Local'),
  'AgentEdge',
  'sessions',
);

export type BridgeEvent =
  | { type: 'delta'; text: string }
  | { type: 'message'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'permission-denied'; kind: string };

export type BridgeEventHandler = (event: BridgeEvent) => void;

export class CopilotBridge {
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
  private starting: Promise<void> | null = null;
  private handlers: BridgeEventHandler[] = [];

  onEvent(handler: BridgeEventHandler): void {
    this.handlers.push(handler);
  }

  private emit(event: BridgeEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch (err) {
        error('bridge event handler threw:', err);
      }
    }
  }

  async ensureStarted(): Promise<void> {
    if (this.session) return;
    if (this.starting) {
      await this.starting;
      return;
    }
    this.starting = this.startInternal();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async startInternal(): Promise<void> {
    log('starting CopilotClient...');
    try {
      this.client = new CopilotClient();
      await this.client.start();
      log('CopilotClient started; creating session...');

      // Pre-allocate a per-session scratch dir so the SDK gets a clean cwd.
      // Real sessionId is only known after createSession returns, so we use a
      // timestamp-based provisional id, then the SDK's id is logged for trace.
      const provisionalId = `s-${Date.now()}`;
      const workingDirectory = join(SESSIONS_ROOT, provisionalId);
      mkdirSync(workingDirectory, { recursive: true });
      log('session workingDirectory:', workingDirectory);

      this.session = await this.client.createSession({
        streaming: true,
        workingDirectory,
        onPermissionRequest: (request, invocation) =>
          this.handlePermission(request, invocation),
      });
      log('session created:', this.session.sessionId, 'cwd:', workingDirectory);
      this.attachSessionListeners(this.session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error('failed to start Copilot SDK:', err);
      this.client = null;
      this.session = null;
      throw new Error(`Copilot SDK start failed: ${msg}`);
    }
  }

  private attachSessionListeners(session: CopilotSession): void {
    session.on((event: SessionEvent) => {
      switch (event.type) {
        case 'assistant.message_delta': {
          const data = event.data as { deltaContent?: string };
          if (typeof data?.deltaContent === 'string') {
            this.emit({ type: 'delta', text: data.deltaContent });
          }
          break;
        }
        case 'assistant.message': {
          const data = event.data as { content?: unknown };
          if (typeof data?.content === 'string') {
            this.emit({ type: 'message', text: data.content });
          }
          break;
        }
        case 'session.idle':
          this.emit({ type: 'done' });
          break;
        case 'session.error': {
          const data = event.data as { message?: string };
          this.emit({ type: 'error', message: data?.message ?? 'session error' });
          break;
        }
      }
    });
  }

  async sendPrompt(text: string): Promise<void> {
    await this.ensureStarted();
    if (!this.session) {
      throw new Error('session not initialized');
    }
    await this.session.send({ prompt: text });
  }

  private handlePermission(
    request: PermissionRequest,
    invocation: { sessionId: string },
  ): PermissionRequestResult {
    log(`permission request kind=${request.kind} session=${invocation.sessionId}`);
    if (request.kind === 'read') {
      return { kind: 'approved' };
    }
    // Phase 1: deny everything else; the interactive UI lands in M6.
    warn(`denying permission request kind=${request.kind} (Phase 1 policy)`);
    this.emit({ type: 'permission-denied', kind: request.kind });
    return { kind: 'denied-interactively-by-user' };
  }

  async stop(): Promise<void> {
    try {
      if (this.session) {
        await this.session.disconnect().catch((err) => warn('session disconnect:', err));
      }
      if (this.client) {
        const errs = await this.client.stop();
        if (errs.length) warn('client.stop errors:', errs);
      }
    } catch (err) {
      warn('stop failed:', err);
    } finally {
      this.session = null;
      this.client = null;
    }
  }
}
