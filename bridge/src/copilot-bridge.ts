import { CopilotClient, approveAll, type CopilotSession } from '@github/copilot-sdk';
import type { SessionEvent } from '@github/copilot-sdk';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { error, log, warn } from './log.js';
import { ToolRpc } from './tool-rpc.js';
import { buildBrowserTool, buildContextTools } from './tools.js';

const SESSIONS_ROOT = join(
  process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Local'),
  'AgentEdge',
  'sessions',
);

// Custom-agent profile, in the GitHub Copilot CLI format
// (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli):
// `.github/agents/<name>.agent.md` with YAML frontmatter + prompt body.
// Compiled file lives at bridge/dist/copilot-bridge.js, so two levels up
// reaches the repo root.
const AGENT_PROFILE_PATH = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, '..', '..', '.github', 'agents', 'agentedge.agent.md');
  } catch {
    return join(process.cwd(), '.github', 'agents', 'agentedge.agent.md');
  }
})();

/**
 * Strip a leading YAML frontmatter block (`---\n...\n---\n`). The bridge
 * passes name/description/tools to the SDK explicitly via `customAgents`,
 * so frontmatter on disk is informational only — but we must not include
 * it in the system prompt the model sees.
 */
function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  // Match `---\n` opener, body up to closing `---\n` on its own line.
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? raw.slice(m[0].length).replace(/^\s+/, '') : raw;
}

function loadAgentPrompt(): string {
  try {
    return stripFrontmatter(readFileSync(AGENT_PROFILE_PATH, 'utf8'));
  } catch (err) {
    warn('failed to read agent profile at', AGENT_PROFILE_PATH, err);
    return 'You are AgentEdge, a Copilot agent embedded in the user\'s Microsoft Edge sidebar.';
  }
}

export type BridgeEvent =
  | { type: 'delta'; chatId: string; text: string }
  | { type: 'message'; chatId: string; text: string }
  | { type: 'done'; chatId: string }
  | { type: 'error'; chatId: string; message: string }
  | { type: 'tool-request'; id: string; tool: string; args: unknown }
  | { type: 'tool-start'; chatId: string; toolCallId: string; toolName: string; arguments?: unknown; mcpServerName?: string }
  | { type: 'tool-progress'; chatId: string; toolCallId: string; message: string }
  | { type: 'tool-complete'; chatId: string; toolCallId: string; success: boolean; resultPreview?: string; error?: string };

export type BridgeEventHandler = (event: BridgeEvent) => void;

interface ChatHandle {
  chatId: string;
  session: CopilotSession;
  workingDirectory: string;
}

export class CopilotBridge {
  private client: CopilotClient | null = null;
  private starting: Promise<void> | null = null;
  private handlers: BridgeEventHandler[] = [];
  private rpc: ToolRpc;
  private chats = new Map<string, ChatHandle>();
  private creating = new Map<string, Promise<ChatHandle>>();

  constructor() {
    this.rpc = new ToolRpc((frame) => this.emit(frame));
  }

  onEvent(handler: BridgeEventHandler): void {
    this.handlers.push(handler);
  }

  handleToolResponse(frame: { id: string; ok: boolean; result?: unknown; error?: string }): void {
    this.rpc.handleResponse({
      type: 'tool-response',
      id: frame.id,
      ok: frame.ok,
      result: frame.result,
      error: frame.error,
    });
  }

  callExtension<T = unknown>(tool: string, args: unknown = {}): Promise<T> {
    return this.rpc.call<T>(tool, args);
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

  async sendPrompt(
    chatId: string,
    text: string,
    attachments?: Array<{ data: string; mimeType: string; displayName?: string }>,
  ): Promise<void> {
    const chat = await this.getOrCreateChat(chatId);
    const sdkAttachments = attachments?.map((a) => ({
      type: 'blob' as const,
      data: a.data,
      mimeType: a.mimeType,
      displayName: a.displayName,
    }));
    await chat.session.send({ prompt: text, attachments: sdkAttachments });
  }

  async deleteChat(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId);
    if (!chat) return;
    try {
      await chat.session.disconnect();
    } catch (err) {
      warn('deleteChat: disconnect threw for', chatId, err);
    }
    this.chats.delete(chatId);
    log('chat deleted:', chatId);
  }

  /**
   * Abort the in-flight turn on a chat session. The session stays alive and
   * usable for subsequent prompts. Safe to call when nothing is in-flight —
   * the SDK simply no-ops.
   */
  async abortChat(chatId: string): Promise<boolean> {
    const chat = this.chats.get(chatId);
    if (!chat) {
      log('abortChat: no chat for', chatId);
      return false;
    }
    try {
      await chat.session.abort();
      log('chat aborted:', chatId);
      return true;
    } catch (err) {
      warn('abortChat: session.abort threw for', chatId, err);
      return false;
    }
  }

