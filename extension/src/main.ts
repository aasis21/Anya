import { LitElement, css, html, nothing } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { marked } from 'marked';
import { nativeBridge, type Frame } from './native-bridge.js';

type Role = 'user' | 'assistant' | 'system';

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  pending?: boolean;
  kind?: 'normal' | 'pong' | 'error' | 'denied' | 'hello';
  ts: number;
}

marked.setOptions({ gfm: true, breaks: true });

@customElement('agent-edge-app')
export class AgentEdgeApp extends LitElement {
  static styles = css`
    /* ===========================================================
       AGENTEDGE / editorial-brutalist chat
       Bone on near-black. Signal-red as the only accent.
       Monospace everything. No rounded corners.
       =========================================================== */
    :host {
      --bg:        #0c0c0c;
      --bg-rule:   #1a1a1a;
      --bg-soft:   #141414;
      --bg-bubble: #131313;
      --fg:        #ebe4d3;       /* bone */
      --fg-dim:    #8a8576;
      --fg-faint:  #4a4740;
      --accent:    #ff3300;       /* signal red */
      --accent-soft: rgba(255, 51, 0, 0.10);
      --grid:      rgba(235, 228, 211, 0.022);
      --strong:    #ffffff;
      --code-bg:   #000000;
      --code-fg:   #ebe4d3;
    }
    :host([theme="light"]) {
      --bg:        #f5f0e6;       /* cream */
      --bg-rule:   #d8d2c4;
      --bg-soft:   #ece6d6;
      --bg-bubble: #ece6d6;
      --fg:        #1a1a1a;       /* ink */
      --fg-dim:    #6b6655;
      --fg-faint:  #aaa498;
      --accent:    #d92e00;
      --accent-soft: rgba(217, 46, 0, 0.08);
      --grid:      rgba(0, 0, 0, 0.025);
      --strong:    #000000;
      --code-bg:   #2b2620;       /* dark brown so red code still pops on cream */
      --code-fg:   #f5f0e6;
    }
    :host {

      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      background:
        linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 22px,
        var(--bg);
      color: var(--fg);
      font-family: 'JetBrains Mono', 'Cascadia Code', 'Consolas', ui-monospace, monospace;
      font-size: 12.5px;
      line-height: 1.55;
      letter-spacing: 0.005em;
    }

    /* ---------- STATUS LINE ---------- */
    header {
      display: grid;
      grid-template-columns: 1fr auto auto;
      align-items: center;
      gap: 10px;
      padding: 10px 14px 8px;
      border-bottom: 1px solid var(--bg-rule);
      flex: 0 0 auto;
    }
    .brand {
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-size: 11px;
    }
    .brand .slash { color: var(--accent); padding: 0 2px; }
    .status-line {
      display: flex; gap: 14px;
      font-size: 9.5px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      color: var(--fg-dim);
      overflow: hidden; white-space: nowrap;
    }
    .status-line .key { color: var(--fg-faint); margin-right: 4px; }
    .status-line .val { color: var(--fg); }
    .signal {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 9.5px; letter-spacing: 0.10em; text-transform: uppercase;
      color: var(--fg-dim);
    }
    .signal .pulse {
      width: 7px; height: 7px;
      background: var(--fg-faint);
      transition: background 200ms ease, box-shadow 200ms ease;
    }
    .signal.on .pulse {
      background: var(--accent);
      box-shadow: 0 0 0 0 rgba(255,51,0,0.5);
      animation: pulse 1.6s ease-out infinite;
    }
    .theme-toggle {
      background: transparent;
      border: 1px solid var(--bg-rule);
      color: var(--fg-dim);
      font: inherit;
      font-size: 10px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      padding: 4px 8px;
      cursor: pointer;
      transition: color 150ms ease, border-color 150ms ease;
    }
    .theme-toggle:hover {
      color: var(--accent);
      border-color: var(--accent);
    }
    @keyframes pulse {
      0%   { box-shadow: 0 0 0 0 rgba(255,51,0,0.45); }
      70%  { box-shadow: 0 0 0 6px rgba(255,51,0,0); }
      100% { box-shadow: 0 0 0 0 rgba(255,51,0,0); }
    }

    /* ---------- TRANSCRIPT ---------- */
    main {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 18px 0 8px;
      scroll-behavior: smooth;
    }
    main::-webkit-scrollbar { width: 8px; }
    main::-webkit-scrollbar-thumb { background: var(--bg-rule); }
    main::-webkit-scrollbar-thumb:hover { background: var(--fg-faint); }

    .empty {
      padding: 60px 18px;
      color: var(--fg-faint);
      font-size: 11px;
      text-align: center;
      letter-spacing: 0.06em;
    }
    .empty .glyph {
      color: var(--accent);
      font-size: 28px;
      display: block;
      margin-bottom: 10px;
      font-weight: 700;
    }
    .empty .hint {
      margin-top: 14px;
      color: var(--fg-dim);
      font-size: 10px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
    }

    .msg {
      padding: 4px 14px 14px;
      animation: slideIn 180ms ease-out;
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .msg .meta {
      display: flex; align-items: center; gap: 8px;
      font-size: 9.5px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--fg-faint);
      margin-bottom: 4px;
    }
    .msg .meta .role { color: var(--fg-dim); font-weight: 700; }
    .msg.user   .meta .role { color: var(--accent); }
    .msg.system .meta .role { color: var(--fg-faint); }
    .msg .meta .rule {
      flex: 1; height: 1px; background: var(--bg-rule);
    }
    .msg .meta .ts { color: var(--fg-faint); }

    .bubble {
      padding: 10px 12px;
      background: var(--bg-bubble);
      border-left: 2px solid var(--bg-rule);
      color: var(--fg);
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .msg.user .bubble {
      border-left-color: var(--accent);
      background: var(--accent-soft);
    }
    .msg.system .bubble {
      background: transparent;
      color: var(--fg-dim);
      font-size: 11px;
      border-left-color: var(--fg-faint);
    }
    .msg.system.error .bubble {
      color: var(--accent);
      border-left-color: var(--accent);
      background: var(--accent-soft);
    }
    .msg.system.pong .bubble {
      color: var(--accent);
      font-weight: 700;
      letter-spacing: 0.20em;
    }

    /* markdown inside bubbles */
    .bubble :first-child { margin-top: 0; }
    .bubble :last-child  { margin-bottom: 0; }
    .bubble p { margin: 0 0 8px; }
    .bubble strong { color: var(--strong); font-weight: 700; }
    .bubble em { color: var(--fg-dim); font-style: normal; text-decoration: underline; text-decoration-color: var(--fg-faint); }
    .bubble code {
      background: var(--code-bg);
      padding: 1px 5px;
      color: var(--accent);
      font-size: 0.92em;
    }
    .bubble pre {
      background: var(--code-bg);
      border-left: 2px solid var(--accent);
      padding: 10px 12px;
      margin: 8px 0;
      overflow-x: auto;
      font-size: 11.5px;
    }
    .bubble pre code { background: transparent; padding: 0; color: var(--code-fg); }
    .bubble ul, .bubble ol { margin: 6px 0 8px; padding-left: 22px; }
    .bubble li { margin: 2px 0; }
    .bubble li::marker { color: var(--accent); }
    .bubble a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
    .bubble h1, .bubble h2, .bubble h3 {
      font-size: 12.5px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      color: var(--fg);
      margin: 12px 0 6px;
      border-bottom: 1px solid var(--bg-rule);
      padding-bottom: 3px;
    }
    .bubble blockquote {
      border-left: 2px solid var(--fg-faint);
      padding-left: 10px;
      margin: 6px 0;
      color: var(--fg-dim);
    }
    .bubble hr { border: none; border-top: 1px dashed var(--bg-rule); margin: 12px 0; }

    .caret {
      display: inline-block;
      width: 7px; height: 13px;
      background: var(--accent);
      vertical-align: -2px;
      margin-left: 2px;
      animation: blink 1s steps(2, start) infinite;
    }
    @keyframes blink { to { visibility: hidden; } }

    /* ---------- COMPOSER ---------- */
    footer {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: stretch;
      border-top: 1px solid var(--bg-rule);
      background: var(--bg);
      flex: 0 0 auto;
    }
    .sigil {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 13px 8px 0 14px;
      color: var(--accent);
      font-weight: 700;
      font-size: 14px;
      user-select: none;
      letter-spacing: 0;
    }
    textarea {
      resize: none;
      min-height: 44px;
      max-height: 160px;
      background: transparent;
      color: var(--fg);
      border: none;
      padding: 12px 6px;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.5;
      outline: none;
      caret-color: var(--accent);
    }
    textarea::placeholder { color: var(--fg-faint); }

    .send-btn {
      display: flex; align-items: center; gap: 8px;
      background: transparent;
      color: var(--fg-dim);
      border: none;
      border-left: 1px solid var(--bg-rule);
      padding: 0 16px;
      cursor: pointer;
      font-family: inherit;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      transition: color 120ms ease, background 120ms ease;
    }
    .send-btn:hover { color: var(--accent); background: var(--bg-soft); }
    .send-btn .kbd {
      display: inline-block;
      padding: 2px 5px;
      border: 1px solid var(--fg-faint);
      color: var(--fg);
      font-size: 10px;
      letter-spacing: 0;
    }
    .send-btn:hover .kbd { border-color: var(--accent); color: var(--accent); }
    .send-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .send-btn:disabled:hover { color: var(--fg-dim); background: transparent; }
    .send-btn:disabled:hover .kbd { border-color: var(--fg-faint); color: var(--fg); }
  `;

