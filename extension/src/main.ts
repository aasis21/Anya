/**
 * AgentEdge sidebar — the Lit component that wires Edge to the local Copilot bridge.
 *
 * High-level layout (top → bottom of the file):
 *   1. Imports + small pure helpers (escapeRegExp, summariseTab).
 *   2. AgentEdgeApp (`<agent-edge-app>`):
 *        - reactive @state fields (UI + chat store + debug + bound tab)
 *        - lifecycle: connectedCallback / disconnectedCallback
 *        - chat store: load / persist / new / switch / delete / rename / pin / tag
 *        - message-level actions, cancel stream
 *        - global keyboard shortcuts
 *        - frame handler (bridge → UI events) and tool RPC (bridge ↔ chrome.* APIs)
 *        - send pipeline: slash-command → mention expansion → bridge dispatch
 *        - render() and its renderXxx() helpers
 *
 * Styles live in `./styles.ts`, types in `./types.ts`. Keep this file focused
 * on behaviour; if you find yourself adding a 50-line CSS block, extract it.
 */
import { LitElement, html, nothing } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { marked } from 'marked';
import { nativeBridge, type Frame } from './native-bridge.js';
import { sidebarStyles } from './styles.js';
import {
  type Role,
  type ToolCall,
  type ChatMessage,
  type Chat,
  type BoundTab,
  type QuickPrompt,
  type DebugEntry,
  DEFAULT_QUICK_PROMPTS,
  DEBUG_MAX_ENTRIES,
} from './types.js';

marked.setOptions({ gfm: true, breaks: true });

/** Summarise a chrome.tabs.Tab down to the JSON-friendly fields the bridge needs. */
function summariseTab(tab: chrome.tabs.Tab): {
  tabId: number | undefined;
  url: string;
  title: string;
  active: boolean;
  windowId: number | undefined;
  favIconUrl: string | undefined;
} {
  return {
    tabId: tab.id,
    url: tab.url ?? tab.pendingUrl ?? '',
    title: tab.title ?? '',
    active: !!tab.active,
    windowId: tab.windowId,
    favIconUrl: tab.favIconUrl,
  };
}

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@customElement('agent-edge-app')
export class AgentEdgeApp extends LitElement {
  static styles = sidebarStyles;

  @state() private connected = false;
  @state() private bridgePid: number | null = null;
  @state() private bridgeVersion = '?';
  @state() private bridgeLogFile: string | null = null;
  @state() private theme: 'dark' | 'light' = 'dark';
  @state() private draftEmpty = true;
  @state() private debugOpen = false;
  @state() private debugEntries: DebugEntry[] = [];
  @state() private toolExpanded: Set<string> = new Set();

  // Multi-chat state. Active chat's messages/toolCalls live inside the chat
  // record; we expose the current ones via getters so render code stays
  // simple. All chats are persisted to chrome.storage.local.
  @state() private chats: Chat[] = [];
  @state() private currentChatId: string = '';
  @state() private chatDrawerOpen = false;
  @state() private renamingChatId: string | null = null;
  @state() private searchOpen = false;
  @state() private searchQuery = '';
  @state() private searchActiveIdx = 0;
  @state() private quickPrompts: QuickPrompt[] = [...DEFAULT_QUICK_PROMPTS];
  @state() private chatsLoaded = false;

  // Drawer tag filter — null shows all chats, otherwise filters by tag.
  @state() private drawerTagFilter: string | null = null;
  // Chats whose stream the user cancelled. We keep painting nothing for further
  // deltas until the bridge sends `done`, then we drop the id.
  private cancelledChats: Set<string> = new Set();
  // Per-message hover toolbar — id of the message whose ⋯ menu is open.
  @state() private msgMenuId: string | null = null;

  // Single bound Playwright tab (was: array of sessions).
  @state() private boundTab: BoundTab | null = null;
  @state() private pwLoading = false;
  @state() private pwError: string | null = null;

  private get currentChat(): Chat | null {
    return this.chats.find((c) => c.id === this.currentChatId) ?? null;
  }
  private get messages(): ChatMessage[] {
    return this.currentChat?.messages ?? [];
  }
  private get toolCalls(): Map<string, ToolCall> {
    const c = this.currentChat;
    if (!c) return new Map();
    return new Map(Object.entries(c.toolCalls));
  }
  @query('main') private transcript!: HTMLElement;
  @query('#prompt-input') private textarea!: HTMLTextAreaElement;