  private async ensureClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    if (!this.starting) {
      this.starting = (async () => {
        log('starting CopilotClient...');
        this.client = new CopilotClient();
        await this.client.start();
        log('CopilotClient started');
      })();
    }
    await this.starting;
    if (!this.client) throw new Error('CopilotClient failed to start');
    return this.client;
  }

  private getOrCreateChat(chatId: string): Promise<ChatHandle> {
    const existing = this.chats.get(chatId);
    if (existing) return Promise.resolve(existing);
    const inflight = this.creating.get(chatId);
    if (inflight) return inflight;
    const p = this.createChat(chatId).finally(() => this.creating.delete(chatId));
    this.creating.set(chatId, p);
    return p;
  }

  private async createChat(chatId: string): Promise<ChatHandle> {
    const client = await this.ensureClient();
    const safeId = chatId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
    const workingDirectory = join(SESSIONS_ROOT, safeId);
    mkdirSync(workingDirectory, { recursive: true });
    log('creating chat session:', chatId, 'cwd:', workingDirectory);
    const agentPrompt = loadAgentPrompt();
    const tools = [...buildContextTools(this.rpc), buildBrowserTool()];
    const session = await client.createSession({
      clientName: 'AgentEdge',
      streaming: true,
      workingDirectory,
      tools,
      customAgents: [{
        name: 'agentedge',
        displayName: 'AgentEdge',
        description: 'Copilot embedded in the Microsoft Edge sidebar.',
        prompt: agentPrompt,
      }],
      agent: 'agentedge',
      onPermissionRequest: approveAll,
    });
    log('chat session created:', chatId, 'sessionId=', session.sessionId);
    const handle: ChatHandle = { chatId, session, workingDirectory };
    this.chats.set(chatId, handle);
    this.attachSessionListeners(handle);
    return handle;
  }

  private attachSessionListeners(chat: ChatHandle): void {
    const { chatId, session } = chat;
    session.on((event: SessionEvent) => {
      switch (event.type) {
        case 'assistant.message_delta': {
          const data = event.data as { deltaContent?: string };
          if (typeof data?.deltaContent === 'string') {
            this.emit({ type: 'delta', chatId, text: data.deltaContent });
          }
          break;
        }
        case 'assistant.message': {
          const data = event.data as { content?: unknown };
          if (typeof data?.content === 'string') {
            this.emit({ type: 'message', chatId, text: data.content });
          }
          break;
        }
        case 'session.idle':
          this.emit({ type: 'done', chatId });
          break;
        case 'session.error': {
          const data = event.data as { message?: string };
          this.emit({ type: 'error', chatId, message: data?.message ?? 'session error' });
          break;
        }
        case 'tool.execution_start': {
          const data = event.data as { toolCallId: string; toolName: string; arguments?: unknown; mcpServerName?: string };
          this.emit({
            type: 'tool-start',
            chatId,
            toolCallId: data.toolCallId,
            toolName: data.toolName,
            arguments: data.arguments,
            mcpServerName: data.mcpServerName,
          });
          break;
        }
        case 'tool.execution_progress': {
          const data = event.data as { toolCallId: string; progressMessage: string };
          this.emit({
            type: 'tool-progress',
            chatId,
            toolCallId: data.toolCallId,
            message: data.progressMessage,
          });
          break;
        }
        case 'tool.execution_complete': {
          const data = event.data as {
            toolCallId: string;
            success: boolean;
            result?: { content?: string; detailedContent?: string };
            error?: { message?: string };
          };
          const preview = (data.result?.detailedContent ?? data.result?.content ?? '').slice(0, 4000);
          this.emit({
            type: 'tool-complete',
            chatId,
            toolCallId: data.toolCallId,
            success: !!data.success,
            resultPreview: preview || undefined,
            error: typeof data.error?.message === 'string' ? data.error.message : undefined,
          });
          break;
        }
      }
    });
  }

  async stop(): Promise<void> {
    try {
      this.rpc.rejectAll('bridge stopping');
      // Drop in-flight chat creations so resolved sessions don't attach
      // listeners on a disconnected client.
      this.creating.clear();
      for (const [id, chat] of this.chats) {
        await chat.session.disconnect().catch((err) => warn('disconnect chat', id, err));
      }
      this.chats.clear();
      if (this.client) {
        const errs = await this.client.stop();
        if (errs.length) warn('client.stop errors:', errs);
      }
    } catch (err) {
      warn('stop failed:', err);
    } finally {
      this.client = null;
      this.starting = null;
    }
  }
}