  @state() private connected = false;
  @state() private bridgePid: number | null = null;
  @state() private bridgeVersion = '?';
  @state() private messages: ChatMessage[] = [];
  @state() private theme: 'dark' | 'light' = 'dark';
  @state() private draftEmpty = true;
  @query('main') private transcript!: HTMLElement;
  @query('#prompt-input') private textarea!: HTMLTextAreaElement;

  private unsubMessage?: () => void;
  private unsubDisconnect?: () => void;
  private streamingId: string | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubMessage = nativeBridge.onMessage((f) => this.handleFrame(f));
    this.unsubDisconnect = nativeBridge.onDisconnect(() => {
      this.connected = false;
      this.streamingId = null;
      // status line LIVE → OFFLINE conveys this; no in-chat noise
    });
    nativeBridge.connect();
    this.connected = nativeBridge.isConnected();
    this.loadTheme();
    // Hidden dev escape hatch — invisible to users
    (window as any).agentEdge = {
      ping: () => nativeBridge.send({ type: 'ping' }),
      echo: (text: string) => nativeBridge.send({ type: 'echo', text }),
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

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubMessage?.();
    this.unsubDisconnect?.();
  }

  // ----- frame handling --------------------------------------------------
  private handleFrame(f: Frame): void {
    this.connected = true;
    const data = f as any;
    switch (f.type) {
      case 'hello':
        this.bridgePid = Number(data.pid) || null;
        this.bridgeVersion = String(data.version ?? '?');
        break;
      case 'pong':
        // dev healthcheck — no UI surface
        console.debug('[AgentEdge] pong');
        break;
      case 'echo-reply':
        console.debug('[AgentEdge] echo:', String(data.text ?? ''));
        break;
      case 'delta':
        this.appendDelta(String(data.text ?? ''));
        break;
      case 'done':
        this.finishStream();
        break;
      case 'message':
        // Final full message; ignored — deltas already painted it.
        break;
      case 'error':
        this.finishStream();
        this.pushSystem(`error: ${String(data.message ?? '')}`, 'error');
        break;
      case 'permission-denied':
        this.pushSystem(
          `permission denied (${String(data.kind ?? '?')}). ${String(data.message ?? '')}`,
          'denied',
        );
        break;
      default:
        console.debug('[AgentEdge] unknown frame:', f);
    }
  }