  private unsubMessage?: () => void;
  private unsubDisconnect?: () => void;
  /** Per-chat streaming-message id. */
  private streamingIds: Map<string, string> = new Map();
  private persistTimer: number | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubMessage = nativeBridge.onMessage((f) => this.handleFrame(f));
    this.unsubDisconnect = nativeBridge.onDisconnect(() => {
      this.connected = false;
      this.streamingIds.clear();
      this.recordDebug({ kind: 'log', level: 'warn', summary: 'transport disconnected' });
    });
    nativeBridge.connect();
    this.connected = nativeBridge.isConnected();
    this.loadTheme();
    this.loadDebug();
    void this.loadChats();
    void this.loadQuickPrompts();
    window.addEventListener('keydown', this.onGlobalKey);
    // Hidden dev escape hatch — invisible to users
    (window as any).agentEdge = {
      ping: () => this.bridgeSend({ type: 'ping' }),
      echo: (text: string) => this.bridgeSend({ type: 'echo', text }),
      debug: () => this.toggleDebug(),
      chats: () => this.chats,
    };
  }

  private async loadTheme(): Promise<void> {
    try {
      const stored = await chrome.storage?.local?.get?.('agentedge-theme');
      const t = stored?.['agentedge-theme'];
      if (t === 'light' || t === 'dark') {
        this.theme = t;
      }
    } catch { /* ignore */ }
    this.setAttribute('theme', this.theme);
  }

  private toggleTheme(): void {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    this.setAttribute('theme', this.theme);
    try { chrome.storage?.local?.set?.({ 'agentedge-theme': this.theme }); } catch { /* ignore */ }
  }

  // ----- debug mode ------------------------------------------------------
  private async loadDebug(): Promise<void> {
    try {
      const stored = await chrome.storage?.local?.get?.('agentedge-debug');
      if (stored?.['agentedge-debug'] === true) this.debugOpen = true;
    } catch { /* ignore */ }
  }

  private toggleDebug(): void {
    this.debugOpen = !this.debugOpen;
    try { chrome.storage?.local?.set?.({ 'agentedge-debug': this.debugOpen }); } catch { /* ignore */ }
  }

  private clearDebug(): void {
    this.debugEntries = [];
  }

  private copyDebug(): void {
    const text = this.debugEntries
      .map((e) => `[${new Date(e.ts).toISOString()}] ${e.kind.toUpperCase()}${e.level ? '/' + e.level : ''}: ${e.summary}${e.detail ? '\n' + e.detail : ''}`)
      .join('\n');
    navigator.clipboard?.writeText(text).catch(() => { /* ignore */ });
  }

  private recordDebug(entry: Omit<DebugEntry, 'id' | 'ts'> & { ts?: number }): void {
    const next: DebugEntry = {
      id: `d${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: entry.ts ?? Date.now(),
      kind: entry.kind,
      level: entry.level,
      summary: entry.summary,
      detail: entry.detail,
    };
    const arr = [...this.debugEntries, next];
    if (arr.length > DEBUG_MAX_ENTRIES) arr.splice(0, arr.length - DEBUG_MAX_ENTRIES);
    this.debugEntries = arr;
  }

  private bridgeSend(frame: Record<string, unknown>): boolean {
    const ok = nativeBridge.send(frame as Frame);
    this.recordDebug({
      kind: 'out',
      summary: `→ ${String(frame.type ?? '?')}` + (ok ? '' : ' (FAILED)'),
      detail: this.summariseFrame(frame),
    });
    return ok;
  }

  private summariseFrame(frame: Record<string, unknown>): string {
    try {
      const seen = JSON.stringify(frame, (_k, v) => {
        if (typeof v === 'string' && v.length > 400) return v.slice(0, 400) + `…[+${v.length - 400}]`;
        return v;
      }, 2);
      return seen.length > 4000 ? seen.slice(0, 4000) + '\n…[truncated]' : seen;
    } catch {
      return '(unserialisable)';
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubMessage?.();
    this.unsubDisconnect?.();
    window.removeEventListener('keydown', this.onGlobalKey);
    // Flush any debounced persist before tearing down so the latest state
    // survives reload, then clear the timer.
    if (this.persistTimer != null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      try {
        chrome.storage?.local?.set?.({
          'agentedge-chats': this.chats.map((c) => ({
            ...c,
            messages: c.messages.map((m) => ({ ...m, pending: false })),
          })),
          'agentedge-current-chat': this.currentChatId,
        });
      } catch { /* ignore */ }
    }
  }

  // ----- chat store ------------------------------------------------------
  private async loadChats(): Promise<void> {
    try {
      const stored = await chrome.storage?.local?.get?.(['agentedge-chats', 'agentedge-current-chat']);
      const arr = stored?.['agentedge-chats'];
      const cur = stored?.['agentedge-current-chat'];
      if (Array.isArray(arr) && arr.length > 0) {
        this.chats = arr.map((c: any) => ({
          id: String(c.id),
          title: String(c.title ?? 'untitled'),
          messages: Array.isArray(c.messages) ? c.messages : [],
          toolCalls: c.toolCalls && typeof c.toolCalls === 'object' ? c.toolCalls : {},
          createdAt: Number(c.createdAt) || Date.now(),
          updatedAt: Number(c.updatedAt) || Date.now(),
          pinned: !!c.pinned,
          tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
        }));
        this.currentChatId = typeof cur === 'string' && this.chats.some((c) => c.id === cur)
          ? cur : this.chats[0].id;
      } else {
        this.startNewChat();
      }
    } catch (err) {
      console.warn('[AgentEdge] loadChats failed', err);
      this.startNewChat();
    }
    this.chatsLoaded = true;
  }

  private persistChats(): void {
    if (this.persistTimer != null) clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      try {
        chrome.storage?.local?.set?.({
          'agentedge-chats': this.chats.map((c) => ({
            ...c,
            // Strip pending flag so reloads don't show stuck spinners
            messages: c.messages.map((m) => ({ ...m, pending: false })),
          })),
          'agentedge-current-chat': this.currentChatId,
        });
      } catch { /* storage may be unavailable */ }
    }, 250);
  }

  private newChatId(): string {
    return `c${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private startNewChat = (): string => {
    const id = this.newChatId();
    const now = Date.now();
    const chat: Chat = {
      id,
      title: 'new chat',
      messages: [],
      toolCalls: {},
      createdAt: now,
      updatedAt: now,
    };
    this.chats = [chat, ...this.chats];
    this.currentChatId = id;
    this.chatDrawerOpen = false;
    this.persistChats();
    // Drop the user straight into the empty composer for the new chat.
    queueMicrotask(() => {
      const ta = this.renderRoot.querySelector('#prompt-input') as HTMLTextAreaElement | null;
      ta?.focus();
    });
    return id;
  };

  private switchChat = (id: string): void => {
    if (!this.chats.some((c) => c.id === id)) return;
    this.currentChatId = id;
    this.chatDrawerOpen = false;
    this.searchOpen = false;
    this.persistChats();
    this.scrollToBottom();
  };

  private deleteChat = (id: string): void => {
    if (!confirm('Delete this chat?')) return;
    this.streamingIds.delete(id);
    this.cancelledChats.delete(id);
    this.bridgeSend({ type: 'chat-delete', chatId: id });
    const remaining = this.chats.filter((c) => c.id !== id);
    if (remaining.length === 0) {
      this.chats = [];
      this.startNewChat();
      return;
    }
    this.chats = remaining;
    if (this.currentChatId === id) this.currentChatId = remaining[0].id;
    this.persistChats();
  };

  private renameChat = (id: string, title: string): void => {
    const t = title.trim().slice(0, 80);
    if (!t) return;
    this.chats = this.chats.map((c) => c.id === id ? { ...c, title: t, updatedAt: Date.now() } : c);
    this.renamingChatId = null;
    this.persistChats();
  };

  // ----- pin / tag / cancel / message-actions -------------------

  /** Toggle the chat's pinned flag — pinned chats float to the top of the drawer. */
  private togglePin = (id: string): void => {
    this.chats = this.chats.map((c) => c.id === id ? { ...c, pinned: !c.pinned, updatedAt: Date.now() } : c);
    this.persistChats();
  };

  /** Add a tag to a chat (lowercased, alphanumeric+`_-`, max 24 chars). */
  private addTagToChat = (id: string, tag: string): void => {
    const t = tag.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
    if (!t) return;
    this.chats = this.chats.map((c) => {
      if (c.id !== id) return c;
      const tags = c.tags ?? [];
      if (tags.includes(t)) return c;
      return { ...c, tags: [...tags, t], updatedAt: Date.now() };
    });
    this.persistChats();
  };

  private removeTagFromChat = (id: string, tag: string): void => {
    this.chats = this.chats.map((c) => {
      if (c.id !== id) return c;
      const tags = (c.tags ?? []).filter((x) => x !== tag);
      return { ...c, tags, updatedAt: Date.now() };
    });
    this.persistChats();
  };

  private allTags(): string[] {
    const set = new Set<string>();
    for (const c of this.chats) for (const t of c.tags ?? []) set.add(t);
    return [...set].sort();
  }

  /**
   * Cancel the in-flight turn for a chat. Sends a `stop` frame to the bridge
   * (which calls `session.abort()` on the SDK), and immediately marks the
   * pending message as cancelled so the UI snaps even if the bridge takes a
   * moment to acknowledge. Late deltas are filtered via `cancelledChats`.
   */
  private cancelStream = (chatId: string): void => {
    const sid = this.streamingIds.get(chatId);
    if (!sid) return;
    this.cancelledChats.add(chatId);
    this.bridgeSend({ type: 'stop', chatId });
    this.mutateChat(chatId, (c) => ({
      ...c,
      messages: c.messages.map((m) => m.id === sid
        ? { ...m, pending: false, text: (m.text || '') + (m.text ? '\n\n_(cancelled)_' : '_(cancelled)_') }
        : m),
    }));
    this.streamingIds.delete(chatId);
  };

  // ----- message-level actions (copy / delete / regenerate) -------------
  private copyMessage = (m: ChatMessage): void => {
    navigator.clipboard?.writeText(m.text).catch(() => { /* ignore */ });
    this.msgMenuId = null;
  };

  private deleteMessage = (chatId: string, msgId: string): void => {
    this.mutateChat(chatId, (c) => ({ ...c, messages: c.messages.filter((m) => m.id !== msgId) }));
    this.msgMenuId = null;
  };

  private regenerateFromMessage = (chatId: string, msgId: string): void => {
    const c = this.chats.find((x) => x.id === chatId);
    const m = c?.messages.find((x) => x.id === msgId);
    if (!c || !m || m.role !== 'user') return;
    this.msgMenuId = null;
    void this.dispatchPrompt(chatId, m.text);
  };

  private mutateChat(chatId: string, fn: (c: Chat) => Chat): void {
    let touched = false;
    this.chats = this.chats.map((c) => {
      if (c.id !== chatId) return c;
      touched = true;
      const next = fn(c);
      return { ...next, updatedAt: Date.now() };
    });
    if (touched) this.persistChats();
  }

  private appendMessage(chatId: string, m: ChatMessage): void {
    this.mutateChat(chatId, (c) => ({ ...c, messages: [...c.messages, m] }));
  }

  private autoTitleIfNeeded(chatId: string, userText: string): void {
    const c = this.chats.find((x) => x.id === chatId);
    if (!c) return;
    if (c.title && c.title !== 'new chat') return;
    const title = userText.replace(/\s+/g, ' ').trim().slice(0, 60) || 'untitled';
    this.mutateChat(chatId, (c) => ({ ...c, title }));
  }

  // ----- quick prompts ---------------------------------------------------
  private async loadQuickPrompts(): Promise<void> {
    try {
      const stored = await chrome.storage?.local?.get?.('agentedge-quick-prompts');
      const arr = stored?.['agentedge-quick-prompts'];
      if (Array.isArray(arr) && arr.length > 0) {
        this.quickPrompts = arr.map((p: any) => ({
          id: String(p.id),
          label: String(p.label),
          body: String(p.body),
        }));
      }
    } catch { /* ignore */ }
  }

  private persistQuickPrompts(): void {
    try { chrome.storage?.local?.set?.({ 'agentedge-quick-prompts': this.quickPrompts }); } catch { /* ignore */ }
  }

  private insertQuickPrompt = (qp: QuickPrompt): void => {
    const ta = this.textarea ?? (this.renderRoot.querySelector('#prompt-input') as HTMLTextAreaElement | null);
    if (!ta) return;
    ta.value = qp.body;
    this.draftEmpty = ta.value.length === 0;
    ta.focus();
    this.chatDrawerOpen = false;
  };

  // ----- export ----------------------------------------------------------
  private exportChat = (id: string): void => {
    const c = this.chats.find((x) => x.id === id);
    if (!c) return;
    const lines: string[] = [
      `# ${c.title}`,
      '',
      `_Exported ${new Date().toISOString()}_`,
      '',
    ];
    for (const m of c.messages) {
      const who = m.role === 'user' ? '**You**' : m.role === 'assistant' ? '**Assistant**' : '_System_';
      lines.push(`${who} (${new Date(m.ts).toLocaleString()})`);
      lines.push('');
      lines.push(m.text || '_(empty)_');
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${c.title.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'chat'}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ----- keyboard shortcuts ----------------------------------------------
  private onGlobalKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    const inEditable = !!target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
    if (e.key === 'Escape') {
      if (this.searchOpen) { this.searchOpen = false; e.preventDefault(); return; }
      if (this.chatDrawerOpen) { this.chatDrawerOpen = false; e.preventDefault(); return; }
      if (this.renamingChatId) { this.renamingChatId = null; e.preventDefault(); return; }
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); this.startNewChat(); return; }
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); this.searchOpen = true; return; }
      if (e.key.toLowerCase() === 'b') { e.preventDefault(); this.chatDrawerOpen = !this.chatDrawerOpen; return; }
      if (e.key.toLowerCase() === 'l' && !inEditable) { e.preventDefault(); this.clearCurrentChat(); return; }
      if (e.key === '/') { e.preventDefault(); this.cycleQuickPrompt(); return; }
      // Ctrl+. — soft-cancel the in-flight stream for the current chat.
      if (e.key === '.') { e.preventDefault(); if (this.currentChatId) this.cancelStream(this.currentChatId); return; }
      // Ctrl+1..9 — switch to the Nth chat in drawer order (pinned first).
      if (/^[1-9]$/.test(e.key)) {
        const n = parseInt(e.key, 10) - 1;
        const ordered = this.orderedChats();
        if (ordered[n]) { e.preventDefault(); this.switchChat(ordered[n].id); }
        return;
      }
    }
  };

  // Drawer ordering: pinned first, then by updatedAt desc.
  private orderedChats(): Chat[] {
    return [...this.chats].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      return b.updatedAt - a.updatedAt;
    });
  }

  private clearCurrentChat = (): void => {
    if (!this.currentChatId) return;
    if (!confirm('Clear all messages in this chat?')) return;
    this.mutateChat(this.currentChatId, (c) => ({ ...c, messages: [], toolCalls: {} }));
    this.streamingIds.delete(this.currentChatId);
  };

  private quickPromptCursor = 0;
  private cycleQuickPrompt = (): void => {
    if (this.quickPrompts.length === 0) return;
    const qp = this.quickPrompts[this.quickPromptCursor % this.quickPrompts.length];
    this.quickPromptCursor++;
    this.insertQuickPrompt(qp);
  };

  // ----- frame handling --------------------------------------------------
  private handleFrame(f: Frame): void {
    this.connected = true;
    const data = f as any;
    this.recordDebug({
      kind: 'in',
      summary: `← ${String(f.type ?? '?')}`,
      detail: this.summariseFrame(f as Record<string, unknown>),
    });
    const chatId = typeof data.chatId === 'string' ? data.chatId : null;
    switch (f.type) {
      case 'hello':
        this.bridgePid = Number(data.pid) || null;
        this.bridgeVersion = String(data.version ?? '?');
        this.bridgeLogFile = typeof data.logFile === 'string' ? data.logFile : null;
        this.refreshBoundTab();
        break;
      case 'log': {
        const ts = typeof data.ts === 'string' ? Date.parse(data.ts) : Date.now();
        const level = data.level === 'warn' || data.level === 'error' ? data.level : 'info';
        this.recordDebug({
          kind: 'log',
          level,
          ts: Number.isFinite(ts) ? ts : Date.now(),
          summary: String(data.message ?? ''),
        });
        break;
      }
      case 'pong':
        console.debug('[AgentEdge] pong');
        break;
      case 'echo-reply':
        console.debug('[AgentEdge] echo:', String(data.text ?? ''));
        break;
      case 'delta':
        if (chatId && !this.cancelledChats.has(chatId)) this.appendDelta(chatId, String(data.text ?? ''));
        break;
      case 'done':
        if (chatId) {
          this.cancelledChats.delete(chatId);
          this.finishStream(chatId);
        }
        break;
      case 'message':
        // Final full message ignored — deltas already painted it.
        break;
      case 'error':
        if (chatId) this.finishStream(chatId);
        if (chatId) this.pushSystem(chatId, `error: ${String(data.message ?? '')}`, 'error');
        break;
      case 'permission-denied':
        if (chatId) this.pushSystem(
          chatId,
          `permission denied (${String(data.kind ?? '?')}). ${String(data.message ?? '')}`,
          'denied',
        );
        break;
      case 'tool-request': {
        const id = String(data.id ?? '');
        const tool = String(data.tool ?? '');
        const args = (data.args ?? {}) as Record<string, unknown>;
        if (!id || !tool) {
          console.warn('[AgentEdge] malformed tool-request:', data);
          return;
        }
        void this.handleToolRequest(id, tool, args);
        break;
      }
      case 'tool-start': {
        if (!chatId) break;
        const tcid = String(data.toolCallId ?? '');
        if (!tcid) break;
        const call: ToolCall = {
          toolCallId: tcid,
          toolName: String(data.toolName ?? '?'),
          mcpServerName: typeof data.mcpServerName === 'string' ? data.mcpServerName : undefined,
          arguments: data.arguments,
          status: 'running',
          startedAt: Date.now(),
        };
        this.mutateChat(chatId, (c) => ({
          ...c,
          toolCalls: { ...c.toolCalls, [tcid]: call },
        }));
        this.attachToolToStreamingMessage(chatId, tcid);
        if (chatId === this.currentChatId) this.scrollToBottom();
        break;
      }
      case 'tool-progress': {
        if (!chatId) break;
        const tcid = String(data.toolCallId ?? '');
        const c = this.chats.find((x) => x.id === chatId);
        const existing = c?.toolCalls[tcid];
        if (!existing) break;
        this.mutateChat(chatId, (c) => ({
          ...c,
          toolCalls: { ...c.toolCalls, [tcid]: { ...existing, progress: String(data.message ?? '') } },
        }));
        break;
      }
      case 'tool-complete': {
        if (!chatId) break;
        const tcid = String(data.toolCallId ?? '');
        const c = this.chats.find((x) => x.id === chatId);
        const existing = c?.toolCalls[tcid];
        if (!existing) break;
        this.mutateChat(chatId, (c) => ({
          ...c,
          toolCalls: {
            ...c.toolCalls,
            [tcid]: {
              ...existing,
              status: data.success ? 'success' : 'error',
              finishedAt: Date.now(),
              resultPreview: typeof data.resultPreview === 'string' ? data.resultPreview : undefined,
              error: typeof data.error === 'string' ? data.error : undefined,
            },
          },
        }));
        if (existing.toolName === 'drive_tab' || existing.toolName === 'browser') this.refreshBoundTab();
        break;
      }
      case 'pw-status-result':
      case 'pw-bind-result':
      case 'pw-unbind-result': {
        this.pwLoading = false;
        const bt = data.boundTab && typeof data.boundTab === 'object'
          ? (data.boundTab as BoundTab) : null;
        this.boundTab = bt;
        if (!data.ok) this.pwError = String(data.error ?? `${f.type} failed`);
        else this.pwError = null;
        if (f.type === 'pw-bind-result' && data.ok) {
          // Status flips from 'waiting-for-connect' → 'connected' after
          // the user clicks the picker button. Poll a few times.
          this.scheduleBoundTabRefreshes();
        }
        break;
      }
      case 'chat-deleted':
        // Bridge confirmed deletion; no action needed (UI already updated).
        break;
      default:
        console.debug('[AgentEdge] unknown frame:', f);
    }
  }

  // ----- tool execution (bridge → extension RPC) ------------------------
  private async handleToolRequest(
    id: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    console.debug('[AgentEdge] tool-request', tool, args);
    try {
      const result = await this.executeTool(tool, args);
      nativeBridge.send({ type: 'tool-response', id, ok: true, result });
      this.recordDebug({
        kind: 'out',
        summary: `→ tool-response ok id=${id}`,
        detail: this.summariseFrame({ type: 'tool-response', id, ok: true, result }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Tool failures are routine (restricted pages, closed tabs) — log at
      // debug level only. The error surfaces back to the model via the
      // tool-response frame so the model can react.
      console.debug('[AgentEdge] tool failed', tool, msg);
      nativeBridge.send({ type: 'tool-response', id, ok: false, error: msg });
      this.recordDebug({
        kind: 'out',
        level: 'warn',
        summary: `→ tool-response err id=${id} (${tool})`,
        detail: msg,
      });
    }
  }

  private async executeTool(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (tool) {
      case 'get_active_tab': {
        const tab = await this.getActiveTab();
        return summariseTab(tab);
      }
      case 'list_tabs': {
        const windowId =
          typeof args.windowId === 'number' ? (args.windowId as number) : undefined;
        const query: chrome.tabs.QueryInfo = windowId !== undefined
          ? { windowId }
          : { currentWindow: true };
        const tabs = await chrome.tabs.query(query);
        return tabs.map(summariseTab);
      }
      case 'get_selection': {
        const tabId = await this.resolveTabId(args.tabId);
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (this.isRestrictedUrl(tab?.url)) {
          return { tabId, selection: '', restricted: true, url: tab?.url ?? '' };
        }
        const [{ result } = { result: '' as unknown }] =
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => window.getSelection()?.toString() ?? '',
          });
        return { tabId, selection: typeof result === 'string' ? result : '' };
      }
      case 'get_tab_content': {
        const tabId = await this.resolveTabId(args.tabId);
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (this.isRestrictedUrl(tab?.url)) {
          return {
            tabId,
            title: tab?.title ?? '',
            url: tab?.url ?? '',
            text: '',
            restricted: true,
          };
        }
        const [{ result } = { result: { title: '', url: '', text: '' } as unknown }] =
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => ({
              title: document.title,
              url: location.href,
              text: (document.body?.innerText ?? '').slice(0, 200_000),
            }),
          });
        return { tabId, ...(result as object) };
      }
      case 'focus_tab': {
        const tabId = await this.resolveTabId(args.tabId);
        const tab = await chrome.tabs.update(tabId, { active: true });
        if (tab && typeof tab.windowId === 'number') {
          try { await chrome.windows.update(tab.windowId, { focused: true }); }
          catch (e) { console.warn('[AgentEdge] focus window failed:', e); }
        }
        return tab ? summariseTab(tab) : { tabId };
      }
      case 'open_tab': {
        const url = typeof args.url === 'string' ? args.url : '';
        if (!url) throw new Error('open_tab: url is required');
        const background = args.background === true;
        const tab = await chrome.tabs.create({ url, active: !background });
        if (!background && typeof tab.windowId === 'number') {
          try { await chrome.windows.update(tab.windowId, { focused: true }); }
          catch (e) { console.warn('[AgentEdge] focus window failed:', e); }
        }
        return summariseTab(tab);
      }
      case 'close_tab': {
        // Accept a single tabId, an array of tabIds, or default to the active tab.
        let ids: number[];
        if (Array.isArray(args.tabIds)) {
          ids = args.tabIds.filter((v): v is number => typeof v === 'number');
        } else if (typeof args.tabId === 'number') {
          ids = [args.tabId];
        } else {
          ids = [await this.resolveTabId(undefined)];
        }
        if (ids.length === 0) throw new Error('close_tab: no valid tabId(s) provided');
        await chrome.tabs.remove(ids);
        return { closed: ids };
      }
      case 'resolve_pw_tab': {
        // Bridge-internal: locate which chrome tab a Playwright session is
        // bound to. URL-first; only scans for the injected marker when
        // multiple chrome tabs share the URL (and the bridge has just
        // injected the marker).
        const sid = String(args.sid ?? args.sessionId ?? '');
        const url = String(args.url ?? '');
        const useMarker = args.useMarker === true;
        if (!sid) throw new Error('resolve_pw_tab: sid required');

        const all = await chrome.tabs.query({});
        const isRestricted = (u: string) =>
          u.startsWith('chrome://') ||
          u.startsWith('edge://') ||
          u.startsWith('about:') ||
          u.startsWith('chrome-extension://') ||
          u.startsWith('moz-extension://') ||
          u.startsWith('devtools://');

        const candidates = all.filter(
          (t) => typeof t.id === 'number' && !!t.url && !isRestricted(t.url),
        );

        // Match URL exactly first, then with hash/trailing-slash normalised.
        const norm = (u: string) => u.replace(/\/+$/, '').split('#')[0];
        let matches = url ? candidates.filter((t) => t.url === url) : candidates;
        if (matches.length === 0 && url) {
          const target = norm(url);
          matches = candidates.filter((t) => norm(t.url ?? '') === target);
        }

        if (matches.length === 1) {
          const t = matches[0];
          return {
            tabId: t.id,
            url: t.url,
            title: t.title,
            windowId: t.windowId,
            method: 'url',
          };
        }
        if (matches.length === 0) {
          return { ambiguous: false, candidates: 0 };
        }
        if (!useMarker) {
          return { ambiguous: true, candidates: matches.length };
        }
        // Scan candidates for our marker.
        for (const t of matches) {
          if (typeof t.id !== 'number') continue;
          try {
            const [{ result } = { result: '' as unknown }] =
              await chrome.scripting.executeScript({
                target: { tabId: t.id },
                func: () => {
                  let parts = '';
                  try { parts += String((window as Window).name ?? ''); } catch { /* ignore */ }
                  parts += '|';
                  try { parts += String(document.documentElement?.getAttribute('data-agentedge-sid') ?? ''); } catch { /* ignore */ }
                  parts += '|';
                  try { parts += String(sessionStorage.getItem('__agentedge_sid') ?? ''); } catch { /* ignore */ }
                  return parts;
                },
              });
            const s = String(result ?? '');
            if (s.includes('agentedge:' + sid) || s.split('|').includes(sid)) {
              return {
                tabId: t.id,
                url: t.url,
                title: t.title,
                windowId: t.windowId,
                method: 'marker',
              };
            }
          } catch {
            // restricted page, ignore
          }
        }
        return { ambiguous: true, candidates: matches.length, found: false };
      }
      default:
        throw new Error(`unknown tool: ${tool}`);
    }
  }

  private async getActiveTab(): Promise<chrome.tabs.Tab> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('no active tab');
    return tab;
  }

  private async resolveTabId(raw: unknown): Promise<number> {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const tab = await this.getActiveTab();
    if (typeof tab.id !== 'number') throw new Error('active tab has no id');
    return tab.id;
  }

  /**
   * Pages whose URL begins with one of these schemes/hosts cannot be scripted —
   * `chrome.scripting.executeScript` will throw. We detect this up-front so
   * tools can return a friendly placeholder instead of a thrown error.
   */
  private isRestrictedUrl(url: string | undefined): boolean {
    if (!url) return false;
    return /^(chrome|edge|about|chrome-extension|moz-extension|view-source|devtools|file):/i.test(url)
      || /^https:\/\/(chrome|microsoftedge)\.google\.com\/webstore/i.test(url)
      || /^https:\/\/microsoftedge\.microsoft\.com\/addons/i.test(url);
  }

  private attachToolToStreamingMessage(chatId: string, toolCallId: string): void {
    const sid = this.streamingIds.get(chatId);
    if (!sid) {
      const id = `m${Date.now()}`;
      this.streamingIds.set(chatId, id);
      this.appendMessage(chatId, {
        id,
        role: 'assistant',
        text: '',
        pending: true,
        ts: Date.now(),
        toolCallIds: [toolCallId],
      });
      return;
    }
    this.mutateChat(chatId, (c) => ({
      ...c,
      messages: c.messages.map((m) => {
        if (m.id !== sid) return m;
        const ids = m.toolCallIds ?? [];
        if (ids.includes(toolCallId)) return m;
        return { ...m, toolCallIds: [...ids, toolCallId] };
      }),
    }));
  }

  private toggleToolExpanded(id: string): void {
    const next = new Set(this.toolExpanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.toolExpanded = next;
  }

  private appendDelta(chatId: string, chunk: string): void {
    const sid = this.streamingIds.get(chatId);
    if (!sid) {
      const id = `m${Date.now()}`;
      this.streamingIds.set(chatId, id);
      this.appendMessage(chatId, { id, role: 'assistant', text: chunk, pending: true, ts: Date.now() });
    } else {
      this.mutateChat(chatId, (c) => ({
        ...c,
        messages: c.messages.map((m) => m.id === sid ? { ...m, text: m.text + chunk } : m),
      }));
    }
    if (chatId === this.currentChatId) this.scrollToBottom();
  }

  private finishStream(chatId: string): void {
    const sid = this.streamingIds.get(chatId);
    if (!sid) return;
    this.mutateChat(chatId, (c) => ({
      ...c,
      messages: c.messages.map((m) => m.id === sid ? { ...m, pending: false } : m),
    }));
    this.streamingIds.delete(chatId);
  }

  private pushSystem(chatId: string, text: string, kind: ChatMessage['kind'] = 'normal'): void {
    this.appendMessage(chatId, {
      id: `s${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'system',
      text,
      kind,
      ts: Date.now(),
    });
    if (chatId === this.currentChatId) this.scrollToBottom();
  }

  private scrollToBottom(): void {
    queueMicrotask(() => {
      if (this.transcript) this.transcript.scrollTop = this.transcript.scrollHeight;
    });
  }

  // ----- bound-tab strip -------------------------------------------------
  private refreshBoundTab = (): void => {
    if (!this.connected) return;
    this.pwLoading = true;
    this.pwError = null;
    this.bridgeSend({ type: 'pw-status' });
  };

  private bindNewTab = (): void => {
    this.pwError = null;
    this.pwLoading = true;
    this.bridgeSend({ type: 'pw-bind' });
  };

  private unbindCurrentTab = (): void => {
    this.bridgeSend({ type: 'pw-unbind' });
  };

  private scheduleBoundTabRefreshes = (): void => {
    const delays = [1500, 3500, 6000, 10000, 15000];
    for (const ms of delays) {
      setTimeout(() => this.refreshBoundTab(), ms);
    }
  };

  // ----- send ------------------------------------------------------------
  private send = (): void => {
    const ta = this.textarea ?? (this.renderRoot.querySelector('#prompt-input') as HTMLTextAreaElement | null);
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) return;

    // Slash commands are intercepted before any bridge dispatch.
    if (text.startsWith('/')) {
      if (this.handleSlashCommand(text)) {
        ta.value = '';
        this.draftEmpty = true;
        return;
      }
    }

    // Ensure we have a current chat (could happen on cold start race).
    if (!this.currentChatId) this.startNewChat();
    const chatId = this.currentChatId;
    // Clear any leftover cancel marker so deltas for THIS new turn aren't
    // filtered out by a still-pending `done` from a previously cancelled turn.
    this.cancelledChats.delete(chatId);

    this.appendMessage(chatId, {
      id: `u${Date.now()}`, role: 'user', text, ts: Date.now(),
    });
    this.autoTitleIfNeeded(chatId, text);
    ta.value = '';
    this.draftEmpty = true;
    this.scrollToBottom();

    void this.dispatchPrompt(chatId, text);
  };

  /**
   * Slash-command router. Returns true if the input was handled here and
   * should not be sent to the model.
   */
  private handleSlashCommand(text: string): boolean {
    const [cmd, ...rest] = text.trim().slice(1).split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (cmd.toLowerCase()) {
      case 'new':
        this.startNewChat();
        return true;
      case 'clear':
        this.clearCurrentChat();
        return true;
      case 'export':
        if (this.currentChatId) this.exportChat(this.currentChatId);
        return true;
      case 'rename':
        if (this.currentChatId && arg) this.renameChat(this.currentChatId, arg);
        else this.renamingChatId = this.currentChatId;
        return true;
      case 'delete':
        if (this.currentChatId) this.deleteChat(this.currentChatId);
        return true;
      case 'search':
        this.searchOpen = true;
        if (arg) this.searchQuery = arg;
        return true;
      case 'help':
        this.pushSystem(this.currentChatId,
          'Slash commands: /new /clear /export /rename [title] /delete /search [query] /pin /tag add|rm [name] /stop /help\n' +
          'Shortcuts: Ctrl+N new · Ctrl+K search · Ctrl+B drawer · Ctrl+L clear · Ctrl+. stop · Ctrl+1..9 switch chat · Ctrl+/ cycle quick prompts · Esc close',
          'normal');
        return true;
      case 'pin':
        if (this.currentChatId) this.togglePin(this.currentChatId);
        return true;
      case 'stop':
        if (this.currentChatId) this.cancelStream(this.currentChatId);
        return true;
      case 'tag': {
        if (!this.currentChatId) return true;
        const sub = (rest[0] || '').toLowerCase();
        const tagName = rest.slice(1).join(' ').trim();
        if (sub === 'add' && tagName) this.addTagToChat(this.currentChatId, tagName);
        else if (sub === 'rm' && tagName) this.removeTagFromChat(this.currentChatId, tagName);
        else if (sub === 'list' || !sub) {
          const c = this.chats.find((x) => x.id === this.currentChatId);
          this.pushSystem(this.currentChatId, `tags: ${(c?.tags ?? []).join(', ') || '(none)'}`, 'normal');
        } else {
          this.pushSystem(this.currentChatId, 'Usage: /tag add <name> | /tag rm <name> | /tag list', 'normal');
        }
        return true;
      }
      default:
        return false;
    }
  }

  private async dispatchPrompt(chatId: string, text: string): Promise<void> {
    let prompt = text;
    try {
      prompt = await this.expandMentions(text);
      const tab = await this.getActiveTab().catch(() => null);
      if (tab) {
        const url = tab.url ?? '(unknown url)';
        const title = (tab.title ?? '').replace(/\s+/g, ' ').trim() || '(untitled)';
        prompt = `[Active tab: ${url} — ${title}]\n\n${prompt}`;
      }
    } catch (err) {
      console.warn('[AgentEdge] context prep failed; sending raw prompt', err);
    }

    const ok = this.bridgeSend({ type: 'prompt', chatId, text: prompt });
    if (!ok) this.pushSystem(chatId, 'not connected to bridge', 'error');
  }

  // Replace @page / @selection / @tabs / @tab:N inline so the user can be
  // explicit. Tools are still available to the model for on-demand fetches.
  private async expandMentions(text: string): Promise<string> {
    if (!/@(page|selection|tabs|tab:\d+|snapshot)\b/i.test(text)) return text;

    const replacements: Array<{ token: string; getValue: () => Promise<string> }> = [];
    const seen = new Set<string>();
    const tokenRegex = /@(page|selection|tabs|tab:\d+|snapshot)\b/gi;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(text)) !== null) {
      const token = match[0];
      if (seen.has(token.toLowerCase())) continue;
      seen.add(token.toLowerCase());
      const lower = token.toLowerCase();
      if (lower === '@page') {
        replacements.push({
          token,
          getValue: async () => {
            const r = (await this.executeTool('get_tab_content', {})) as {
              title?: string; url?: string; text?: string; restricted?: boolean;
            };
            if (r.restricted) {
              return `\n\n_(@page unavailable: ${r.url ?? 'this page'} is a browser-internal URL and cannot be read by extensions)_\n\n`;
            }
            return `\n\n--- ${r.title ?? ''} (${r.url ?? ''}) ---\n${r.text ?? ''}\n--- end ---\n\n`;
          },
        });
      } else if (lower === '@selection') {
        replacements.push({
          token,
          getValue: async () => {
            const r = (await this.executeTool('get_selection', {})) as { selection?: string; restricted?: boolean };
            if (r.restricted) return `\n\n_(@selection unavailable on browser-internal pages)_\n\n`;
            return r.selection ? `\n\n> ${r.selection.replace(/\n/g, '\n> ')}\n\n` : '';
          },
        });
      } else if (lower === '@tabs') {
        replacements.push({
          token,
          getValue: async () => {
            const r = (await this.executeTool('list_tabs', {})) as Array<Record<string, unknown>>;
            return `\n\n${JSON.stringify(r, null, 2)}\n\n`;
          },
        });
      } else if (lower === '@snapshot') {
        // `@snapshot` → markdown table of every open tab.
        replacements.push({
          token,
          getValue: async () => {
            const r = (await this.executeTool('list_tabs', {})) as Array<{
              id?: number; title?: string; url?: string; active?: boolean;
            }>;
            const rows = r.map((t) =>
              `| ${t.id ?? ''} | ${t.active ? '★' : ''} | ${(t.title ?? '').replace(/\|/g, '\\|').slice(0, 60)} | ${t.url ?? ''} |`
            ).join('\n');
            return `\n\n| id | * | title | url |\n| --- | --- | --- | --- |\n${rows}\n\n`;
          },
        });
      } else if (lower.startsWith('@tab:')) {
        const tabId = Number(lower.slice('@tab:'.length));
        replacements.push({
          token,
          getValue: async () => {
            const r = (await this.executeTool('get_tab_content', { tabId })) as {
              title?: string; url?: string; text?: string; restricted?: boolean;
            };
            if (r.restricted) {
              return `\n\n_(${token} unavailable: ${r.url ?? 'tab'} is a browser-internal URL)_\n\n`;
            }
            return `\n\n--- ${r.title ?? ''} (${r.url ?? ''}) ---\n${r.text ?? ''}\n--- end ---\n\n`;
          },
        });
      }
    }

    let result = text;
    for (const r of replacements) {
      try {
        const value = await r.getValue();
        // Replace all occurrences, case-insensitive.
        const rx = new RegExp(escapeRegExp(r.token), 'gi');
        result = result.replace(rx, value);
      } catch (err) {
        // Demoted to debug — restricted URLs and similar are expected;
        // the friendly placeholder is already inlined into the prompt.
        console.debug('[AgentEdge] mention expansion skipped for', r.token, err);
      }
    }
    return result;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  };

  private onInput = (e: Event): void => {
    const v = (e.target as HTMLTextAreaElement).value;
    this.draftEmpty = v.length === 0;
  };

  // ----- render ----------------------------------------------------------
  private fmtTime(ts: number): string {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 5);
  }

  private renderToolCard(tc: ToolCall) {
    // report_intent is the SDK's built-in narration tool — render as a slim
    // status line instead of a full tool card. The agent calls this on every
    // turn with a 4-word gerund describing what it's about to do.
    if (tc.toolName === 'report_intent') {
      const intent = (tc.arguments as { intent?: unknown } | undefined)?.intent;
      const text = typeof intent === 'string' && intent.trim() ? intent : '…';
      return html`<div class="intent-line" title="agent intent (report_intent)">› ${text}</div>`;
    }
    const expanded = this.toolExpanded.has(tc.toolCallId);
    const icon =
      tc.status === 'running' ? '◐' : tc.status === 'success' ? '●' : '✕';
    const elapsed = tc.finishedAt
      ? `${tc.finishedAt - tc.startedAt}ms`
      : tc.status === 'running'
        ? (tc.progress ?? 'running…')
        : '';
    const argsLine = tc.arguments && Object.keys(tc.arguments as object).length > 0
      ? JSON.stringify(tc.arguments)
      : '';
    const displayName = tc.mcpServerName ? `${tc.mcpServerName}:${tc.toolName}` : tc.toolName;
    return html`
      <div
        class="toolcall ${tc.status}"
        @click=${() => this.toggleToolExpanded(tc.toolCallId)}
        title="click to ${expanded ? 'collapse' : 'expand'}"
      >
        <div class="tc-head">
          <span class="tc-icon">${icon}</span>
          <span class="tc-name">${displayName}</span>
          <span class="tc-args">${argsLine}</span>
          <span class="tc-status">${elapsed}</span>
        </div>
        ${expanded
          ? html`<div class="tc-detail">
              ${tc.arguments
                ? html`<div class="tc-section">ARGS</div>${JSON.stringify(tc.arguments, null, 2)}`
                : nothing}
              ${tc.error
                ? html`<div class="tc-section">ERROR</div>${tc.error}`
                : tc.resultPreview
                  ? html`<div class="tc-section">RESULT</div>${tc.resultPreview}`
                  : nothing}
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderBubble(m: ChatMessage) {
    if (m.role === 'system') {
      return html`<div class="bubble">${m.text}</div>`;
    }
    if (m.role === 'user') {
      return html`<div class="bubble">${m.text}</div>`;
    }
    // assistant: tool cards (if any) above markdown body, append blinking caret while streaming
    const ids = m.toolCallIds ?? [];
    const cards = ids
      .map((id) => this.toolCalls.get(id))
      .filter((tc): tc is ToolCall => !!tc);
    const html_ = marked.parse(m.text || '') as string;
    return html`
      ${cards.length > 0
        ? html`<div class="toolcalls">${cards.map((tc) => this.renderToolCard(tc))}</div>`
        : nothing}
      ${m.text || !m.pending
        ? html`<div class="bubble">
            ${unsafeHTML(html_)}${m.pending && m.text ? html`<span class="caret"></span>` : nothing}
          </div>`
        : nothing}
    `;
  }

  private roleLabel(m: ChatMessage): string {
    if (m.role === 'user') return 'YOU';
    if (m.role === 'assistant') return 'COPILOT';
    if (m.kind === 'error') return 'ERROR';
    if (m.kind === 'denied') return 'DENIED';
    return 'SYSTEM';
  }

  // ----- debug panel rendering -----------------------------------------
  @state() private debugExpanded = new Set<string>();

  private toggleDebugRow(id: string): void {
    const next = new Set(this.debugExpanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.debugExpanded = next;
    this.requestUpdate();
  }

  private renderDebugPanel() {
    const path = this.bridgeLogFile;
    return html`
      <section class="debug">
        <div class="debug-bar">
          <span>BRIDGE TRACE · ${this.debugEntries.length}/${DEBUG_MAX_ENTRIES}</span>
          <span class="grow"></span>
          <button @click=${() => this.copyDebug()} title="Copy all entries">copy</button>
          <button @click=${() => this.clearDebug()} title="Clear panel">clear</button>
        </div>
        ${path
          ? html`<div
              class="debug-path"
              title="Click to copy log file path"
              @click=${() => navigator.clipboard?.writeText(path).catch(() => {})}
            >📁 ${path}</div>`
          : nothing}
        <div class="debug-list">
          ${this.debugEntries.length === 0
            ? html`<div class="debug-empty">no traffic yet — send a prompt</div>`
            : repeat(
                this.debugEntries,
                (e) => e.id,
                (e) => {
                  const expanded = this.debugExpanded.has(e.id);
                  const tag = e.kind === 'log' ? (e.level ?? 'log') : e.kind;
                  const cls = `debug-row ${e.kind} ${e.level ?? ''} ${expanded ? 'expanded' : ''}`;
                  return html`
                    <div class=${cls} @click=${() => this.toggleDebugRow(e.id)}>
                      <span class="ts">${this.fmtDebugTime(e.ts)}</span>
                      <span class="tag">${tag}</span>
                      <span class="summary">${e.summary}</span>
                      ${expanded && e.detail
                        ? html`<div class="debug-detail">${e.detail}</div>`
                        : nothing}
                    </div>
                  `;
                },
              )}
        </div>
      </section>
    `;
  }

  private fmtDebugTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }

  render() {
    const online = this.connected;
    const pid = this.bridgePid ?? '—';
    const cur = this.currentChat;
    return html`
      <header>
        <div class="header-row primary">
          <button
            class="icon-btn"
            @click=${() => { this.chatDrawerOpen = !this.chatDrawerOpen; }}
            title="Toggle chat drawer (Ctrl+B)"
            aria-label="Toggle chats"
          >☰</button>
          <span class="chat-title-pill" @click=${() => { if (cur) this.renamingChatId = cur.id; }}>
            ${cur ? cur.title : 'no chat'}
          </span>
          <span
            class="signal ${online ? 'on' : ''}"
            title=${online ? `Bridge live · v${this.bridgeVersion} · pid ${pid}` : 'Bridge offline'}
            aria-label=${online ? 'Bridge connected' : 'Bridge offline'}
          ><span class="pulse"></span></span>
          <span class="header-actions">
            <button
              class="icon-btn"
              @click=${() => { this.searchOpen = !this.searchOpen; }}
              title="Search chats (Ctrl+K)"
              aria-label="Search"
            >⌕</button>
            <button
              class="icon-btn ${this.debugOpen ? 'active' : ''}"
              @click=${() => this.toggleDebug()}
              title="Toggle bridge debug panel"
              aria-label="Toggle debug panel"
            >🐛</button>
            <button
              class="icon-btn"
              @click=${this.toggleTheme}
              title="Toggle light/dark theme"
              aria-label="Toggle theme"
            >${this.theme === 'dark' ? '☀' : '☾'}</button>
          </span>
        </div>
      </header>

      ${this.chatDrawerOpen ? this.renderDrawer() : nothing}
      ${this.searchOpen ? this.renderSearchOverlay() : nothing}
      ${this.debugOpen ? this.renderDebugPanel() : nothing}

      <main>
        ${this.messages.length === 0
          ? html`<div class="empty">
              <span class="glyph">/</span>
              what's on your mind?
            </div>`
          : repeat(
              this.messages,
              (m) => m.id,
              (m) => html`
                <div class="msg ${m.role} ${m.kind ?? ''}" @mouseleave=${() => { if (this.msgMenuId === m.id) this.msgMenuId = null; }}>
                  <div class="meta">
                    <span class="role">${this.roleLabel(m)}</span>
                    <span class="rule"></span>
                    <span class="ts">${this.fmtTime(m.ts)}</span>
                    <button class="msg-menu-btn" @click=${() => { this.msgMenuId = this.msgMenuId === m.id ? null : m.id; }} title="Actions">⋯</button>
                    ${this.msgMenuId === m.id ? html`
                      <span class="msg-menu">
                        <button @click=${() => this.copyMessage(m)} title="Copy">copy</button>
                        ${m.role === 'user' ? html`
                          <button @click=${() => this.regenerateFromMessage(this.currentChatId, m.id)} title="Re-send">resend</button>
                        ` : nothing}
                        <button @click=${() => this.deleteMessage(this.currentChatId, m.id)} title="Delete">del</button>
                      </span>
                    ` : nothing}
                  </div>
                  ${this.renderBubble(m)}
                </div>
              `,
            )}
      </main>

      <footer>
        <span class="sigil">›</span>
        <textarea
          id="prompt-input"
          rows="1"
          spellcheck="false"
          placeholder="message…  (try /help)"
          @keydown=${this.onKeyDown}
          @input=${this.onInput}
        ></textarea>
        ${this.currentChatId && this.streamingIds.has(this.currentChatId)
          ? html`<button
              class="send-btn stop-btn"
              @click=${() => this.cancelStream(this.currentChatId)}
              title="Stop generating (Ctrl+.)"
            >stop<span class="kbd">⎋</span></button>`
          : html`<button
              class="send-btn"
              @click=${this.send}
              ?disabled=${this.draftEmpty}
              title="Send (Enter)"
            >send<span class="kbd">↵</span></button>`}
      </footer>

      ${this.renderPwStrip()}
    `;
  }

  // ----- chat drawer ----------------------------------------------------
  private renderDrawer() {
    const ordered = this.orderedChats();
    const filter = this.drawerTagFilter;
    const filtered = filter ? ordered.filter((c) => (c.tags ?? []).includes(filter)) : ordered;
    const pinned = filtered.filter((c) => c.pinned);
    const others = filtered.filter((c) => !c.pinned);
    const tags = this.allTags();
    return html`
      <aside class="drawer" @click=${(e: Event) => e.stopPropagation()}>
        <div class="drawer-head">
          <span class="drawer-title">CHATS</span>
          <button class="icon-btn" @click=${() => this.startNewChat()} title="New chat (Ctrl+N)">＋</button>
          <button class="icon-btn" @click=${() => { this.chatDrawerOpen = false; }} title="Close (Esc)">×</button>
        </div>
        ${tags.length > 0 ? html`
          <div class="drawer-tagbar">
            <button
              class="tag-chip ${filter === null ? 'active' : ''}"
              @click=${() => { this.drawerTagFilter = null; }}
            >all</button>
            ${repeat(tags, (t) => t, (t) => html`
              <button
                class="tag-chip ${filter === t ? 'active' : ''}"
                @click=${() => { this.drawerTagFilter = filter === t ? null : t; }}
              >#${t}</button>
            `)}
          </div>
        ` : nothing}
        <div class="drawer-list">
          ${pinned.length > 0 ? html`
            <div class="drawer-subtitle">PINNED</div>
            ${repeat(pinned, (c) => c.id, (c) => this.renderChatRow(c))}
            <div class="drawer-subtitle">ALL</div>
          ` : nothing}
          ${repeat(others, (c) => c.id, (c) => this.renderChatRow(c))}
          ${filtered.length === 0 ? html`<div class="search-hint">no chats match #${filter}</div>` : nothing}
        </div>
        <div class="drawer-section">
          <div class="drawer-section-title">QUICK PROMPTS</div>
          ${repeat(this.quickPrompts, (q) => q.id, (q) => html`
            <button class="qp-btn" @click=${() => this.insertQuickPrompt(q)} title=${q.body}>
              ${q.label}
            </button>
          `)}
        </div>
      </aside>
      <div class="drawer-scrim" @click=${() => { this.chatDrawerOpen = false; }}></div>
    `;
  }

  private renderChatRow(c: Chat) {
    const isCurrent = c.id === this.currentChatId;
    const editing = this.renamingChatId === c.id;
    const tokens = Math.round(c.messages.reduce((n, m) => n + m.text.length, 0) / 4);
    const age = this.fmtRelative(c.updatedAt);
    const tags = c.tags ?? [];
    return html`
      <div class="chat-row ${isCurrent ? 'current' : ''}" @click=${() => !editing && this.switchChat(c.id)}>
        ${editing ? html`
          <input
            class="chat-rename"
            .value=${c.title}
            @click=${(e: Event) => e.stopPropagation()}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') { e.preventDefault(); this.renameChat(c.id, (e.target as HTMLInputElement).value); }
              else if (e.key === 'Escape') { this.renamingChatId = null; }
            }}
            @blur=${(e: FocusEvent) => this.renameChat(c.id, (e.target as HTMLInputElement).value)}
          />
        ` : html`
          <span class="chat-title">
            ${c.pinned ? html`<span class="pin-badge">★</span>` : ''}
            ${c.title}
          </span>
          <span class="chat-meta">
            ${c.messages.length} msg · ~${tokens} tok · ${age}
            ${tags.map((t) => html`<span class="tag-chip mini">#${t}</span>`)}
          </span>
        `}
        <button
          class="icon-btn ${c.pinned ? 'active' : ''}"
          @click=${(e: Event) => { e.stopPropagation(); this.togglePin(c.id); }}
          title=${c.pinned ? 'Unpin' : 'Pin chat'}
        >${c.pinned ? '★' : '☆'}</button>
        <button class="icon-btn" @click=${(e: Event) => { e.stopPropagation(); this.renamingChatId = c.id; }} title="Rename">✎</button>
        <button class="icon-btn" @click=${(e: Event) => { e.stopPropagation(); this.exportChat(c.id); }} title="Export to markdown">⬇</button>
        <button class="icon-btn" @click=${(e: Event) => { e.stopPropagation(); this.deleteChat(c.id); }} title="Delete chat">×</button>
      </div>
    `;
  }

  /** Compact relative time: 12s, 5m, 2h, 3d. */
  private fmtRelative(ts: number): string {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  }

  // ----- search overlay --------------------------------------------------
  /** Split `text` on `q` (case-insensitive), wrapping matches in <mark>. */
  private highlight(text: string, q: string) {
    if (!q) return text;
    const lower = text.toLowerCase();
    const ql = q.toLowerCase();
    const out: ReturnType<typeof html>[] = [];
    let i = 0;
    while (i < text.length) {
      const j = lower.indexOf(ql, i);
      if (j < 0) { out.push(html`${text.slice(i)}`); break; }
      if (j > i) out.push(html`${text.slice(i, j)}`);
      out.push(html`<mark class="hl">${text.slice(j, j + q.length)}</mark>`);
      i = j + q.length;
    }
    return out;
  }

  private fmtRelTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s`;
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
    return `${Math.round(diff / 86_400_000)}d`;
  }

  private renderSearchOverlay() {
    const q = this.searchQuery.trim();
    const ql = q.toLowerCase();
    type Hit = { chat: Chat; where: 'title' | 'message'; snippet: string };
    const matches: Hit[] = q ? this.chats
      .map((c): Hit | null => {
        if (c.title.toLowerCase().includes(ql)) {
          return { chat: c, where: 'title', snippet: '' };
        }
        const hit = c.messages.find((m) => m.text.toLowerCase().includes(ql));
        if (!hit) return null;
        const i = hit.text.toLowerCase().indexOf(ql);
        const start = Math.max(0, i - 40);
        const end = Math.min(hit.text.length, i + ql.length + 80);
        const snippet = (start > 0 ? '…' : '')
          + hit.text.slice(start, end).replace(/\s+/g, ' ').trim()
          + (end < hit.text.length ? '…' : '');
        return { chat: c, where: 'message', snippet };
      })
      .filter((x): x is Hit => x !== null)
      .slice(0, 30) : [];

    const activeIdx = matches.length > 0
      ? Math.min(this.searchActiveIdx, matches.length - 1)
      : 0;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.searchActiveIdx = Math.min(activeIdx + 1, matches.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.searchActiveIdx = Math.max(activeIdx - 1, 0);
      } else if (e.key === 'Enter' && matches[activeIdx]) {
        e.preventDefault();
        this.switchChat(matches[activeIdx].chat.id);
      }
    };

    return html`
      <div class="search-scrim" @click=${() => { this.searchOpen = false; }}>
        <div class="search-box" @click=${(e: Event) => e.stopPropagation()}>
          <div class="search-input-wrap">
            <span class="search-icon">⌕</span>
            <input
              class="search-input"
              placeholder="search chats…"
              .value=${this.searchQuery}
              autofocus
              @input=${(e: Event) => {
                this.searchQuery = (e.target as HTMLInputElement).value;
                this.searchActiveIdx = 0;
              }}
              @keydown=${onKey}
            />
            ${q ? html`<span class="search-count">${matches.length}</span>` : nothing}
          </div>
          <div class="search-results">
            ${q === ''
              ? html`<div class="search-hint">type to search across all chats <span class="kbd">↑↓</span> navigate <span class="kbd">↵</span> open <span class="kbd">esc</span> close</div>`
              : matches.length === 0
                ? html`<div class="search-hint">no matches for "${q}"</div>`
                : repeat(matches, (m) => m.chat.id, (m, idx) => {
                    const c = m.chat;
                    const meta = `${c.messages.length} msg · ${this.fmtRelTime(c.updatedAt)}`;
                    const isActive = idx === activeIdx;
                    return html`
                      <div
                        class="search-row ${isActive ? 'active' : ''}"
                        @click=${() => this.switchChat(c.id)}
                        @mouseenter=${() => { this.searchActiveIdx = idx; }}
                      >
                        <div class="search-row-head">
                          <div class="search-row-title">
                            ${c.pinned ? html`<span class="pin-badge">★</span>` : nothing}
                            ${m.where === 'title' ? this.highlight(c.title, q) : c.title}
                          </div>
                          <span class="search-row-where">${m.where === 'title' ? 'title' : 'message'}</span>
                          <span class="search-row-meta">${meta}</span>
                        </div>
                        ${m.where === 'message' ? html`
                          <div class="search-row-snippet">${this.highlight(m.snippet, q)}</div>
                        ` : nothing}
                      </div>
                    `;
                  })}
          </div>
        </div>
      </div>
    `;
  }

  private renderPwStrip() {
    const bt = this.boundTab;
    if (!bt) {
      // Empty state — single tight line, no label/dot/refresh noise.
      return html`
        <section class="pw-strip nobind">
          <div class="pw-row">
            <span class="pw-current empty">${this.pwError ?? 'no tab bound'}</span>
            <button
              class="pw-icon"
              @click=${(e: Event) => { e.stopPropagation(); this.bindNewTab(); }}
              title="Bind a tab — opens a Playwright connect dialog"
            >＋ bind tab</button>
          </div>
        </section>
      `;
    }
    const status = bt.status;
    const statusDot = status === 'connected' ? '●'
      : status === 'waiting-for-connect' ? '◌'
      : status === 'dead' ? '✕' : '○';
    const statusCls = status === 'connected' ? 'ok'
      : status === 'waiting-for-connect' ? 'wait'
      : status === 'dead' ? 'dead' : 'empty';
    const label = bt.title || bt.url || (status === 'waiting-for-connect' ? 'waiting for Connect…' : '(no page)');
    const sub = bt.url ?? '';
    return html`
      <section class="pw-strip">
        <div class="pw-row pw-header">
          <span class="pw-status ${statusCls}" title=${status}>${statusDot}</span>
          <span class="pw-current ${this.pwError ? 'error' : ''}" title=${sub}>
            ${this.pwError ?? label}
          </span>
          <button
            class="pw-icon"
            @click=${(e: Event) => { e.stopPropagation(); this.refreshBoundTab(); }}
            title="Refresh status"
          >${this.pwLoading ? '◐' : '⟳'}</button>
          <button
            class="pw-icon"
            @click=${(e: Event) => { e.stopPropagation(); this.bindNewTab(); }}
            title="Re-bind to a different tab (replaces current)"
          >＋</button>
          <button
            class="pw-icon close"
            @click=${(e: Event) => { e.stopPropagation(); this.unbindCurrentTab(); }}
            title="Unbind tab"
          >×</button>
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'agent-edge-app': AgentEdgeApp;
  }
}