  private appendDelta(chunk: string): void {
    if (!this.streamingId) {
      const id = `m${Date.now()}`;
      this.streamingId = id;
      this.messages = [
        ...this.messages,
        { id, role: 'assistant', text: chunk, pending: true, ts: Date.now() },
      ];
    } else {
      this.messages = this.messages.map((m) =>
        m.id === this.streamingId ? { ...m, text: m.text + chunk } : m,
      );
    }
    this.scrollToBottom();
  }

  private finishStream(): void {
    if (!this.streamingId) return;
    const id = this.streamingId;
    this.messages = this.messages.map((m) => (m.id === id ? { ...m, pending: false } : m));
    this.streamingId = null;
  }

  private pushSystem(text: string, kind: ChatMessage['kind'] = 'normal'): void {
    this.messages = [
      ...this.messages,
      { id: `s${Date.now()}-${Math.random()}`, role: 'system', text, kind, ts: Date.now() },
    ];
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    queueMicrotask(() => {
      if (this.transcript) this.transcript.scrollTop = this.transcript.scrollHeight;
    });
  }

  // ----- send ------------------------------------------------------------
  private send = (): void => {
    const ta = this.textarea ?? (this.renderRoot.querySelector('#prompt-input') as HTMLTextAreaElement | null);
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) return;

    this.messages = [
      ...this.messages,
      { id: `u${Date.now()}`, role: 'user', text, ts: Date.now() },
    ];
    ta.value = '';
    this.draftEmpty = true;
    this.scrollToBottom();

    let frame: { type: string; text?: string } = { type: 'prompt', text };

    const ok = nativeBridge.send(frame);
    if (!ok) this.pushSystem('not connected to bridge', 'error');
  };

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

  private renderBubble(m: ChatMessage) {
    if (m.role === 'system') {
      return html`<div class="bubble">${m.text}</div>`;
    }
    if (m.role === 'user') {
      return html`<div class="bubble">${m.text}</div>`;
    }
    // assistant: render markdown, append blinking caret while streaming
    const html_ = marked.parse(m.text || '') as string;
    return html`<div class="bubble">
      ${unsafeHTML(html_)}${m.pending ? html`<span class="caret"></span>` : nothing}
    </div>`;
  }

  private roleLabel(m: ChatMessage): string {
    if (m.role === 'user') return 'YOU';
    if (m.role === 'assistant') return 'COPILOT';
    if (m.kind === 'error') return 'ERROR';
    if (m.kind === 'denied') return 'DENIED';
    return 'SYSTEM';
  }

  render() {
    const online = this.connected;
    const pid = this.bridgePid ?? '—';
    return html`
      <header>
        <div class="status-line">
          <span><span class="key">VER</span><span class="val">${this.bridgeVersion}</span></span>
          <span><span class="key">PID</span><span class="val">${pid}</span></span>
        </div>
        <span class="signal ${online ? 'on' : ''}">
          <span class="pulse"></span>${online ? 'LIVE' : 'OFFLINE'}
        </span>
        <button class="theme-toggle" @click=${this.toggleTheme} title="Toggle light/dark">
          ${this.theme === 'dark' ? '☀ LIGHT' : '☾ DARK'}
        </button>
      </header>

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
                <div class="msg ${m.role} ${m.kind ?? ''}">
                  <div class="meta">
                    <span class="role">${this.roleLabel(m)}</span>
                    <span class="rule"></span>
                    <span class="ts">${this.fmtTime(m.ts)}</span>
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
          placeholder="message…"
          @keydown=${this.onKeyDown}
          @input=${this.onInput}
        ></textarea>
        <button
          class="send-btn"
          @click=${this.send}
          ?disabled=${this.draftEmpty}
          title="Send (Enter)"
        >
          send<span class="kbd">↵</span>
        </button>
      </footer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'agent-edge-app': AgentEdgeApp;
  }
}
