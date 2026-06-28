/**
 * Anya sidebar — the Lit component that wires the browser to the local Copilot bridge.
 *
 * High-level layout (top → bottom of the file):
 *   1. Imports + small pure helpers (summariseTab).
 *   2. AnyaApp (`<anya-app>`):
 *        - reactive @state fields (UI + chat store + debug)
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
  WebSpeechInput,
  WebSpeechOutput,
  DEFAULT_SPEECH_SETTINGS,
  type SpeechInput,
  type SpeechOutput,
  type SpeechSettings,
} from './speech/index.js';
import {
  type ToolCall,
  type ChatMessage,
  type Chat,
  type QuickPrompt,
  type DebugEntry,
  type FocusedField,
  type ContextAttachment,
  ATTACHMENT_VALUE_CAP,
  DEFAULT_QUICK_PROMPTS,
  DEBUG_MAX_ENTRIES,
  TOOL_GROUPS,
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

// --------------- friendly tool display ---------------
const TOOL_LABELS: Record<string, string> = {
  get_active_tab: 'Current Tab',
  get_tab_content: 'Page Content',
  get_selection: 'Selection',
  list_tabs: 'Open Tabs',
  open_tab: 'Open Tab',
  close_tab: 'Close Tab',
  focus_tab: 'Switch Tab',
  browse_history: 'History',
  browse_downloads: 'Downloads',
  search_chats: 'Chat History',
  manage_bookmarks: 'Bookmarks',
  connect_browser: 'Connect',
  disconnect_browser: 'Disconnect',
  bound_tabs: 'Status',
  drive_tab: 'Interact',
  drive_browser: 'Manage Tabs',
  drive_context: 'Data & State',
  drive_devtools: 'Inspect',
};

function toTitleWords(value: string): string {
  const ACRONYMS = new Set(['api', 'cli', 'cdp', 'id', 'mcp', 'sdk', 'ui', 'url']);
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim();
  if (!normalized) return value;
  return normalized
    .split(/\s+/)
    .map((part) => {
      const lower = part.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function formatToolDisplayName(toolName: string, mcpServerName?: string): string {
  const localLabel = TOOL_LABELS[toolName] ?? toTitleWords(toolName);
  if (!mcpServerName) return localLabel;
  return `${toTitleWords(mcpServerName)}:${localLabel}`;
}

/** Produce a short, human-readable summary of tool arguments. */
function friendlyArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  switch (toolName) {
    case 'powershell':
      if (typeof a.description === 'string' && a.description) return a.description;
      if (typeof a.command === 'string' && a.command) return a.command.length > 60 ? a.command.slice(0, 57) + '…' : a.command;
      return '';
    case 'open_tab':
      return typeof a.url === 'string' ? shortenUrl(a.url) : '';
    case 'close_tab':
      if (Array.isArray(a.tabIds)) return `${a.tabIds.length} tabs`;
      if (typeof a.tabId === 'number') return `tab ${a.tabId}`;
      return 'active tab';
    case 'focus_tab':
      return typeof a.tabId === 'number' ? `tab ${a.tabId}` : '';
    case 'get_tab_content':
    case 'get_selection':
      return typeof a.tabId === 'number' ? `tab ${a.tabId}` : '';
    case 'list_tabs':
      return typeof a.windowId === 'number' ? `window ${a.windowId}` : '';
    case 'browse_history':
      return typeof a.query === 'string' && a.query ? `"${a.query}"` : '';
    case 'browse_downloads':
      if (typeof a.query === 'string' && a.query) return `"${a.query}"`;
      if (typeof a.state === 'string' && a.state) return a.state;
      return '';
    case 'manage_bookmarks':
      return typeof a.op === 'string' ? a.op : '';
    case 'connect_browser':
      return typeof a.browser === 'string' && a.browser !== 'msedge' ? a.browser : '';
    case 'drive_tab':
    case 'drive_browser':
    case 'drive_context':
    case 'drive_devtools':
      if (Array.isArray(a.argv) && a.argv.length > 0) return friendlyArgv(a.argv as string[]);
      return '';
    case 'view': {
      if (typeof a.path !== 'string') return '';
      const short = a.path.replace(/^.*[\\/]/, '');
      if (Array.isArray(a.view_range)) return `${short} [${(a.view_range as number[]).join('–')}]`;
      return short;
    }
    case 'edit': {
      if (typeof a.path !== 'string') return '';
      return a.path.replace(/^.*[\\/]/, '');
    }
    case 'create': {
      if (typeof a.path !== 'string') return '';
      return a.path.replace(/^.*[\\/]/, '');
    }
    case 'grep': {
      if (typeof a.pattern !== 'string') return '';
      const pat = a.pattern.length > 40 ? a.pattern.slice(0, 37) + '…' : a.pattern;
      const scope = typeof a.glob === 'string' ? ` in ${a.glob}` : '';
      return `/${pat}/${scope}`;
    }
    case 'glob':
      return typeof a.pattern === 'string' ? a.pattern : '';
    case 'web_fetch':
      return typeof a.url === 'string' ? shortenUrl(a.url) : '';
    case 'task': {
      if (typeof a.description === 'string' && a.description) return a.description;
      if (typeof a.name === 'string' && a.name) return a.name;
      return typeof a.agent_type === 'string' ? a.agent_type : '';
    }
    case 'sql':
      if (typeof a.description === 'string' && a.description) return a.description;
      return '';
    case 'read_agent':
    case 'write_agent':
      return typeof a.agent_id === 'string' ? a.agent_id : '';
    case 'session_store_sql':
      if (typeof a.description === 'string' && a.description) return a.description;
      return '';
    default:
      return '';
  }
}

/** Summarise a playwright-cli argv into a readable phrase. */
function friendlyArgv(argv: string[]): string {
  const cmd = argv[0] ?? '';
  const rest = argv.slice(1);
  switch (cmd) {
    case 'goto': return rest[0] ? shortenUrl(rest[0]) : 'navigate';
    case 'click': return rest[0] ? `click ${rest[0]}` : 'click';
    case 'dblclick': return rest[0] ? `double-click ${rest[0]}` : 'double-click';
    case 'type': return rest[0] ? `type "${trunc(rest[0], 30)}"` : 'type';
    case 'fill': return rest.length >= 2 ? `fill ${rest[0]}` : 'fill';
    case 'press': return rest[0] ? `press ${rest[0]}` : 'press';
    case 'hover': return rest[0] ? `hover ${rest[0]}` : 'hover';
    case 'select': return rest[0] ? `select ${rest[0]}` : 'select';
    case 'check': return rest[0] ? `check ${rest[0]}` : 'check';
    case 'uncheck': return rest[0] ? `uncheck ${rest[0]}` : 'uncheck';
    case 'screenshot': return 'screenshot';
    case 'pdf': return 'save PDF';
    case 'snapshot': return 'snapshot';
    case 'eval': return 'evaluate';
    case 'run-code': return 'run code';
    case 'reload': return 'reload';
    case 'go-back': return 'back';
    case 'go-forward': return 'forward';
    case 'tab-list': return 'list tabs';
    case 'tab-new': return rest[0] ? `new tab → ${shortenUrl(rest[0])}` : 'new tab';
    case 'tab-close': return rest[0] ? `close tab ${rest[0]}` : 'close tab';
    case 'tab-select': return rest[0] ? `switch to tab ${rest[0]}` : 'switch tab';
    case 'resize': return rest.length >= 2 ? `resize ${rest[0]}×${rest[1]}` : 'resize';
    case 'cookie-list': return 'list cookies';
    case 'cookie-get': return rest[0] ? `cookie "${rest[0]}"` : 'get cookie';
    case 'cookie-set': return rest[0] ? `set cookie "${rest[0]}"` : 'set cookie';
    case 'cookie-clear': return 'clear cookies';
    case 'localstorage-list': return 'list localStorage';
    case 'localstorage-get': return rest[0] ? `localStorage "${rest[0]}"` : 'get localStorage';
    case 'console': return rest[0] ? `console (${rest[0]})` : 'console';
    case 'network': return 'network requests';
    case 'tracing-start': return 'start tracing';
    case 'tracing-stop': return 'stop tracing';
    case 'dialog-accept': return 'accept dialog';
    case 'dialog-dismiss': return 'dismiss dialog';
    default: return argv.join(' ');
  }
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return trunc(u.hostname + path, 40);
  } catch {
    return trunc(url, 40);
  }
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

@customElement('anya-app')
export class AnyaApp extends LitElement {
  static styles = sidebarStyles;

  @state() private connected = false;
  @state() private bridgePid: number | null = null;
  @state() private bridgeVersion = '?';
  @state() private bridgeLogFile: string | null = null;
  @state() private theme: 'dark' | 'light' = 'dark';
  @state() private draftEmpty = true;
  /** Mirror of textarea content. Drives the highlight overlay so recognised
   *  `@-mentions` show the accent colour as the user types. Kept in sync with
   *  the textarea via `syncDraft()` (called from `onInput`, `send()`,
   *  `applyAutocomplete()`, quick-prompt insert, etc.). */
  @state() private composerText = '';
  @state() private isPopupMode = false;
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

  // Drawer tag filter — null shows all chats, otherwise filters by tag.
  @state() private drawerTagFilter: string | null = null;
  // Chats whose stream the user cancelled. We keep painting nothing for further
  // deltas until the bridge sends `done`, then we drop the id.
  private cancelledChats: Set<string> = new Set();
  @state() private followTranscript = true;
  @state() private hasNewBelow = false;
  // Per-message hover toolbar — id of the message whose ⋯ menu is open.
  @state() private msgMenuId: string | null = null;

  // Tools settings panel — lets the user enable/disable individual tools.
  @state() private toolsPanelOpen = false;
  @state() private disabledTools: Set<string> = new Set();
  // Tracks which tool groups are collapsed in the panel.
  @state() private toolGroupCollapsed: Set<string> = new Set();

  // Field-assist: tracks the text field the user last focused on a page.
  // `focusedField` is set silently on focus (powers Insert/Append buttons).
  @state() private focusedField: FocusedField | null = null;
  private fieldBlurTimer: ReturnType<typeof setTimeout> | null = null;

  // Context attachments: collected via "Add to Anya" right-click, @mentions, 📎 menu, paste.
  // Stacked as chips above the composer, injected into prompts on send.
  @state() private contextAttachments: ContextAttachment[] = [];

  // 📎 attach menu popup
  @state() private attachMenuOpen = false;

  // Send-options dropdown (visible while streaming)
  @state() private sendMenuOpen = false;
  // Header overflow menu
  @state() private headerMenuOpen = false;
  // Model selector
  @state() private availableModels: Array<{ id: string; name: string; contextWindow?: number; billingMultiplier?: number }> = [];
  @state() private selectedModel = '';   // empty = SDK default ("Auto")
  @state() private modelMenuOpen = false;
  // Workspace selector
  @state() private workspaceMenuOpen = false;

  // Voice I/O
  @state() private speechSettings: SpeechSettings = { ...DEFAULT_SPEECH_SETTINGS };
  @state() private speechMenuOpen = false;
  @state() private isListening = false;
  @state() private isSpeaking = false;
  @state() private speechNotice = '';
  private speechNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  private speechInput: SpeechInput = new WebSpeechInput();
  private speechOutput: SpeechOutput = new WebSpeechOutput();
  /** Buffer for streaming TTS — accumulates delta text until a sentence boundary. */
  private _speechBuffer = '';
  private _speechStreamingFor: string | null = null;
  // Approval mode: true = auto-approve all, false = ask user for write tools
  @state() private autoApprove = true;
  /** Pending permission requests from the bridge, keyed by requestId. */
  private pendingApprovals = new Map<string, { chatId: string; toolName: string; kind: string; args?: unknown }>();
  /** Client-side queue for prompts sent while streaming. Drained in finishStream. */
  private pendingQueue: Array<{ chatId: string; text: string; ctx: ContextAttachment[] }> = [];

  // Input history: cycle through previous user inputs with Up/Down arrows.
  private inputHistory: string[] = [];
  private historyIdx = -1;        // -1 = not browsing history
  private historyDraft = '';      // stash current draft when entering history mode

  // Inline autocomplete for `/` and `@` triggers.
  @state() private autocomplete: {
    kind: 'slash' | 'at';
    startIdx: number;     // index of the `/` or `@` char in the textarea value
    query: string;        // chars typed after the trigger (lowercased on use)
    selectedIdx: number;  // currently highlighted item in the filtered list
  } | null = null;

  // Static catalogs — keep in sync with /help and the README composer table.
  private static readonly SLASH_CATALOG: ReadonlyArray<{ token: string; description: string; insert?: string }> = [
    { token: '/new',     description: 'start a fresh chat (Ctrl+N)' },
    { token: '/clear',   description: 'wipe current chat (Ctrl+L)' },
    { token: '/rename',  description: 'rename current chat',          insert: '/rename ' },
    { token: '/delete',  description: 'delete current chat' },
    { token: '/pin',     description: 'toggle pin on current chat' },
    { token: '/tag',     description: 'add | rm | list tags',         insert: '/tag ' },
    { token: '/search',  description: 'open chat search (Ctrl+K)',    insert: '/search ' },
    { token: '/export',  description: 'download chat as Markdown' },
    { token: '/stop',    description: 'cancel in-flight stream (Ctrl+.)' },
    { token: '/open',    description: 'open a folder as chat context',   insert: '/open ' },
    { token: '/help',    description: 'show this list inside chat' },
  ];

  private static readonly AT_CATALOG: ReadonlyArray<{ token: string; description: string; insert?: string; chipKind?: string }> = [
    { token: '@tab',        description: 'active tab as Markdown',                     chipKind: 'tab' },
    { token: '@selection',  description: 'highlighted text on the active tab',          chipKind: 'selection' },
    { token: '@url',        description: 'active tab URL',                             chipKind: 'url' },
    { token: '@title',      description: 'active tab title',                           chipKind: 'title' },
    { token: '@clipboard',  description: 'system clipboard text',                      chipKind: 'clipboard' },
    { token: '@tabs',       description: 'markdown table of every open tab',           chipKind: 'tabs' },
    { token: '@tab:',       description: 'one tab — id or substring of title/url', insert: '@tab:' },
    { token: '@bookmark:',  description: 'search bookmarks by name',              insert: '@bookmark:' },
  ];
  /** Native messaging caps frames near 4MB. base64 inflates ~1.33×. */
  private static readonly ATTACHMENT_TOTAL_LIMIT = 3 * 1024 * 1024;

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
  /** Coalesced streaming text chunks per chat to reduce re-render churn. */
  private pendingDeltaByChat: Map<string, string> = new Map();
  private deltaFlushTimerByChat: Map<string, number> = new Map();
  private persistTimer: number | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    // Detect if running in a popup window (expanded mode)
    const params = new URLSearchParams(window.location.search);
    this.isPopupMode = params.get('popup') === '1';
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
    void this.loadDisabledTools();
    void this.loadAutoApprove();
    void this.loadChats();
    void this.loadQuickPrompts();
    void this.loadInputHistory();
    void this.loadSpeechSettings();
    window.addEventListener('keydown', this.onGlobalKey);
    this.renderRoot.addEventListener('click', this.onRootClick);
    // Listen for page-bridge messages (context attachments, field tracking).
    chrome.runtime.onMessage.addListener(this.onPageBridgeMessage);
    // Listen for voice transcript from the voice sidebar.
    chrome.runtime.onMessage.addListener(this.onSpeechTranscript);
    // Check for pending context attachments buffered before the sidebar opened.
    void this.loadPendingAttachments();
    // Hidden dev escape hatch — invisible to users
    (window as any).anya = {
      ping: () => this.bridgeSend({ type: 'ping' }),
      echo: (text: string) => this.bridgeSend({ type: 'echo', text }),
      debug: () => this.toggleDebug(),
      chats: () => this.chats,
    };
  }

  private async readStorage<T>(key: string): Promise<T | undefined> {
    try {
      const cur = await chrome.storage?.local?.get?.(key);
      if (cur && Object.prototype.hasOwnProperty.call(cur, key)) return cur[key] as T;
    } catch { /* ignore */ }
    return undefined;
  }

  private async loadTheme(): Promise<void> {
    const t = await this.readStorage<string>('anya-theme');
    if (t === 'light' || t === 'dark') this.theme = t;
    this.setAttribute('theme', this.theme);
  }

  private async loadInputHistory(): Promise<void> {
    const h = await this.readStorage<string[]>('anya-input-history');
    if (Array.isArray(h)) this.inputHistory = h.slice(-100); // cap at 100 entries
  }

  private persistInputHistory(): void {
    try { chrome.storage?.local?.set?.({ 'anya-input-history': this.inputHistory.slice(-100) }); } catch { /* ignore */ }
  }

  // ─── Voice I/O ────────────────────────────────────────────────────

  private async loadSpeechSettings(): Promise<void> {
    const s = await this.readStorage<SpeechSettings>('anya-voice-settings');
    if (s) this.speechSettings = { ...DEFAULT_SPEECH_SETTINGS, ...s };
    this.speechOutput.rate = this.speechSettings.rate;
    this.speechOutput.pitch = this.speechSettings.pitch;
    if (this.speechSettings.voiceId) this.speechOutput.setVoice(this.speechSettings.voiceId);
    this.setupSpeechHandlers();
  }

  private persistSpeechSettings(): void {
    try { chrome.storage?.local?.set?.({ 'anya-voice-settings': this.speechSettings }); } catch { /* ignore */ }
  }

  /** Text committed so far (before current interim). Used to show streaming voice in input. */
  private _speechCommitted = '';
  private _micPermissionPromise: Promise<boolean> | null = null;

  private setupSpeechHandlers(): void {
    this.speechInput.onResult = (text, isFinal) => {
      // Ignore any trailing transcript that lands after we've stopped (e.g. the
      // final result fired by recognition.stop() when the user hits Send) so it
      // can't refill a just-cleared composer.
      if (!this.isListening) return;
      const ta = this.textarea;
      if (!ta) return;
      if (isFinal) {
        // Commit final text
        const prefix = this._speechCommitted && !this._speechCommitted.endsWith(' ') ? ' ' : '';
        this._speechCommitted += prefix + text;
        ta.value = this._speechCommitted;
        this.syncDraft(ta.value);
        if (this.speechSettings.autoSubmit) {
          this.speechInput.stop();
          this.send();
        }
      } else {
        // Stream interim text into the input box
        const prefix = this._speechCommitted && !this._speechCommitted.endsWith(' ') ? ' ' : '';
        ta.value = this._speechCommitted + prefix + text;
        this.syncDraft(ta.value);
      }
    };
    this.speechInput.onError = (error) => {
      this.recordDebug({ kind: 'log', level: 'warn', summary: `voice error: ${error}` });
      // Fatal errors stop recognition for good (the engine won't auto-restart),
      // so reflect "stopped" immediately. Recoverable errors (no-speech) DO
      // auto-restart in continuous mode, so we must not flip isListening here —
      // otherwise the onResult guard would start dropping live transcripts.
      const fatal =
        error === 'not-allowed' ||
        error === 'service-not-allowed' ||
        error === 'audio-capture' ||
        error === 'network';
      if (fatal) {
        this.isListening = false;
        if (error === 'not-allowed' || error === 'service-not-allowed') {
          this.showSpeechNotice(`Mic blocked (${error}). Allow mic for this extension, then retry.`);
        } else {
          this.showSpeechNotice(`Voice error: ${error}`);
        }
        return;
      }
      // Only surface "no speech" in single-shot (autoSubmit) mode; in continuous
      // dictation a pause legitimately fires no-speech and we keep listening.
      if (error === 'no-speech' && this.speechSettings.autoSubmit) {
        this.showSpeechNotice('No speech detected.');
      }
    };
    this.speechInput.onEnd = () => {
      this.isListening = false;
    };
  }

  /** Show a transient voice status/error notice above the composer. */
  private showSpeechNotice(msg: string): void {
    this.speechNotice = msg;
    if (this.speechNoticeTimer) clearTimeout(this.speechNoticeTimer);
    this.speechNoticeTimer = setTimeout(() => { this.speechNotice = ''; }, 5000);
  }

  /**
   * Ensure the extension origin has microphone access before starting
   * recognition. The side panel can't surface the browser's permission prompt,
   * so when access isn't already granted we open a small helper window (a real
   * top-level page) that can. Returns true once the origin is allowed to record.
   */
  private ensureMicPermission(): Promise<boolean> {
    // Single-flight: rapid mic clicks must not open multiple helper windows or
    // attach multiple runtime listeners. Re-use the in-flight request instead.
    if (this._micPermissionPromise) return this._micPermissionPromise;
    const p = this.requestMicPermission().finally(() => {
      if (this._micPermissionPromise === p) this._micPermissionPromise = null;
    });
    this._micPermissionPromise = p;
    return p;
  }

  private async requestMicPermission(): Promise<boolean> {
    // 1. Fast path: already granted for this origin.
    try {
      const st = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (st.state === 'granted') return true;
      if (st.state === 'denied') {
        this.showSpeechNotice('Mic blocked in browser settings. Allow it for this extension, then retry.');
        return false;
      }
    } catch {
      /* permissions.query may not support 'microphone' here — fall through */
    }
    // 2. Try prompting in-panel (works in some Chromium builds); harmless if not.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      /* panel can't prompt — open the helper window below */
    }
    // 3. Open the helper window that CAN show the prompt.
    return this.openMicPermissionHelper();
  }

  /**
   * Open the mic-permission helper window and resolve when access is granted.
   *
   * The helper only signals *success*; failure is inferred from the window
   * closing or the safety timeout. That lets the user retry inside the same
   * window (deny → allow) without the side panel having already given up.
   */
  private openMicPermissionHelper(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let helperWindowId: number | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(onMessage);
        chrome.windows.onRemoved.removeListener(onRemoved);
        if (timer !== undefined) clearTimeout(timer);
      };
      const finish = (granted: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        // Close a still-open helper window when we give up (timeout/failure).
        if (!granted && helperWindowId !== undefined) {
          try { chrome.windows.remove(helperWindowId); } catch { /* already gone */ }
        }
        resolve(granted);
      };
      const onMessage = (msg: { type?: string; granted?: boolean }) => {
        if (msg?.type !== 'anya-mic-permission') return;
        if (msg.granted) finish(true);
      };
      const onRemoved = (winId: number) => {
        if (winId === helperWindowId) finish(false);
      };

      chrome.runtime.onMessage.addListener(onMessage);
      chrome.windows.onRemoved.addListener(onRemoved);

      try {
        chrome.windows.create(
          {
            url: chrome.runtime.getURL('mic-permission.html'),
            type: 'popup',
            width: 460,
            height: 480,
          },
          (win) => {
            // Async failure surfaces here via lastError, not a thrown error.
            if (chrome.runtime.lastError || !win) {
              this.recordDebug({
                kind: 'log',
                level: 'warn',
                summary: `mic helper open failed: ${chrome.runtime.lastError?.message ?? 'no window'}`,
              });
              finish(false);
              return;
            }
            helperWindowId = win.id ?? undefined;
          },
        );
      } catch (err) {
        this.recordDebug({ kind: 'log', level: 'warn', summary: `mic helper open failed: ${err}` });
        finish(false);
        return;
      }

      // Safety timeout so the mic button never hangs if the window is left open.
      timer = setTimeout(() => finish(false), 90000);
    });
  }

  private async toggleSpeechInput(): Promise<void> {
    if (this.isListening) {
      this.speechInput.stop();
      this.isListening = false;
      return;
    }
    const granted = await this.ensureMicPermission();
    if (!granted) {
      if (!this.speechNotice) {
        this.showSpeechNotice('Microphone access is needed for voice input.');
      }
      return;
    }
    this._speechCommitted = this.textarea?.value ?? '';
    this.speechInput.continuous = !this.speechSettings.autoSubmit;
    try {
      await this.speechInput.start();
    } catch (err) {
      this.recordDebug({ kind: 'log', level: 'warn', summary: `Voice start failed: ${err}` });
    }
    this.isListening = this.speechInput.listening;
  }

  private speakMessage(text: string): void {
    if (this.isSpeaking) {
      this.speechOutput.stop();
      this.isSpeaking = false;
      this._speechBuffer = '';
      this._speechStreamingFor = null;
      return;
    }
    this.speechOutput.onEnd = () => { this.isSpeaking = false; };
    this.speechOutput.onError = () => { this.isSpeaking = false; };
    this.isSpeaking = true;
    this.speechOutput.speak(text);
  }

  /** Feed a delta chunk into streaming TTS. Speaks at sentence boundaries. */
  private feedStreamingSpeech(chatId: string, chunk: string): void {
    if (!this.speechSettings.outputEnabled || !this.speechSettings.autoSpeak) return;
    if (!this.speechSettings.streamSpeak) return; // Will speak at end of turn instead
    if (chatId !== this.currentChatId) return;

    // Start streaming for this chat
    if (this._speechStreamingFor !== chatId) {
      this._speechStreamingFor = chatId;
      this._speechBuffer = '';
      this.isSpeaking = true;
      this.speechOutput.onEnd = () => {
        // Only mark not-speaking if buffer is empty, stream is done, and synth queue is drained
        if (!this._speechBuffer && !this.streamingIds.has(chatId) && !this.speechOutput.speaking) {
          this.isSpeaking = false;
          this._speechStreamingFor = null;
        }
      };
      this.speechOutput.onError = () => { this.isSpeaking = false; };
    }

    this._speechBuffer += chunk;

    // Speak complete sentences (split on sentence-ending punctuation or newlines)
    const sentenceEnd = /[.!?]\s|\n/;
    let match: RegExpExecArray | null;
    while ((match = sentenceEnd.exec(this._speechBuffer)) !== null) {
      const sentence = this._speechBuffer.slice(0, match.index + match[0].length).trim();
      this._speechBuffer = this._speechBuffer.slice(match.index + match[0].length);
      if (sentence) {
        this.speechOutput.speak(sentence);
      }
    }
  }

  /** Flush any remaining speech buffer or speak full message (called when stream ends). */
  private flushStreamingSpeech(chatId: string): void {
    if (this._speechStreamingFor === chatId) {
      // Was streaming — just flush the remaining buffer
      const remaining = this._speechBuffer.trim();
      if (remaining) {
        this.speechOutput.speak(remaining);
      }
      this._speechBuffer = '';
      this._speechStreamingFor = null;
    } else if (!this.speechSettings.streamSpeak) {
      // End-of-turn mode — speak the full message now
      const sid = this.streamingIds.get(chatId);
      const chat = this.chats.find((c) => c.id === chatId);
      const msg = chat?.messages.find((m) => m.id === sid);
      if (msg?.role === 'assistant' && msg.text) {
        this.speakMessage(msg.text);
      }
    }
  }

  private updateSpeechSetting<K extends keyof SpeechSettings>(key: K, value: SpeechSettings[K]): void {
    this.speechSettings = { ...this.speechSettings, [key]: value };
    if (key === 'rate') this.speechOutput.rate = value as number;
    if (key === 'pitch') this.speechOutput.pitch = value as number;
    if (key === 'voiceId') this.speechOutput.setVoice(value as string);
    this.persistSpeechSettings();
  }

  /** Adjust TTS speed by delta, clamp to [0.25, 4], persist. Applied from next utterance. */
  private adjustTtsSpeed(delta: number): void {
    const next = Math.min(4, Math.max(0.25, Math.round((this.speechSettings.rate + delta) * 100) / 100));
    this.updateSpeechSetting('rate', next);
  }

  private toggleTheme(): void {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    this.setAttribute('theme', this.theme);
    try { chrome.storage?.local?.set?.({ 'anya-theme': this.theme }); } catch { /* ignore */ }
  }

  /** Close dropdown menus when clicking outside them. */
  private onRootClick = (e: Event): void => {
    const path = e.composedPath();
    if (this.headerMenuOpen && !path.some((n) => (n as HTMLElement).classList?.contains('header-more-wrap'))) {
      this.headerMenuOpen = false;
    }
    if (this.sendMenuOpen && !path.some((n) => (n as HTMLElement).classList?.contains('send-split'))) {
      this.sendMenuOpen = false;
    }
    if (this.attachMenuOpen && !path.some((n) => (n as HTMLElement).classList?.contains('attach-btn') || (n as HTMLElement).classList?.contains('attach-menu'))) {
      this.attachMenuOpen = false;
    }
    if (this.toolsPanelOpen && !path.some((n) => (n as HTMLElement).classList?.contains('tools-panel') || (n as HTMLElement).classList?.contains('composer-pill-btn'))) {
      this.toolsPanelOpen = false;
    }
    if (this.modelMenuOpen && !path.some((n) => (n as HTMLElement).classList?.contains('model-menu') || (n as HTMLElement).classList?.contains('model-pill-btn'))) {
      this.modelMenuOpen = false;
    }
    if (this.workspaceMenuOpen && !path.some((n) => (n as HTMLElement).classList?.contains('workspace-menu') || (n as HTMLElement).classList?.contains('workspace-pill-btn'))) {
      this.workspaceMenuOpen = false;
    }
  };

  // ----- debug mode ------------------------------------------------------
  private async loadDebug(): Promise<void> {
    const v = await this.readStorage<unknown>('anya-debug');
    if (v === true) this.debugOpen = true;
  }

  private toggleDebug(): void {
    this.debugOpen = !this.debugOpen;
    try { chrome.storage?.local?.set?.({ 'anya-debug': this.debugOpen }); } catch { /* ignore */ }
  }

  // ----- tool settings ---------------------------------------------------
  private async loadDisabledTools(): Promise<void> {
    const arr = await this.readStorage<string[]>('anya-disabled-tools');
    if (Array.isArray(arr)) this.disabledTools = new Set(arr.filter((s) => typeof s === 'string'));
  }

  private async loadAutoApprove(): Promise<void> {
    const v = await this.readStorage<boolean>('anya-auto-approve');
    if (typeof v === 'boolean') this.autoApprove = v;
  }

  private persistAutoApprove(): void {
    try { chrome.storage?.local?.set?.({ 'anya-auto-approve': this.autoApprove }); } catch { /* ignore */ }
    this.bridgeSend({ type: 'set-auto-approve', autoApprove: this.autoApprove });
  }

  private persistDisabledTools(): void {
    const arr = [...this.disabledTools];
    try { chrome.storage?.local?.set?.({ 'anya-disabled-tools': arr }); } catch { /* ignore */ }
    // Notify the bridge so future sessions exclude these tools.
    this.bridgeSend({ type: 'tool-config', disabledTools: arr });
  }

  private toggleTool(name: string): void {
    const next = new Set(this.disabledTools);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.disabledTools = next;
    this.persistDisabledTools();
  }

  private toggleToolGroup(groupId: string, enable: boolean): void {
    const group = TOOL_GROUPS.find((g) => g.id === groupId);
    if (!group) return;
    const next = new Set(this.disabledTools);
    for (const t of group.tools) {
      if (enable) next.delete(t.name);
      else next.add(t.name);
    }
    this.disabledTools = next;
    this.persistDisabledTools();
  }

  private toggleToolGroupCollapse(groupId: string): void {
    const next = new Set(this.toolGroupCollapsed);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    this.toolGroupCollapsed = next;
  }

  private toggleToolsPanel(): void {
    this.toolsPanelOpen = !this.toolsPanelOpen;
  }

  private openRemoteDebugSettings(): void {
    const ua = navigator.userAgent;
    const brave = (navigator as unknown as { brave?: { isBrave?: () => unknown } }).brave;
    let scheme = 'chrome';
    if (brave && typeof brave.isBrave === 'function') scheme = 'brave';
    else if (/Edg\//.test(ua)) scheme = 'edge';
    else if (/Vivaldi\//.test(ua)) scheme = 'vivaldi';
    else if (/OPR\//.test(ua)) scheme = 'opera';
    const url = `${scheme}://inspect/#remote-debugging`;
    chrome.tabs.create({ url, active: true }).catch((e) => {
      console.warn('[Anya] open remote-debug settings failed:', e);
    });
  }

  private runUpdateFlow(): void {
    const chatId = this.startNewChat();
    this.renameChat(chatId, 'Check for Updates');

    const text = [
      'Run a customer-safe update for this local Anya installation using the documented scripts.',
      '',
      'Steps:',
      '1) In repo root, run git pull --ff-only (if this is a git checkout).',
      '2) Run the platform setup script from repo root:',
      '   - Windows: pwsh ./setup.ps1 -Quiet',
      '   - macOS/Linux: ./setup.sh --quiet',
      '3) Verify extension and bridge builds completed and native host registration succeeded.',
      '',
      'Then give me a short status summary and tell me to reload the browser extension.',
    ].join('\n');

    this.appendMessage(chatId, {
      id: `u${Date.now()}`,
      role: 'user',
      text,
      ts: Date.now(),
    });
    this.scrollToBottom(true);
    void this.dispatchPrompt(chatId, text, 'immediate', []);
    this.pushSystem(
      chatId,
      'After update completes, reload the extension card in your browser extensions page to apply changes.',
      'normal',
    );
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
    this.renderRoot.removeEventListener('click', this.onRootClick);
    chrome.runtime.onMessage.removeListener(this.onPageBridgeMessage);
    chrome.runtime.onMessage.removeListener(this.onSpeechTranscript);
    if (this.fieldBlurTimer) { clearTimeout(this.fieldBlurTimer); this.fieldBlurTimer = null; }
    for (const timer of this.deltaFlushTimerByChat.values()) clearTimeout(timer);
    this.deltaFlushTimerByChat.clear();
    this.pendingDeltaByChat.clear();
    // Flush any debounced persist before tearing down so the latest state
    // survives reload, then clear the timer.
    if (this.persistTimer != null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      try {
        chrome.storage?.local?.set?.({
          'anya-chats': this.chats.map((c) => ({
            ...c,
            messages: c.messages.map((m) => ({ ...m, pending: false })),
          })),
          'anya-current-chat': this.currentChatId,
        });
      } catch { /* ignore */ }
    }
  }

  // ----- chat store ------------------------------------------------------
  private async loadChats(): Promise<void> {
    try {
      const arr = await this.readStorage<any>('anya-chats');
      const cur = await this.readStorage<string>('anya-current-chat');
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
          ...(typeof c.cwd === 'string' && c.cwd ? { cwd: c.cwd } : {}),
        }));
        this.currentChatId = typeof cur === 'string' && this.chats.some((c) => c.id === cur)
          ? cur : this.chats[0].id;
        this.followTranscript = true;
      } else {
        this.startNewChat();
      }
      // After render, scroll to the bottom so the user sees the latest messages.
      await this.updateComplete;
      this.scrollToBottom(true);
    } catch (err) {
      console.warn('[Anya] loadChats failed', err);
      this.startNewChat();
    }
  }

  private persistChats(): void {
    if (this.persistTimer != null) clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      try {
        chrome.storage?.local?.set?.({
          'anya-chats': this.chats.map((c) => ({
            ...c,
            // Strip pending flag so reloads don't show stuck spinners
            messages: c.messages.map((m) => ({ ...m, pending: false })),
          })),
          'anya-current-chat': this.currentChatId,
        });
      } catch { /* storage may be unavailable */ }
    }, 250);
  }

  /** Open sidebar content in a popup window (75% screen) or close if already in popup. */
  private toggleExpand = (): void => {
    if (this.isPopupMode) {
      // Close this popup window — user will go back to the side panel
      window.close();
    } else {
      // Open in a popup window at 75% screen width
      const w = Math.round(screen.availWidth * 0.75);
      const h = screen.availHeight;
      const left = screen.availWidth - w;
      chrome.windows.create({
        url: chrome.runtime.getURL('sidebar.html?popup=1'),
        type: 'popup',
        width: w,
        height: h,
        left,
        top: 0,
      });
    }
  };

  private startNewChat = (): string => {
    const id = `c${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const chat: Chat = {
      id,
      title: 'New Chat',
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
    this.followTranscript = true;
    this.hasNewBelow = false;
    this.persistChats();
    this.scrollToBottom(true);
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
    // Don't drain the queue here — the SDK's session.idle (→ done →
    // finishStream) will fire after the abort completes and drain it.
    // Draining here would race with that done event.
  };

  // ----- message-level actions (copy / delete / regenerate) -------------
  private copyMessage = (m: ChatMessage): void => {
    navigator.clipboard?.writeText(m.text).catch(() => { /* ignore */ });
    this.msgMenuId = null;
  };

  private copyAssistantTurnFromIndex = (idx: number): void => {
    if (idx < 0 || idx >= this.messages.length) return;
    if (this.messages[idx]?.role !== 'assistant') return;

    let start = idx;
    while (start > 0 && this.messages[start - 1].role === 'assistant') start--;

    const parts: string[] = [];
    for (let i = start; i <= idx; i++) {
      const t = this.messages[i].text?.trim();
      if (t) parts.push(t);
    }

    const text = parts.join('\n\n');
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => { /* ignore */ });
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
    if (c.title && c.title !== 'New Chat') return;
    const title = userText.replace(/\s+/g, ' ').trim().slice(0, 60) || 'untitled';
    this.mutateChat(chatId, (c) => ({ ...c, title }));
  }

  // ----- quick prompts ---------------------------------------------------
  private async loadQuickPrompts(): Promise<void> {
    try {
      const arr = await this.readStorage<any>('anya-quick-prompts');
      if (Array.isArray(arr) && arr.length > 0) {
        this.quickPrompts = arr.map((p: any) => ({
          id: String(p.id),
          label: String(p.label),
          hint: typeof p.hint === 'string' ? p.hint : undefined,
          body: String(p.body),
        }));
      }
    } catch { /* ignore */ }
  }

  private insertQuickPrompt = (qp: QuickPrompt): void => {
    const ta = this.textarea ?? (this.renderRoot.querySelector('#prompt-input') as HTMLTextAreaElement | null);
    if (!ta) return;
    ta.value = qp.body;
    this.syncDraft(ta.value);
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
        // Send any persisted disabled-tools list so the bridge filters tools for new sessions.
        if (this.disabledTools.size > 0) {
          this.bridgeSend({ type: 'tool-config', disabledTools: [...this.disabledTools] });
        }
        // Request available models from the SDK.
        this.bridgeSend({ type: 'list-models' });
        break;
      case 'models': {
        const models = Array.isArray(data.models) ? data.models : [];
        this.availableModels = models.map((m: any) => ({
          id: String(m.id ?? ''),
          name: String(m.name ?? m.id ?? ''),
          contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : undefined,
          billingMultiplier: typeof m.billingMultiplier === 'number' ? m.billingMultiplier : undefined,
        }));
        // Keep selectedModel empty = "Auto" (SDK picks the best model).
        break;
      }
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
        console.debug('[Anya] pong');
        break;
      case 'echo-reply':
        console.debug('[Anya] echo:', String(data.text ?? ''));
        break;
      case 'delta':
        if (chatId && !this.cancelledChats.has(chatId)) this.appendDelta(chatId, String(data.text ?? ''));
        break;
      case 'turn-start':
        if (chatId && !this.cancelledChats.has(chatId)) this.ensureThinkingBubble(chatId);
        break;
      case 'intent':
        if (chatId && !this.cancelledChats.has(chatId)) this.setIntent(chatId, String(data.text ?? ''));
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
          console.warn('[Anya] malformed tool-request:', data);
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
      case 'tool-partial-result': {
        if (!chatId) break;
        const tcid = String(data.toolCallId ?? '');
        const c = this.chats.find((x) => x.id === chatId);
        const existing = c?.toolCalls[tcid];
        if (!existing) break;
        const chunk = typeof data.partialOutput === 'string' ? data.partialOutput : '';
        if (!chunk) break;
        const next = (existing.partialOutput ?? '') + chunk;
        // Cap to avoid unbounded growth on chatty tools; tool-complete carries the canonical result.
        const capped = next.length > 16000 ? next.slice(next.length - 16000) : next;
        this.mutateChat(chatId, (c) => ({
          ...c,
          toolCalls: { ...c.toolCalls, [tcid]: { ...existing, partialOutput: capped } },
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
        break;
      }
      case 'chat-deleted':
        // Bridge confirmed deletion; no action needed (UI already updated).
        break;
      case 'folder-pick-result':
        if (f.ok && typeof f.path === 'string' && f.path) {
          this.handleFolderPickResult(f.path);
        }
        break;
      case 'permission-request': {
        const req = f as unknown as { requestId: string; chatId: string; toolName: string; kind: string; arguments?: unknown };
        this.pendingApprovals.set(req.requestId, {
          chatId: req.chatId,
          toolName: req.toolName,
          kind: req.kind,
          args: req.arguments,
        });
        this.requestUpdate();
        break;
      }
      default:
        console.debug('[Anya] unknown frame:', f);
    }
  }

  // ----- tool execution (bridge → extension RPC) ------------------------
  private async handleToolRequest(
    id: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    console.debug('[Anya] tool-request', tool, args);
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
      console.debug('[Anya] tool failed', tool, msg);
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
          catch (e) { console.warn('[Anya] focus window failed:', e); }
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
          catch (e) { console.warn('[Anya] focus window failed:', e); }
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
      case 'manage_bookmarks':
        // Legacy alias — falls through to find_bookmarks or edit_bookmarks.
        return await this.execManageBookmarks(args);
      case 'find_bookmarks': {
        // Read-only bookmark operations: list, tree, search.
        const op = String(args.op ?? 'search');
        if (!['list', 'tree', 'search'].includes(op)) throw new Error(`find_bookmarks: invalid op "${op}". Valid: list, tree, search.`);
        return await this.execManageBookmarks({ ...args, op });
      }
      case 'edit_bookmarks': {
        // Write bookmark operations: create, update, move, remove, open.
        const op = String(args.op ?? '');
        if (!['create', 'update', 'move', 'remove', 'open'].includes(op)) throw new Error(`edit_bookmarks: invalid op "${op}". Valid: create, update, move, remove, open.`);
        return await this.execManageBookmarks({ ...args, op });
      }
      case 'browse_history': {
        const query = String(args.query ?? '');
        const maxResults = Math.min(Number(args.maxResults || 100), 500);
        const searchOpts: { text: string; maxResults?: number; startTime?: number; endTime?: number } = { text: query, maxResults };
        if (typeof args.startTime === 'string' && args.startTime) {
          const t = Date.parse(args.startTime as string);
          if (!isNaN(t)) searchOpts.startTime = t;
        }
        if (typeof args.endTime === 'string' && args.endTime) {
          const t = Date.parse(args.endTime as string);
          if (!isNaN(t)) searchOpts.endTime = t;
        }
        // Fallback: if no startTime given, default to last 7 days
        if (searchOpts.startTime === undefined) {
          searchOpts.startTime = Date.now() - 7 * 86_400_000;
        }
        const results = await chrome.history.search(searchOpts);
        return results.map((r) => ({
          url: r.url,
          title: r.title,
          lastVisit: r.lastVisitTime ? new Date(r.lastVisitTime).toISOString() : null,
          visitCount: r.visitCount ?? 0,
        }));
      }
      case 'browse_downloads': {
        const query = String(args.query ?? '');
        const stateRaw = String(args.state ?? '');
        const state = ['in_progress', 'complete', 'interrupted'].includes(stateRaw)
          ? stateRaw as 'in_progress' | 'complete' | 'interrupted'
          : undefined;
        const maxResults = Math.min(Math.max(Number(args.maxResults || 50), 1), 200);
        const searchOpts: chrome.downloads.DownloadQuery = {
          query: query ? [query] : undefined,
          state,
          limit: maxResults,
          orderBy: ['-startTime'],
        };
        if (typeof args.startTime === 'string' && args.startTime) {
          const t = Date.parse(args.startTime);
          if (!isNaN(t)) searchOpts.startedAfter = new Date(t).toISOString();
        }
        if (typeof args.endTime === 'string' && args.endTime) {
          const t = Date.parse(args.endTime);
          if (!isNaN(t)) searchOpts.startedBefore = new Date(t).toISOString();
        }

        const items = await chrome.downloads.search(searchOpts);
        return items.map((d) => ({
          id: d.id,
          fileName: d.filename,
          fileSize: d.fileSize,
          url: d.url,
          finalUrl: d.finalUrl,
          state: d.state,
          danger: d.danger,
          exists: d.exists,
          mime: d.mime,
          startTime: d.startTime ?? null,
          endTime: d.endTime ?? null,
          byExtensionName: d.byExtensionName,
          byExtensionId: d.byExtensionId,
        }));
      }
      case 'search_chats': {
        const op = String(args.op ?? 'list');
        const query = String(args.query ?? '').toLowerCase();
        const chatId = String(args.chatId ?? '');
        const limit = Math.min(Math.max(Number(args.limit || 20), 1), 100);

        if (op === 'read') {
          if (!chatId) throw new Error('search_chats: chatId required for "read" op');
          const chat = this.chats.find((c) => c.id === chatId);
          if (!chat) throw new Error(`search_chats: chat "${chatId}" not found`);
          return {
            id: chat.id,
            title: chat.title,
            createdAt: new Date(chat.createdAt).toISOString(),
            updatedAt: new Date(chat.updatedAt).toISOString(),
            pinned: chat.pinned ?? false,
            tags: chat.tags ?? [],
            cwd: chat.cwd ?? null,
            messages: chat.messages.map((m) => ({
              role: m.role,
              text: m.text.slice(0, 2000),
              ts: new Date(m.ts).toISOString(),
              kind: m.kind ?? 'normal',
            })),
          };
        }

        let results = this.chats;
        if (op === 'search' && query) {
          results = results.filter((c) =>
            c.title.toLowerCase().includes(query) ||
            c.messages.some((m) => m.text.toLowerCase().includes(query)),
          );
        }

        return results
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, limit)
          .map((c) => ({
            id: c.id,
            title: c.title,
            messageCount: c.messages.length,
            createdAt: new Date(c.createdAt).toISOString(),
            updatedAt: new Date(c.updatedAt).toISOString(),
            pinned: c.pinned ?? false,
            tags: c.tags ?? [],
            cwd: c.cwd ?? null,
            preview: c.messages.filter((m) => m.role === 'user').slice(0, 2).map((m) => m.text.slice(0, 100)),
          }));
      }
      case 'get_attached': {
        // Unified tool: fetch fresh content of an attached element or field.
        // Accepts ctxId (for elements) or fieldId (for fields) — one or the other.
        const tabId = Number(args.tabId || 0);
        const ctxId = args.ctxId ? String(args.ctxId) : '';
        const fieldId = args.fieldId ? String(args.fieldId) : '';
        if (!ctxId && !fieldId) throw new Error('get_attached: ctxId or fieldId required');
        const targetTab = tabId || (await this.getActiveTab()).id;
        if (!targetTab) throw new Error('get_attached: no target tab');

        if (ctxId) {
          const resp = await chrome.tabs.sendMessage(targetTab, { type: 'anya-read-context', ctxId });
          if (resp?.ok) return resp.content;
          // Fallback to cached content in chip.
          const chip = this.contextAttachments.find((a) => a.ref?.ctxId === ctxId);
          if (chip) return chip.content + (chip.fullLength && chip.fullLength > ATTACHMENT_VALUE_CAP ? '\n[from cache — element may have been removed from page]' : '');
          throw new Error(resp?.error || 'Element not found');
        } else {
          const resp = await chrome.tabs.sendMessage(targetTab, { type: 'anya-field-read', fieldId });
          if (resp?.ok) return resp.value;
          throw new Error(resp?.error || 'Field not found');
        }
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

  /**
   * Umbrella tool for chrome.bookmarks. One entry, many ops, mirrors the API.
   */
  private async execManageBookmarks(args: Record<string, unknown>): Promise<unknown> {
    const op = String(args.op ?? '');
    if (!op) throw new Error('manage_bookmarks: `op` is required');

    const flatten = (
      nodes: chrome.bookmarks.BookmarkTreeNode[],
      pathParts: string[] = [],
      out: Array<{
        id: string;
        parentId?: string;
        title: string;
        url?: string;
        folderPath: string;
        isFolder: boolean;
        index?: number;
      }> = [],
    ) => {
      for (const n of nodes) {
        const here = n.title ? [...pathParts, n.title] : pathParts;
        const isFolder = !n.url;
        out.push({
          id: n.id,
          parentId: n.parentId,
          title: n.title,
          url: n.url,
          folderPath: pathParts.join('/'),
          isFolder,
          index: n.index,
        });
        if (n.children) flatten(n.children, here, out);
      }
      return out;
    };

    switch (op) {
      case 'list': {
        const tree = await chrome.bookmarks.getTree();
        // Skip the synthetic root ("") so folderPath starts with "Favorites bar"/"Other favorites".
        let all = flatten(tree[0]?.children ?? []);
        const folder = typeof args.folder === 'string' ? args.folder.toLowerCase() : '';
        const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
        if (folder) all = all.filter((n) => n.folderPath.toLowerCase().startsWith(folder));
        if (query) {
          all = all.filter(
            (n) =>
              n.title.toLowerCase().includes(query) ||
              (n.url ?? '').toLowerCase().includes(query),
          );
        }
        const limit = typeof args.limit === 'number' ? args.limit : 500;
        return { count: all.length, items: all.slice(0, limit) };
      }

      case 'tree': {
        const nodeId = args.nodeId !== undefined ? String(args.nodeId) : undefined;
        const tree = nodeId
          ? await chrome.bookmarks.getSubTree(nodeId)
          : await chrome.bookmarks.getTree();
        return tree;
      }

      case 'search': {
        const query = String(args.query ?? '');
        if (!query) throw new Error('manage_bookmarks search: `query` is required');
        const results = await chrome.bookmarks.search(query);
        // Decorate with folderPath by walking parents (one cache pass).
        const all = flatten((await chrome.bookmarks.getTree())[0]?.children ?? []);
        const byId = new Map(all.map((n) => [n.id, n] as const));
        const limit = typeof args.limit === 'number' ? args.limit : 100;
        return results.slice(0, limit).map((r) => ({
          id: r.id,
          parentId: r.parentId,
          title: r.title,
          url: r.url,
          folderPath: byId.get(r.id)?.folderPath ?? '',
        }));
      }

      case 'open': {
        const id = String(args.id ?? '');
        if (!id) throw new Error('manage_bookmarks open: `id` is required');
        const [node] = await chrome.bookmarks.get(id);
        if (!node?.url) throw new Error(`bookmark ${id} has no URL (folder?)`);
        const background = args.background === true;
        const tab = await chrome.tabs.create({ url: node.url, active: !background });
        return { tabId: tab.id, url: node.url, title: node.title };
      }

      case 'create': {
        const title = String(args.title ?? '');
        if (!title) throw new Error('manage_bookmarks create: `title` is required');
        const created = await chrome.bookmarks.create({
          parentId: args.parentId !== undefined ? String(args.parentId) : undefined,
          title,
          url: typeof args.url === 'string' && args.url ? args.url : undefined,
        });
        return created;
      }

      case 'update': {
        const id = String(args.id ?? '');
        if (!id) throw new Error('manage_bookmarks update: `id` is required');
        const changes: chrome.bookmarks.BookmarkChangesArg = {};
        if (typeof args.title === 'string') changes.title = args.title;
        if (typeof args.url === 'string') changes.url = args.url;
        if (Object.keys(changes).length === 0) {
          throw new Error('manage_bookmarks update: nothing to change (provide title and/or url)');
        }
        return await chrome.bookmarks.update(id, changes);
      }

      case 'move': {
        // Bulk: accept `ids: string[]` or single `id: string`.
        const ids: string[] = Array.isArray(args.ids)
          ? (args.ids as unknown[]).map(String)
          : args.id !== undefined
            ? [String(args.id)]
            : [];
        if (ids.length === 0) throw new Error('manage_bookmarks move: `id` or `ids` required');
        const parentId = args.parentId !== undefined ? String(args.parentId) : undefined;
        if (!parentId) throw new Error('manage_bookmarks move: `parentId` is required');
        const startIndex = typeof args.index === 'number' ? args.index : undefined;
        const moved: chrome.bookmarks.BookmarkTreeNode[] = [];
        for (let i = 0; i < ids.length; i++) {
          const dest: chrome.bookmarks.BookmarkDestinationArg = { parentId };
          if (startIndex !== undefined) dest.index = startIndex + i;
          moved.push(await chrome.bookmarks.move(ids[i], dest));
        }
        return { moved: moved.length, items: moved };
      }

      case 'remove': {
        const ids: string[] = Array.isArray(args.ids)
          ? (args.ids as unknown[]).map(String)
          : args.id !== undefined
            ? [String(args.id)]
            : [];
        if (ids.length === 0) throw new Error('manage_bookmarks remove: `id` or `ids` required');
        const recursive = args.recursive === true;
        const removed: string[] = [];
        for (const id of ids) {
          if (recursive) await chrome.bookmarks.removeTree(id);
          else await chrome.bookmarks.remove(id);
          removed.push(id);
        }
        return { removed };
      }

      default:
        throw new Error(
          `manage_bookmarks: unknown op "${op}". ` +
            'Valid: list, tree, search, open, create, update, move, remove.',
        );
    }
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

    const current = this.chats
      .find((x) => x.id === chatId)
      ?.messages.find((m) => m.id === sid);

    // If we already streamed assistant text, start a fresh tool segment so the
    // transcript reads naturally: assistant text -> tools -> assistant text.
    if (current && current.text.trim().length > 0) {
      this.mutateChat(chatId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === sid ? { ...m, pending: false } : m)),
      }));
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

  private ensureThinkingBubble(chatId: string): void {
    const sid = this.streamingIds.get(chatId);
    if (sid) return;
    const id = `m${Date.now()}`;
    this.streamingIds.set(chatId, id);
    this.appendMessage(chatId, { id, role: 'assistant', text: '', pending: true, ts: Date.now() });
    if (chatId === this.currentChatId) this.scrollToBottom();
  }

  private setIntent(chatId: string, intent: string): void {
    const trimmed = intent.trim();
    if (!trimmed) return;
    this.ensureThinkingBubble(chatId);
    const sid = this.streamingIds.get(chatId);
    if (!sid) return;
    this.mutateChat(chatId, (c) => ({
      ...c,
      messages: c.messages.map((m) => m.id === sid ? { ...m, intent: trimmed } : m),
    }));
  }

  private flushDeltaBuffer(chatId: string): void {
    const timer = this.deltaFlushTimerByChat.get(chatId);
    if (typeof timer === 'number') {
      clearTimeout(timer);
      this.deltaFlushTimerByChat.delete(chatId);
    }
    const chunk = this.pendingDeltaByChat.get(chatId);
    if (!chunk) return;
    this.pendingDeltaByChat.delete(chatId);

    const sid = this.streamingIds.get(chatId);
    if (!sid) {
      const id = `m${Date.now()}`;
      this.streamingIds.set(chatId, id);
      this.appendMessage(chatId, { id, role: 'assistant', text: chunk, pending: true, ts: Date.now() });
    } else {
      const current = this.chats
        .find((x) => x.id === chatId)
        ?.messages.find((m) => m.id === sid);

      // If current segment is a tool block, start a fresh text segment so the
      // transcript alternates cleanly: tools -> assistant text.
      if (current && (current.toolCallIds?.length ?? 0) > 0 && !current.text) {
        this.mutateChat(chatId, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.id === sid ? { ...m, pending: false } : m)),
        }));
        const id = `m${Date.now()}`;
        this.streamingIds.set(chatId, id);
        this.appendMessage(chatId, { id, role: 'assistant', text: chunk, pending: true, ts: Date.now() });
        if (chatId === this.currentChatId) this.scrollToBottom();
        return;
      }

      this.mutateChat(chatId, (c) => ({
        ...c,
        messages: c.messages.map((m) => m.id === sid ? { ...m, text: m.text + chunk } : m),
      }));
    }
    if (chatId === this.currentChatId) this.scrollToBottom();
  }

  private scheduleDeltaFlush(chatId: string): void {
    if (this.deltaFlushTimerByChat.has(chatId)) return;
    const timer = window.setTimeout(() => this.flushDeltaBuffer(chatId), 33);
    this.deltaFlushTimerByChat.set(chatId, timer);
  }

  private appendDelta(chatId: string, chunk: string): void {
    if (!chunk) return;
    const prev = this.pendingDeltaByChat.get(chatId) ?? '';
    this.pendingDeltaByChat.set(chatId, prev + chunk);
    this.scheduleDeltaFlush(chatId);
    // Stream TTS as text arrives
    this.feedStreamingSpeech(chatId, chunk);
  }

  private finishStream(chatId: string): void {
    this.flushDeltaBuffer(chatId);
    const sid = this.streamingIds.get(chatId);
    if (sid) {
      this.mutateChat(chatId, (c) => ({
        ...c,
        messages: c.messages.map((m) => m.id === sid ? { ...m, pending: false } : m),
      }));
      // Auto-speak: flush any remaining buffered speech (streaming already spoke most of it)
      if (this.speechSettings.outputEnabled && this.speechSettings.autoSpeak && chatId === this.currentChatId) {
        this.flushStreamingSpeech(chatId);
      }
      // Forward final response to voice sidebar for TTS there too.
      if (this.isListening && chatId === this.currentChatId) {
        const chat = this.chats.find((c) => c.id === chatId);
        const lastMsg = chat?.messages.filter((m) => m.role === 'assistant').at(-1);
        if (lastMsg?.text) {
          chrome.runtime.sendMessage({ type: 'anya-voice-speak', text: lastMsg.text }).catch(() => {});
        }
      }
      this.streamingIds.delete(chatId);
    }
    // Close the send-options dropdown when streaming finishes.
    if (chatId === this.currentChatId) this.sendMenuOpen = false;
    // Drain client-side queue: if a queued prompt is waiting for this chat,
    // dispatch it now.  This fires even when cancelStream already cleared
    // the sid — the abort's session.idle → done triggers the drain.
    if (!this.streamingIds.has(chatId)) {
      const idx = this.pendingQueue.findIndex((p) => p.chatId === chatId);
      if (idx !== -1) {
        const [queued] = this.pendingQueue.splice(idx, 1);
        void this.dispatchPrompt(queued.chatId, queued.text, 'enqueue', queued.ctx);
      }
    }
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

  private isTranscriptNearBottom(threshold = 28): boolean {
    const el = this.transcript;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }

  private onTranscriptScroll = (): void => {
    const nearBottom = this.isTranscriptNearBottom();
    this.followTranscript = nearBottom;
    if (nearBottom) this.hasNewBelow = false;
  };

  private scrollToBottom(force = false): void {
    queueMicrotask(() => {
      if (!this.transcript) return;
      if (!force && !this.followTranscript) {
        this.hasNewBelow = true;
        return;
      }
      // Use instant scroll to avoid smooth-scroll delay on restore
      this.transcript.scrollTo({ top: this.transcript.scrollHeight, behavior: 'instant' });
      this.hasNewBelow = false;
    });
  }

  // ----- send ------------------------------------------------------------
  private send = (mode: 'enqueue' | 'immediate' = 'enqueue'): void => {
    const ta = this.textarea ?? (this.renderRoot.querySelector('#prompt-input') as HTMLTextAreaElement | null);
    if (!ta) return;
    const text = ta.value.trim();
    const hasContext = this.contextAttachments.length > 0;
    if (!text && !hasContext) return;

    // Sending ends the active dictation: stop the mic and drop any committed
    // voice buffer so a trailing transcript can't refill the cleared composer.
    if (this.isListening) {
      this.isListening = false;
      this._speechCommitted = '';
      try { this.speechInput.stop(); } catch { /* already stopped */ }
    }

    // Slash commands are intercepted before any bridge dispatch.
    if (text.startsWith('/')) {
      if (this.handleSlashCommand(text)) {
        ta.value = '';
        this.syncDraft('');
        return;
      }
    }

    // Ensure we have a current chat (could happen on cold start race).
    if (!this.currentChatId) this.startNewChat();
    const chatId = this.currentChatId;
    // Clear any leftover cancel marker so deltas for THIS new turn aren't
    // filtered out by a still-pending `done` from a previously cancelled turn.
    this.cancelledChats.delete(chatId);

    // Snapshot context attachments BEFORE clearing — they need to reach dispatchPrompt.
    const ctxSnapshot = [...this.contextAttachments];

    // Build context labels for chip rendering in the user bubble.
    // Images get a dataUrl for inline thumbnail preview.
    const contextLabels = ctxSnapshot.map((a) => ({
      icon: a.icon,
      label: a.label,
      ...(a.kind === 'image' && a.imageData ? { dataUrl: a.imageData.dataUrl } : {}),
    }));

    this.appendMessage(chatId, {
      id: `u${Date.now()}`,
      role: 'user',
      text,
      ts: Date.now(),
      contextLabels: contextLabels.length ? contextLabels : undefined,
    });
    if (text) this.autoTitleIfNeeded(chatId, text);

    // Record in input history (deduplicate consecutive duplicates).
    if (text && this.inputHistory[this.inputHistory.length - 1] !== text) {
      this.inputHistory.push(text);
      this.persistInputHistory();
    }
    this.historyIdx = -1;
    this.historyDraft = '';

    ta.value = '';
    this.syncDraft('');
    this.contextAttachments = [];
    this.attachMenuOpen = false;
    this.scrollToBottom(true);

    // If streaming and mode is enqueue, queue client-side and DON'T send
    // to the SDK yet.  The queued prompt is dispatched after the current
    // turn finishes (see finishStream → pendingQueue drain).
    if (mode === 'enqueue' && this.streamingIds.has(chatId)) {
      this.pendingQueue.push({ chatId, text, ctx: ctxSnapshot });
      return;
    }
    void this.dispatchPrompt(chatId, text, mode, ctxSnapshot);
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
          'Slash commands\n' +
          '\n' +
          'Chats\n' +
          '  /new                  start a new chat\n' +
          '  /rename [title]       rename current chat (no arg = inline edit)\n' +
          '  /delete               delete current chat\n' +
          '  /pin                  pin / unpin current chat\n' +
          '  /tag add|rm [name]    add or remove a tag\n' +
          '  /tag list             list tags on current chat\n' +
          '\n' +
          'Conversation\n' +
          '  /clear                clear messages in current chat\n' +
          '  /stop                 cancel the in-flight response\n' +
          '  /export               export current chat as markdown\n' +
          '  /search [query]       open search (optionally pre-filled)\n' +
          '  /open <folder>        open new chat rooted in a folder\n' +
          '\n' +
          '  /help                 this message\n' +
          '\n' +
          '@-mentions  (inlined into your prompt before sending)\n' +
          '  @tab                  markdown of the active tab\n' +
          '  @selection            text you have highlighted\n' +
          '  @url                  URL of the active tab\n' +
          '  @title                title of the active tab\n' +
          '  @clipboard            system clipboard text\n' +
          '  @tabs                 markdown table of every open tab\n' +
          '  @tab:<id|query>       one tab by id, or substring of title/url\n' +
          '\n' +
          'Other input\n' +
          '  Ctrl+V image          paste a screenshot as a vision attachment',
          'normal');
        return true;
      case 'pin':
        if (this.currentChatId) this.togglePin(this.currentChatId);
        return true;
      case 'stop':
        if (this.currentChatId) this.cancelStream(this.currentChatId);
        return true;
      case 'open': {
        if (!arg) {
          this.pushSystem(this.currentChatId, 'Usage: /open <folder-path>\n\nOpens a new chat rooted in the given folder so the SDK loads skills, prompts, and .copilot-instructions.md from that repo.', 'normal');
          return true;
        }
        const folderName = arg.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? arg;
        const id = this.startNewChat();
        this.chats = this.chats.map((c) => c.id === id ? { ...c, title: folderName, cwd: arg } : c);
        this.pushSystem(id, `Opened **${arg}**\nThe SDK will load context from this folder.`, 'normal');
        this.persistChats();
        return true;
      }
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

  // ----- page-bridge: context attachments + field tracking ----------------

  private onPageBridgeMessage = (
    msg: { type: string; field?: FocusedField; attachment?: ContextAttachment },
    sender: chrome.runtime.MessageSender,
  ): void => {
    // Silent field tracking — powers Insert/Append buttons on bubbles.
    if (msg.type === 'anya-field-focus' && msg.field && sender.tab?.id != null) {
      if (this.fieldBlurTimer) { clearTimeout(this.fieldBlurTimer); this.fieldBlurTimer = null; }
      this.focusedField = { ...msg.field, tabId: sender.tab.id };
    } else if (msg.type === 'anya-field-blur') {
      if (this.fieldBlurTimer) { clearTimeout(this.fieldBlurTimer); this.fieldBlurTimer = null; }
      this.fieldBlurTimer = setTimeout(() => { this.focusedField = null; }, 2000);
    }
    // Context attachment — "Add to Anya" right-click or Alt+A.
    if (msg.type === 'anya-attach' && msg.attachment) {
      const att = msg.attachment as unknown as Record<string, unknown>;
      // If page-bridge flagged this for sidebar resolution (whole-page fallback),
      // use the same path as @tab autocomplete for consistent content quality.
      if (att._resolveInSidebar) {
        void this.attach('tab');
        chrome.storage.session.remove('anya-pending-attach').catch(() => {});
        return;
      }
      const tabId = sender.tab?.id;
      const ref = msg.attachment.ref ? { ...msg.attachment.ref, tabId: msg.attachment.ref.tabId ?? tabId } : (tabId ? { tabId } : undefined);
      this.commitAttachment({ ...msg.attachment, ref });
      chrome.storage.session.remove('anya-pending-attach').catch(() => {});
    }
  };

  private removeAttachment(id: string): void {
    this.contextAttachments = this.contextAttachments.filter((a) => a.id !== id);
  }

  /** Handle voice transcripts coming from the voice sidebar. */
  private onSpeechTranscript = (msg: { type: string; text?: string }): void => {
    if (msg.type !== 'anya-voice-transcript' || !msg.text) return;
    const ta = this.textarea;
    if (ta) {
      const current = ta.value;
      const prefix = current && !current.endsWith(' ') ? ' ' : '';
      ta.value = current + prefix + msg.text;
      this.syncDraft(ta.value);
    }
    if (this.speechSettings.autoSubmit) {
      this.send();
    }
  };

  private clearAttachments(): void {
    this.contextAttachments = [];
  }

  /** Unified entry point for adding a context attachment chip.
   *  Generates a unique ID, pushes to the chip array, and injects
   *  the @-reference token at the cursor in the composer. */
  private commitAttachment(chip: Omit<ContextAttachment, 'id'> & { id?: string }): ContextAttachment {
    const att: ContextAttachment = {
      ...chip,
      id: chip.id ?? `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
    this.contextAttachments = [...this.contextAttachments, att];
    // Inject @-reference token at the cursor in the composer.
    const token = this.refLabel(att);
    this.updateComplete.then(() => {
      const ta = this.textarea;
      if (!ta) return;
      const pos = ta.selectionStart ?? ta.value.length;
      const before = pos > 0 && !/\s$/.test(ta.value.slice(0, pos)) ? ' ' : '';
      const insert = before + token + ' ';
      ta.value = ta.value.slice(0, pos) + insert + ta.value.slice(pos);
      const newPos = pos + insert.length;
      ta.selectionStart = ta.selectionEnd = newPos;
      this.syncDraft(ta.value);
      ta.focus();
    });
    return att;
  }

  /** Generate a short reference token for an attachment that gets injected
   *  into the composer so the user and LLM can reference it inline. */
  private refLabel(att: ContextAttachment): string {
    const safe = (s: string) => s.replace(/[\s:,;!?'"()\[\]{}]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    switch (att.kind) {
      case 'tab':       return '@tab';
      case 'selection': return '@selection';
      case 'clipboard': return '@clipboard';
      case 'tabs':      return '@tabs';
      case 'url':       return '@url';
      case 'title':     return '@title';
      case 'element':   return `@element:${safe(att.label.split('·')[0].trim())}`;
      case 'field':     return `@field:${safe(att.label.split('·')[0].trim())}`;
      case 'link':      return `@link:${safe(att.label)}`;
      case 'image':     return `@image:${safe(att.imageData?.name || 'image')}`;
      case 'folder':    return `@folder:${safe(att.label)}`;
      case 'bookmark':  return `@bookmark:${safe(att.label)}`;
      case 'history':   return `@history:${safe(att.label)}`;
    }
  }

  /** Load any context attachments buffered in session storage before the
   *  sidebar was open. Clears them after loading. */
  private async loadPendingAttachments(): Promise<void> {
    try {
      const result = await chrome.storage.session.get('anya-pending-attach');
      const pending = result?.['anya-pending-attach'];
      if (Array.isArray(pending) && pending.length > 0) {
        await chrome.storage.session.remove('anya-pending-attach');
        for (const att of pending) {
          if (att && typeof att === 'object' && att.kind) {
            if (att._resolveInSidebar) {
              void this.attach(String(att.kind));
            } else {
              this.commitAttachment(att);
            }
          }
        }
      }
    } catch { /* session storage may not be available */ }
  }

  /**
   * Fill the focused field on the page with the given text.
   */
  private async fillField(text: string, mode: 'replace' | 'append' = 'replace'): Promise<void> {
    const f = this.focusedField;
    if (!f) return;
    try {
      await chrome.tabs.sendMessage(f.tabId, {
        type: 'anya-field-fill',
        fieldId: f.fieldId,
        text,
        mode,
      });
      this.pushSystem(
        this.currentChatId,
        `Inserted into field${f.label ? ` "${f.label}"` : ''} on ${new URL(f.pageUrl).hostname}.`,
        'normal',
      );
    } catch (err) {
      this.pushSystem(
        this.currentChatId,
        `Could not fill field: ${err}. The page may have navigated or the field may no longer exist.`,
        'error',
      );
    }
  }

  private async dispatchPrompt(
    chatId: string,
    text: string,
    mode: 'enqueue' | 'immediate' = 'enqueue',
    contextChips: ContextAttachment[] = [],
  ): Promise<void> {
    let prompt = text;
    try {
      // @ tokens in the text are references to attachments — they stay as-is.
      // The real content is in contextChips, injected below.
      const tab = await this.getActiveTab().catch(() => null);
      if (tab) {
        const url = tab.url ?? '(unknown url)';
        const title = (tab.title ?? '').replace(/\s+/g, ' ').trim() || '(untitled)';
        prompt = `[Active tab: ${url} — ${title}]\n\n${prompt}`;
      }
      // Inject context attachments passed from send().
      if (contextChips.length > 0) {
        const ctxBlocks = contextChips.map((a, idx) => {
          const token = this.refLabel(a);
          const lines: string[] = [];
          lines.push(`[${idx + 1}] ${a.icon} ${a.label} — ref: ${token}` + (a.fullLength ? ` (${a.fullLength.toLocaleString()} chars)` : ''));

          // Field attachments get special instructions.
          if (a.kind === 'field') {
            lines.push(a.content);
            if (a.ref?.fieldId) lines.push(`→ Fresh value: call get_attached({ tabId: ${a.ref.tabId ?? 'active'}, fieldId: "${a.ref.fieldId}" })`);
            lines.push('Respond with ONLY the text to insert — no markdown, no explanation, no quotes.');
            return lines.join('\n');
          }

          // By-value: content fits within cap → inline fully.
          if (!a.fullLength || a.fullLength <= ATTACHMENT_VALUE_CAP) {
            lines.push(a.content);
          } else {
            // Truncated — inline what we have + tell model how to fetch full.
            lines.push(a.content);
            lines.push(`[truncated at ${ATTACHMENT_VALUE_CAP.toLocaleString()} of ${a.fullLength.toLocaleString()} chars]`);
          }

          // By-reference fetch instructions.
          if (a.ref?.ctxId) {
            lines.push(`→ Fresh/full content: call get_attached({ tabId: ${a.ref.tabId ?? 'active'}, ctxId: "${a.ref.ctxId}" })`);
          } else if (a.kind === 'tab') {
            lines.push(`→ Fresh/full content: call get_tab_content({ tabId: ${a.ref?.tabId ?? 'active'} })`);
          }

          return lines.join('\n');
        });
        prompt = '[Context — attached by the user via "Add to Anya" or @mentions]\n' +
          'The user\'s message below may reference this context directly (e.g. "summarize this", ' +
          '"what does this mean", "fix this") — treat the attached context as what "this" refers to.\n\n' +
          ctxBlocks.join('\n\n') + '\n\n[Message]\n' + prompt;
      }
    } catch (err) {
      console.warn('[Anya] context prep failed; sending raw prompt', err);
    }

    // Extract image blobs from context chips for the bridge frame.
    const imageBlobs = contextChips
      .filter((a) => a.kind === 'image' && a.imageData)
      .map((a) => a.imageData!);

    // Default caption when only images were sent so the model has something
    // textual to anchor on.
    if (!prompt.trim() && imageBlobs.length > 0) {
      prompt = `(${imageBlobs.length} image${imageBlobs.length === 1 ? '' : 's'} attached — please look at ${imageBlobs.length === 1 ? 'it' : 'them'}.)`;
    }

    // When voice output is active, hint the model to produce voice-friendly text.
    if (this.speechSettings.outputEnabled && this.speechSettings.autoSpeak) {
      const streaming = this.speechSettings.streamSpeak;
      prompt += '\n\n[System: Your text response is being converted to speech and ' +
        (streaming ? 'streamed to the user in real-time as you generate it.' : 'spoken to the user after you finish responding.') +
        ' Keep your response concise and high-value — the user is listening, not reading. ' +
        'Avoid markdown formatting, code fences, tables, bullet lists, and special characters. ' +
        'Use short sentences in a natural conversational tone. Skip unnecessary detail. ' +
        'This does NOT affect tool calls — continue using tools normally; only your prose text is spoken.]';
    }

    const frame: Record<string, unknown> = { type: 'prompt', chatId, text: prompt, mode };
    // Pass cwd on every prompt so the bridge can use it when lazily creating
    // the session.  After the first prompt the bridge ignores it (session exists).
    const chat = this.chats.find((c) => c.id === chatId);
    if (chat?.cwd) frame.cwd = chat.cwd;
    if (imageBlobs.length > 0) {
      frame.attachments = imageBlobs.map((a, i) => ({
        data: a.data,
        mimeType: a.mimeType,
        displayName: a.name ?? `pasted-image-${i + 1}.${a.mimeType.split('/')[1] ?? 'png'}`,
      }));
    }
    const ok = this.bridgeSend(frame);
    if (!ok) this.pushSystem(chatId, 'bridge disconnected — waiting to reconnect…', 'error');
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // If the autocomplete popup is open with at least one match, intercept
    // navigation/commit keys before any other handler sees them.
    if (this.autocomplete) {
      const items = this.filteredAutocomplete();
      if (items.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.autocomplete = { ...this.autocomplete, selectedIdx: (this.autocomplete.selectedIdx + 1) % items.length };
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.autocomplete = { ...this.autocomplete, selectedIdx: (this.autocomplete.selectedIdx - 1 + items.length) % items.length };
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          this.applyAutocomplete(items[this.autocomplete.selectedIdx]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this.autocomplete = null;
          return;
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.autocomplete = null;
        return;
      }
    }
    // Input history navigation: Up/Down when autocomplete is closed and
    // cursor is at the very start (Up) or very end (Down) of the textarea,
    // or textarea is single-line.
    if (!this.autocomplete && this.inputHistory.length > 0) {
      const ta = e.target as HTMLTextAreaElement;
      const singleLine = !ta.value.includes('\n');
      if (e.key === 'ArrowUp' && (singleLine || ta.selectionStart === 0)) {
        e.preventDefault();
        if (this.historyIdx === -1) {
          this.historyDraft = ta.value;
          this.historyIdx = this.inputHistory.length - 1;
        } else if (this.historyIdx > 0) {
          this.historyIdx--;
        }
        ta.value = this.inputHistory[this.historyIdx];
        this.syncDraft(ta.value);
        return;
      }
      if (e.key === 'ArrowDown' && (singleLine || ta.selectionStart === ta.value.length)) {
        if (this.historyIdx !== -1) {
          e.preventDefault();
          if (this.historyIdx < this.inputHistory.length - 1) {
            this.historyIdx++;
            ta.value = this.inputHistory[this.historyIdx];
          } else {
            this.historyIdx = -1;
            ta.value = this.historyDraft;
          }
          this.syncDraft(ta.value);
          return;
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Ctrl+Enter while streaming = steer (immediate); plain Enter = enqueue.
      const isStreaming = this.currentChatId && this.streamingIds.has(this.currentChatId);
      this.send(isStreaming && e.ctrlKey ? 'immediate' : 'enqueue');
    }
  };

  private onInput = (e: Event): void => {
    const ta = e.target as HTMLTextAreaElement;
    this.syncDraft(ta.value);
    this.maybeOpenAutocomplete(ta);
  };

  /** Keep the highlight overlay scrolled in lock-step with the textarea
   *  (only matters once the user types past `max-height: 160px`). */
  private onComposerScroll = (e: Event): void => {
    const ta = e.target as HTMLTextAreaElement;
    const mirror = ta.parentElement?.querySelector('.composer-mirror') as HTMLElement | null;
    if (mirror) mirror.scrollTop = ta.scrollTop;
  };

  /** Single point of truth for "the textarea changed". Updates both the
   *  emptiness flag (drives the send button) and the mirror text (drives the
   *  highlight overlay behind the textarea). */
  private syncDraft(value: string): void {
    this.draftEmpty = value.length === 0;
    this.composerText = value;
  }

  /**
   * Decide whether the caret is sitting in a `/` or `@` autocomplete
   * context, and update `this.autocomplete` accordingly.
   *
   *  - Slash: only when the textarea begins with `/` and the caret is
   *    inside that first run of non-whitespace chars (matches the actual
   *    slash-command dispatch in `send()`).
   *  - At: when the caret is at the end of an `@\S*` run preceded by
   *    start-of-string or whitespace.
   */
  private maybeOpenAutocomplete(ta: HTMLTextAreaElement): void {
    const caret = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, caret);

    const slashMatch = /^\/(\S*)$/.exec(before);
    if (slashMatch) {
      const query = slashMatch[1];
      const prev = this.autocomplete;
      this.autocomplete = {
        kind: 'slash',
        startIdx: 0,
        query,
        selectedIdx: prev?.kind === 'slash' && prev.query === query ? prev.selectedIdx : 0,
      };
      return;
    }

    const atMatch = /(?:^|\s)(@\S*)$/.exec(before);
    if (atMatch) {
      const tokenStart = caret - atMatch[1].length;
      const query = atMatch[1].slice(1);
      const prev = this.autocomplete;
      this.autocomplete = {
        kind: 'at',
        startIdx: tokenStart,
        query,
        selectedIdx: prev?.kind === 'at' && prev.query === query ? prev.selectedIdx : 0,
      };
      return;
    }

    this.autocomplete = null;
  }

  /**
   * Filtered, sorted catalog entries for the current trigger.
   * Items where the bare token (stripped of `/` or `@`) starts with the
   * query are listed first; substring matches come after. Empty query
   * shows the whole catalog.
   */
  private filteredAutocomplete(): ReadonlyArray<{ token: string; description: string; insert?: string }> {
    const ac = this.autocomplete;
    if (!ac) return [];
    const cat = ac.kind === 'slash' ? AnyaApp.SLASH_CATALOG : AnyaApp.AT_CATALOG;
    const q = ac.query.toLowerCase();
    if (!q) return cat;
    const starts: typeof cat[number][] = [];
    const contains: typeof cat[number][] = [];
    for (const it of cat) {
      const bare = it.token.slice(1).toLowerCase();
      if (bare.startsWith(q)) starts.push(it);
      else if (bare.includes(q)) contains.push(it);
    }
    return [...starts, ...contains];
  }

  /** Replace the trigger run with the chosen completion text. */
  private applyAutocomplete(item: { token: string; insert?: string; chipKind?: string }): void {
    const ac = this.autocomplete;
    const ta = this.textarea;
    if (!ac || !ta) return;

    // If this @-item produces a context chip, resolve it and add as chip
    // instead of inserting the token text into the composer.
    if (ac.kind === 'at' && item.chipKind) {
      // Remove the typed @... text from the composer.
      const caret = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, ac.startIdx) + ta.value.slice(caret);
      ta.selectionStart = ta.selectionEnd = ac.startIdx;
      ta.focus();
      this.syncDraft(ta.value);
      this.autocomplete = null;
      // Resolve asynchronously and add chip.
      void this.attach(item.chipKind);
      return;
    }

    // Default: insert text into composer (slash commands, @tab:<query>).
    const caret = ta.selectionStart ?? ta.value.length;
    const insertText = item.insert ?? item.token;
    ta.value = ta.value.slice(0, ac.startIdx) + insertText + ta.value.slice(caret);
    const newCaret = ac.startIdx + insertText.length;
    ta.selectionStart = ta.selectionEnd = newCaret;
    ta.focus();
    this.syncDraft(ta.value);
    this.autocomplete = null;
  }

  /** Resolve a chip kind into a ContextAttachment and add it.
   *  This is the universal entry point for all chip types — called from
   *  @autocomplete, 📎 menu, right-click "Add to Anya", and buffered loads. */
  private async attach(chipKind: string): Promise<void> {
    // Folder is special — opens a native OS dialog via the bridge.
    if (chipKind === 'folder') {
      this.bridgeSend({ type: 'folder-pick' });
      return;
    }

    const CAP = ATTACHMENT_VALUE_CAP;
    const trunc = (s: string) => s.length > CAP ? s.slice(0, CAP) : s;

    try {
      let att: Omit<ContextAttachment, 'id'> | null = null;

      if (chipKind === 'tab') {
        const tab = await this.getActiveTab().catch(() => null);
        if (tab) {
          const result = await this.executeTool('get_tab_content', { tabId: tab.id });
          const text = typeof result === 'string' ? result : JSON.stringify(result);
          const title = tab.title || tab.url || 'Page';
          att = { kind: 'tab', icon: '🌐', label: title.length > 50 ? title.slice(0, 47) + '…' : title, preview: `Full tab · ${tab.url ? new URL(tab.url).hostname : ''}`, content: trunc(text), fullLength: text.length, ref: { tabId: tab.id }, pageUrl: tab.url ?? '' };
        }
      } else if (chipKind === 'selection') {
        const result = await this.executeTool('get_selection', {});
        const text = typeof result === 'string' ? result : '';
        if (text) {
          att = { kind: 'selection', icon: '✂️', label: `"${text.length > 47 ? text.slice(0, 44) + '…' : text}"`, preview: text.length > 80 ? text.slice(0, 77) + '…' : text, content: trunc(text), fullLength: text.length, pageUrl: '' };
        }
      } else if (chipKind === 'url') {
        const tab = await this.getActiveTab().catch(() => null);
        if (tab?.url) {
          att = { kind: 'url', icon: '🔗', label: tab.url.length > 60 ? tab.url.slice(0, 57) + '…' : tab.url, preview: tab.url, content: tab.url, pageUrl: tab.url };
        }
      } else if (chipKind === 'title') {
        const tab = await this.getActiveTab().catch(() => null);
        if (tab?.title) {
          att = { kind: 'title', icon: '📌', label: tab.title, preview: tab.title, content: tab.title, pageUrl: tab.url ?? '' };
        }
      } else if (chipKind === 'clipboard') {
        const text = await navigator.clipboard.readText().catch(() => '');
        if (text) {
          att = { kind: 'clipboard', icon: '📋', label: `"${text.length > 47 ? text.slice(0, 44) + '…' : text}"`, preview: text.length > 80 ? text.slice(0, 77) + '…' : text, content: trunc(text), fullLength: text.length, pageUrl: '' };
        }
      } else if (chipKind === 'tabs') {
        const result = await this.executeTool('list_tabs', {});
        const tabs = Array.isArray(result) ? result : [];
        const md = tabs.map((t: any) => `| ${t.tabId} | ${t.active ? '→' : ''} | ${t.title} | ${t.url} |`).join('\n');
        const content = `| id | active | title | url |\n| --- | --- | --- | --- |\n${md}`;
        att = { kind: 'tabs', icon: '📑', label: `${tabs.length} open tabs`, preview: `${tabs.length} tabs`, content: trunc(content), fullLength: content.length, pageUrl: '' };
      } else if (chipKind === 'bookmarks') {
        const result = await this.executeTool('manage_bookmarks', { op: 'list', limit: 100 });
        const data = result as { count?: number; items?: Array<{ title: string; url?: string; folderPath: string; isFolder: boolean }> };
        const items = data.items ?? [];
        const md = items.filter((b) => b.url).map((b) => `| ${b.title} | ${b.url} | ${b.folderPath} |`).join('\n');
        const content = `| title | url | folder |\n| --- | --- | --- |\n${md}`;
        att = { kind: 'bookmark', icon: '🔖', label: `${items.length} bookmarks`, preview: `${items.length} bookmarks`, content: trunc(content), fullLength: content.length, pageUrl: '' };
      } else if (chipKind === 'history') {
        const results = await chrome.history.search({ text: '', startTime: Date.now() - 7 * 86_400_000, maxResults: 50 });
        const md = results.map((r) => `| ${r.title ?? ''} | ${r.url ?? ''} | ${r.lastVisitTime ? new Date(r.lastVisitTime).toISOString().slice(0, 16) : ''} |`).join('\n');
        const content = `| title | url | last visit |\n| --- | --- | --- |\n${md}`;
        att = { kind: 'history', icon: '📜', label: `${results.length} recent pages`, preview: `Last 7 days · ${results.length} pages`, content: trunc(content), fullLength: content.length, pageUrl: '' };
      }

      if (att) {
        this.commitAttachment(att);
      }
    } catch (err) {
      console.warn(`[Anya] failed to resolve @${chipKind}:`, err);
    }
  }

  /** Intercept clipboard images on the textarea. */
  private onPaste = (e: ClipboardEvent): void => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const it of imageItems) {
      const file = it.getAsFile();
      if (file) void this.addImageAttachment(file);
    }
  };

  /** Read a File as data URL + base64 and add as a context chip. */
  private async addImageAttachment(file: File): Promise<void> {
    if (file.size > AnyaApp.ATTACHMENT_TOTAL_LIMIT) {
      this.pushSystem(
        this.currentChatId || this.startNewChat(),
        `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ~${(AnyaApp.ATTACHMENT_TOTAL_LIMIT / 1024 / 1024).toFixed(0)} MB per attachment.`,
        'error',
      );
      return;
    }
    const totalSoFar = this.contextAttachments
      .filter((a) => a.kind === 'image' && a.imageData)
      .reduce((n, a) => n + (a.imageData?.bytes ?? 0), 0);
    if (totalSoFar + file.size > AnyaApp.ATTACHMENT_TOTAL_LIMIT) {
      this.pushSystem(
        this.currentChatId || this.startNewChat(),
        `Total attachments would exceed ~${(AnyaApp.ATTACHMENT_TOTAL_LIMIT / 1024 / 1024).toFixed(0)} MB. Send what you have, then attach more.`,
        'error',
      );
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ''));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    }).catch((err) => {
      console.warn('[Anya] read image failed:', err);
      return '';
    });
    if (!dataUrl) return;
    const commaIdx = dataUrl.indexOf(',');
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
    const imgNum = this.contextAttachments.filter((a) => a.kind === 'image').length + 1;
    const name = file.name || `pasted-image-${imgNum}`;
    const sizeKB = (file.size / 1024).toFixed(0);

    // Add as context chip.
    this.commitAttachment({
      kind: 'image',
      icon: '🖼️',
      label: `${name} · ${sizeKB} KB`,
      preview: `${file.type}, ${sizeKB} KB`,
      content: '',
      pageUrl: '',
      imageData: { dataUrl, data: base64, mimeType: file.type || 'image/png', bytes: file.size, name },
    });
  }

  // ----- 📎 attach menu -------------------------------------------------

  // Handle folder-pick result from bridge.
  private pendingWorkspacePick = false;
  private handleFolderPickResult(path: string): void {
    if (this.pendingWorkspacePick) {
      // Workspace selector flow: only set cwd, no attachment.
      this.pendingWorkspacePick = false;
      this.setWorkspaceFolder(path);
      return;
    }
    const folderName = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
    this.commitAttachment({
      kind: 'folder',
      icon: '📁',
      label: folderName,
      preview: path,
      content: `Local folder: ${path}\nUse view, grep, glob, edit tools to work with files in this folder.`,
      ref: { folderPath: path },
      pageUrl: '',
    });
    // Set the cwd on the current chat so the bridge uses it as workingDirectory.
    if (this.currentChatId) {
      this.chats = this.chats.map((c) => c.id === this.currentChatId ? { ...c, cwd: path } : c);
      this.persistChats();
    }
  }

  // ----- Workspace selector ------------------------------------------------
  private pickWorkspaceFolder(): void {
    this.pendingWorkspacePick = true;
    this.bridgeSend({ type: 'folder-pick' });
  }

  private setWorkspaceFolder(path: string): void {
    if (!this.currentChatId) return;
    this.chats = this.chats.map((c) => c.id === this.currentChatId ? { ...c, cwd: path } : c);
    this.persistChats();
    const folderName = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
    this.pushSystem(this.currentChatId, `Workspace set to **${folderName}**\n\`${path}\``, 'normal');
  }

  private clearWorkspace(): void {
    if (!this.currentChatId) return;
    this.chats = this.chats.map((c) => {
      if (c.id !== this.currentChatId) return c;
      const { cwd: _, ...rest } = c;
      return rest as typeof c;
    });
    this.persistChats();
    this.pushSystem(this.currentChatId, 'Workspace cleared. Using default Anya workspace.', 'normal');
  }

  // ----- Approval handling ------------------------------------------------
  private respondToApproval(requestId: string, approved: boolean): void {
    this.bridgeSend({
      type: 'permission-response',
      requestId,
      approved,
    });
    this.pendingApprovals.delete(requestId);
    this.requestUpdate();
  }

  private renderApprovalBanners() {
    if (this.pendingApprovals.size === 0) return nothing;
    const entries = [...this.pendingApprovals.entries()].filter(
      ([, v]) => v.chatId === this.currentChatId,
    );
    if (entries.length === 0) return nothing;
    return entries.map(([id, req]) => html`
      <div class="approval-banner">
        <span class="approval-icon">⚠️</span>
        <span class="approval-info">
          <span class="approval-tool">${formatToolDisplayName(req.toolName)}</span>
          <span class="approval-kind">${req.kind}</span>
        </span>
        <button class="approval-btn approve" @click=${() => this.respondToApproval(id, true)}>Allow</button>
        <button class="approval-btn deny" @click=${() => this.respondToApproval(id, false)}>Deny</button>
      </div>
    `);
  }

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
      tc.status === 'running' ? '⟳' : tc.status === 'success' ? '✓' : '✕';
    const elapsed = tc.finishedAt
      ? `${tc.finishedAt - tc.startedAt}ms`
      : tc.status === 'running'
        ? (tc.progress ?? 'running…')
        : '';
    const argsLine = friendlyArgs(tc.toolName, tc.arguments)
      || (tc.arguments && Object.keys(tc.arguments as object).length > 0
        ? JSON.stringify(tc.arguments)
        : '');
    const displayName = formatToolDisplayName(tc.toolName, tc.mcpServerName);
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
                  : tc.status === 'running' && tc.partialOutput
                    ? html`<div class="tc-section">OUTPUT</div><pre class="tc-partial">${tc.partialOutput}</pre>`
                    : nothing}
            </div>`
          : tc.status === 'running' && tc.partialOutput
            ? html`<div class="tc-detail"><pre class="tc-partial">${tc.partialOutput.length > 200 ? '…' + tc.partialOutput.slice(-200) : tc.partialOutput}</pre></div>`
            : nothing}
      </div>
    `;
  }

  /**
   * Split text into plain strings and highlighted `@-token` spans so
   * attachment references stand out visually in the composer and chat bubbles.
   */
  private renderMentionedText(text: string) {
    // Matches all @ tokens: original ones (@tab, @selection, etc.) plus
    // attachment references (@element:Name, @field:Name, @image:name, @folder:name, @link:name, @bookmark:name).
    const rx = /@(?:selection|url|title|clipboard|tabs|tab(?::\S+)?|element:\S+|field:\S+|image:\S+|folder:\S+|link:\S+|bookmark:\S+|history:\S+)(?=$|[\s.,;!?])/gi;
    const parts: Array<unknown> = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(html`<span class="mention" title="recognised mention">${m[0]}</span>`);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.length === 0 ? text : parts;
  }

  private renderBubble(m: ChatMessage, opts?: { assistantTurnTail?: boolean; assistantIndex?: number }) {
    if (m.role === 'system') {
      return html`<div class="bubble">${m.text}</div>`;
    }
    if (m.role === 'user') {
      const ctxLabels = m.contextLabels ?? [];
      return html`
        <div class="bubble">
          ${ctxLabels.length > 0 ? html`
            <div class="msg-ctx-chips">
              ${ctxLabels.map((c) => html`
                <span class="msg-ctx-chip">
                  ${c.dataUrl ? html`<img class="msg-ctx-chip-thumb" src=${c.dataUrl} alt="" />` : nothing}
                  ${c.icon} ${c.label}
                </span>
              `)}
            </div>
          ` : nothing}
          ${m.text ? html`<div class="msg-text">${this.renderMentionedText(m.text)}</div>` : nothing}
        </div>
      `;
    }
    // assistant: tool cards (if any) above markdown body, append blinking caret while streaming
    const ids = m.toolCallIds ?? [];
    const cards = ids
      .map((id) => this.toolCalls.get(id))
      .filter((tc): tc is ToolCall => !!tc);
    const text = m.text || '';
    const hasVisibleText = text.trim().length > 0;
    const html_ = marked.parse(text) as string;
    // Pending-but-empty assistant messages mean the model is thinking
    // (turn started, but no tokens or tool calls yet). Show an animated
    // thinking line so the UI doesn't appear frozen.
    const isThinking = m.pending && !m.text && cards.length === 0;
    return html`
      ${cards.length > 0
        ? html`<div class="toolcalls">${cards.map((tc) => this.renderToolCard(tc))}</div>`
        : nothing}
      ${isThinking
        ? html`<div class="thinking" title="agent is working">
            <span class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>
            <span class="thinking-text">${m.intent ? m.intent : 'Thinking…'}</span>
          </div>`
        : nothing}
      ${hasVisibleText || (m.pending && text.length > 0)
        ? html`<div class="bubble">
            ${unsafeHTML(html_)}${m.pending && m.text ? html`<span class="caret"></span>` : nothing}
            ${!m.pending && hasVisibleText && (opts?.assistantTurnTail ?? true) ? html`
              <div class="bubble-actions">
                <button class="bubble-action-btn" @click=${() => {
                  if (typeof opts?.assistantIndex === 'number') this.copyAssistantTurnFromIndex(opts.assistantIndex);
                  else this.copyMessage(m);
                }} title="Copy whole turn">📋</button>
                ${this.speechOutput.supported && this.speechSettings.outputEnabled ? html`
                  <button class="bubble-action-btn" @click=${() => this.speakMessage(m.text)} title=${this.isSpeaking ? 'Stop' : 'Speak'}>${this.isSpeaking ? '⏹' : '🔊'}</button>
                ` : nothing}
                ${this.focusedField ? html`
                  <button class="bubble-action-btn" @click=${() => this.fillField(m.text)} title="Insert into field">↗</button>
                  <button class="bubble-action-btn" @click=${() => this.fillField(m.text, 'append')} title="Append to field">＋</button>
                ` : nothing}
              </div>
            ` : nothing}
          </div>`
        : nothing}
    `;
  }

  private roleLabel(m: ChatMessage): string {
    if (m.role === 'user') return 'You';
    if (m.role === 'assistant') return 'Anya';
    if (m.kind === 'error') return 'Error';
    if (m.kind === 'denied') return 'Denied';
    return 'System';
  }

  // ----- debug panel rendering -----------------------------------------
  @state() private debugFilter: 'all' | 'errors' | 'stream' | 'tools' = 'all';
  @state() private debugExpanded = new Set<string>();

  private frameTypeFromSummary(summary: string): string | null {
    const m = /^\s*[←→]\s+([a-z0-9-]+)/i.exec(summary);
    return m?.[1]?.toLowerCase() ?? null;
  }

  private debugFilterMatches(entry: DebugEntry): boolean {
    const frameType = this.frameTypeFromSummary(entry.summary);
    switch (this.debugFilter) {
      case 'errors':
        return entry.level === 'error'
          || entry.level === 'warn'
          || (entry.kind as string) === 'error'
          || /\berror\b|\bdenied\b|\bfailed\b/i.test(entry.summary);
      case 'stream':
        return frameType === 'turn-start'
          || frameType === 'intent'
          || frameType === 'delta'
          || frameType === 'message'
          || frameType === 'done';
      case 'tools':
        return (frameType?.startsWith('tool-') ?? false)
          || frameType === 'permission-denied'
          || /\btool\b|\bpermission\b/i.test(entry.summary);
      default:
        return true;
    }
  }

  private debugViewEntries(): Array<DebugEntry & { synthetic?: boolean }> {
    const filtered = this.debugEntries.filter((e) => this.debugFilterMatches(e));
    const out: Array<DebugEntry & { synthetic?: boolean }> = [];
    for (let i = 0; i < filtered.length; i++) {
      const cur = filtered[i];
      const isDelta = cur.kind === 'in' && this.frameTypeFromSummary(cur.summary) === 'delta';
      if (!isDelta) {
        out.push(cur);
        continue;
      }

      let j = i + 1;
      while (
        j < filtered.length
        && filtered[j].kind === 'in'
        && this.frameTypeFromSummary(filtered[j].summary) === 'delta'
      ) {
        j++;
      }
      const run = filtered.slice(i, j);
      if (run.length === 1) {
        out.push(cur);
      } else {
        const first = run[0];
        const last = run[run.length - 1];
        const spanMs = Math.max(0, last.ts - first.ts);
        out.push({
          id: `agg:${first.id}:${last.id}`,
          ts: last.ts,
          kind: 'in',
          summary: `← delta ×${run.length} (${spanMs}ms burst)`,
          detail: `Collapsed ${run.length} consecutive delta frames from ${this.fmtDebugTime(first.ts)} to ${this.fmtDebugTime(last.ts)}.`,
          synthetic: true,
        });
      }
      i = j - 1;
    }
    return out;
  }

  private toggleDebugRow(id: string): void {
    const next = new Set(this.debugExpanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.debugExpanded = next;
    this.requestUpdate();
  }

  private renderDebugPanel() {
    const path = this.bridgeLogFile;
    const viewEntries = this.debugViewEntries();
    return html`
      <section class="debug">
        <div class="debug-bar">
          <span>BRIDGE TRACE · ${viewEntries.length}/${this.debugEntries.length}</span>
          <span class="grow"></span>
          <button
            class=${this.debugFilter === 'all' ? 'active' : ''}
            @click=${() => { this.debugFilter = 'all'; }}
            title="Show all rows"
          >all</button>
          <button
            class=${this.debugFilter === 'errors' ? 'active' : ''}
            @click=${() => { this.debugFilter = 'errors'; }}
            title="Show warnings and errors"
          >errors</button>
          <button
            class=${this.debugFilter === 'stream' ? 'active' : ''}
            @click=${() => { this.debugFilter = 'stream'; }}
            title="Show streaming lifecycle rows"
          >stream</button>
          <button
            class=${this.debugFilter === 'tools' ? 'active' : ''}
            @click=${() => { this.debugFilter = 'tools'; }}
            title="Show tool and permission rows"
          >tools</button>
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
          ${viewEntries.length === 0
            ? html`<div class="debug-empty">no traffic yet — send a prompt</div>`
            : repeat(
                viewEntries,
                (e) => e.id,
                (e) => {
                  const expanded = this.debugExpanded.has(e.id);
                  const tag = e.kind === 'log' ? (e.level ?? 'log') : e.kind;
                  const canExpand = !!e.detail;
                  const cls = `debug-row ${e.kind} ${e.level ?? ''} ${expanded ? 'expanded' : ''} ${canExpand ? '' : 'no-detail'} ${'synthetic' in e && e.synthetic ? 'synthetic' : ''}`;
                  return html`
                    <div class=${cls} @click=${() => { if (canExpand) this.toggleDebugRow(e.id); }}>
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

  // ----- tools settings panel -------------------------------------------
  private renderToolsPanel() {
    const enabledCount = TOOL_GROUPS.reduce((n, g) => n + g.tools.filter((t) => !this.disabledTools.has(t.name)).length, 0);
    const totalCount = TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0);
    return html`
      <section class="tools-panel">
        <div class="tools-bar">
          <span>🔧 TOOLS · ${enabledCount}/${totalCount} enabled</span>
          <span class="grow"></span>
          <button @click=${() => { this.disabledTools = new Set(); this.persistDisabledTools(); }} title="Enable all">all on</button>
          <button @click=${() => {
            const all = new Set<string>();
            for (const g of TOOL_GROUPS) for (const t of g.tools) all.add(t.name);
            this.disabledTools = all;
            this.persistDisabledTools();
          }} title="Disable all">all off</button>
        </div>
        <div class="tools-hint">These are Anya's built-in browser tools — on top of any MCP servers loaded from your workspace.</div>
        <div class="tools-approval-row">
          <label class="tool-item approval-toggle">
            <span class="tool-switch">
              <input
                type="checkbox"
                .checked=${!this.autoApprove}
                @change=${() => { this.autoApprove = !this.autoApprove; this.persistAutoApprove(); }}
              />
              <span class="tool-slider"></span>
            </span>
            <span class="tool-info">
              <span class="tool-name">Require approval for write tools</span>
              <span class="tool-desc">${this.autoApprove ? 'Auto-approving all tools' : 'Will ask before write/shell/MCP tools run'}</span>
            </span>
          </label>
        </div>
        <div class="tools-groups">
          ${TOOL_GROUPS.map((group) => {
            const collapsed = this.toolGroupCollapsed.has(group.id);
            const groupEnabled = group.tools.filter((t) => !this.disabledTools.has(t.name)).length;
            const groupTotal = group.tools.length;
            const allOn = groupEnabled === groupTotal;
            const allOff = groupEnabled === 0;
            return html`
              <div class="tool-group ${collapsed ? 'collapsed' : ''}">
                <div class="tool-group-header" @click=${() => this.toggleToolGroupCollapse(group.id)}>
                  <span class="tool-group-chevron">${collapsed ? '▸' : '▾'}</span>
                  <span class="tool-group-icon">${group.icon}</span>
                  <span class="tool-group-label">${group.label}</span>
                  <span class="tool-group-count">${groupEnabled}/${groupTotal}</span>
                  <button
                    class="tool-group-toggle ${allOn ? 'on' : allOff ? 'off' : 'partial'}"
                    @click=${(e: Event) => { e.stopPropagation(); this.toggleToolGroup(group.id, !allOn); }}
                    title=${allOn ? 'Disable all in group' : 'Enable all in group'}
                  >${allOn ? 'on' : allOff ? 'off' : 'partial'}</button>
                </div>
                ${!collapsed ? html`
                  <div class="tool-group-body">
                    ${group.tools.map((tool) => {
                      const enabled = !this.disabledTools.has(tool.name);
                      return html`
                        <label class="tool-item ${enabled ? '' : 'disabled'}">
                          <span class="tool-switch">
                            <input
                              type="checkbox"
                              .checked=${enabled}
                              @change=${() => this.toggleTool(tool.name)}
                            />
                            <span class="tool-slider"></span>
                          </span>
                          <span class="tool-info">
                            <span class="tool-name">${tool.label}</span>
                            <span class="tool-desc">${tool.description}</span>
                          </span>
                        </label>
                      `;
                    })}
                  </div>
                ` : nothing}
              </div>
            `;
          })}
        </div>
      </section>
    `;
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
          ${cur && this.renamingChatId === cur.id ? html`
            <input
              class="chat-title-edit"
              .value=${cur.title}
              maxlength="80"
              autofocus
              @keydown=${(e: KeyboardEvent) => {
                const input = e.target as HTMLInputElement;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const next = input.value.trim();
                  if (next) this.renameChat(cur.id, next);
                  else this.renamingChatId = null;
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  this.renamingChatId = null;
                }
              }}
              @blur=${(e: FocusEvent) => {
                const next = (e.target as HTMLInputElement).value.trim();
                if (next) this.renameChat(cur.id, next);
                else this.renamingChatId = null;
              }}
            />
          ` : html`
            <span class="chat-title-pill" @click=${() => { if (cur) this.renamingChatId = cur.id; }}>
              ${cur ? cur.title : 'no chat'}
            </span>
          `}
          <span
            class="signal ${online ? 'on' : ''}"
            title=${online ? `Bridge live · v${this.bridgeVersion} · pid ${pid}` : 'Bridge offline'}
            aria-label=${online ? 'Bridge connected' : 'Bridge offline'}
          ><span class="pulse"></span></span>
          <span class="header-actions">
            <button
              class="icon-btn"
              @click=${() => this.startNewChat()}
              title="New chat (Ctrl+N)"
              aria-label="New chat"
            >＋</button>
            <button
              class="icon-btn"
              @click=${this.toggleExpand}
              title=${this.isPopupMode ? 'Collapse back to sidebar' : 'Expand panel'}
              aria-label=${this.isPopupMode ? 'Collapse' : 'Expand'}
            >${this.isPopupMode ? '⤓' : '⤢'}</button>
            <span class="header-more-wrap">
              <button
                class="icon-btn ${this.headerMenuOpen ? 'active' : ''}"
                @click=${() => { this.headerMenuOpen = !this.headerMenuOpen; }}
                title="More options"
                aria-label="More options"
              >⋯</button>
              ${this.headerMenuOpen ? html`
                <div class="header-menu">
                  <button class="header-menu-item" @click=${() => { this.headerMenuOpen = false; this.runUpdateFlow(); }}>
                    <span class="header-menu-icon">⬆</span> Check for Updates
                  </button>
                  <hr class="header-menu-sep" />
                  <button class="header-menu-item" @click=${() => { this.headerMenuOpen = false; this.openRemoteDebugSettings(); }}>
                    <span class="header-menu-icon">🔌</span> Remote Debug
                  </button>
                  <button class="header-menu-item" @click=${() => { this.headerMenuOpen = false; this.toggleDebug(); }}>
                    <span class="header-menu-icon">🐛</span> Debug Log${this.debugOpen ? html` <span class="header-menu-check">✓</span>` : nothing}
                  </button>
                  <hr class="header-menu-sep" />
                  <button class="header-menu-item" @click=${() => { this.headerMenuOpen = false; this.toggleTheme(); }}>
                    <span class="header-menu-icon">${this.theme === 'dark' ? '☀' : '☾'}</span> ${this.theme === 'dark' ? 'Light' : 'Dark'} Theme
                  </button>
                  <hr class="header-menu-sep" />
                  <span class="header-menu-label">Voice</span>
                  <button class="header-menu-item" @click=${() => { this.updateSpeechSetting('inputEnabled', !this.speechSettings.inputEnabled); }}>
                    <span class="header-menu-icon">🎤</span> Input${this.speechSettings.inputEnabled ? html` <span class="header-menu-check">✓</span>` : nothing}
                  </button>
                  ${this.speechSettings.inputEnabled ? html`
                    <button class="header-menu-item sub" @click=${() => { this.updateSpeechSetting('autoSubmit', !this.speechSettings.autoSubmit); }}>
                      <span class="header-menu-icon"></span> Auto-submit${this.speechSettings.autoSubmit ? html` <span class="header-menu-check">✓</span>` : nothing}
                    </button>
                  ` : nothing}
                  <button class="header-menu-item" @click=${() => { this.updateSpeechSetting('outputEnabled', !this.speechSettings.outputEnabled); }}>
                    <span class="header-menu-icon">🔊</span> Output${this.speechSettings.outputEnabled ? html` <span class="header-menu-check">✓</span>` : nothing}
                  </button>
                  ${this.speechSettings.outputEnabled ? html`
                    <button class="header-menu-item sub" @click=${() => { this.updateSpeechSetting('autoSpeak', !this.speechSettings.autoSpeak); }}>
                      <span class="header-menu-icon"></span> Auto-speak${this.speechSettings.autoSpeak ? html` <span class="header-menu-check">✓</span>` : nothing}
                    </button>
                    <button class="header-menu-item sub" @click=${() => { this.updateSpeechSetting('streamSpeak', !this.speechSettings.streamSpeak); }}>
                      <span class="header-menu-icon"></span> Stream${this.speechSettings.streamSpeak ? html` <span class="header-menu-check">✓</span>` : nothing}
                    </button>
                    <span class="header-menu-item sub">
                      <span class="header-menu-icon"></span> Speed
                      <button class="speed-btn" @click=${() => this.adjustTtsSpeed(-0.25)}>−</button>
                      <span class="speed-value">${this.speechSettings.rate.toFixed(2)}×</span>
                      <button class="speed-btn" @click=${() => this.adjustTtsSpeed(0.25)}>+</button>
                    </span>
                  ` : nothing}
                </div>
              ` : nothing}
            </span>
          </span>
        </div>
      </header>

      ${this.chatDrawerOpen ? this.renderDrawer() : nothing}
      ${this.searchOpen ? this.renderSearchOverlay() : nothing}
      ${this.debugOpen ? this.renderDebugPanel() : nothing}

      <main @scroll=${this.onTranscriptScroll}>
        ${!online
          ? html`<div class="empty offline-banner">
              <span class="glyph">⚡</span>
              <span class="offline-title">Bridge offline</span>
              <span class="offline-hint">Anya can't reach the local bridge process.<br/>
                Run <code>./setup.ps1</code> to register it, then reload the extension.</span>
            </div>`
          : this.messages.length === 0
          ? html`<div class="empty">
              <span class="glyph">A</span>
              <span class="empty-title">GitHub Copilot, in your browser!!</span>
              <span class="empty-sub">Read tabs. Drive pages. Search bookmarks.<br/>Pick your model. Approve actions or let it flow.</span>
            </div>`
          : repeat(
              this.messages.map((m, i) => ({
                m,
                i,
                continuation:
                  i > 0
                  && this.messages[i - 1].role === 'assistant'
                  && m.role === 'assistant',
                assistantTurnTail:
                  m.role === 'assistant'
                  && (i === this.messages.length - 1 || this.messages[i + 1].role !== 'assistant'),
              })),
              (x) => x.m.id,
              (x) => html`
                <div class="msg ${x.m.role} ${x.m.kind ?? ''} ${x.continuation ? 'continuation' : ''}" @mouseleave=${() => { if (this.msgMenuId === x.m.id) this.msgMenuId = null; }}>
                  ${!x.continuation ? html`
                    <div class="meta">
                      <span class="avatar">${x.m.role === 'user' ? '⊹' : x.m.role === 'assistant' ? html`<img src="icons/icon16.png" alt="A" class="avatar-icon"/>` : '◈'}</span>
                      <span class="role">${this.roleLabel(x.m)}</span>
                      <span class="ts">${this.fmtTime(x.m.ts)}</span>
                      <button class="msg-menu-btn" @click=${() => { this.msgMenuId = this.msgMenuId === x.m.id ? null : x.m.id; }} title="Actions">⋯</button>
                      ${this.msgMenuId === x.m.id ? html`
                        <span class="msg-menu">
                          <button @click=${() => this.copyMessage(x.m)} title="Copy">copy</button>
                          ${this.speechOutput.supported && this.speechSettings.outputEnabled ? html`
                            <button @click=${() => this.speakMessage(x.m.text)} title=${this.isSpeaking ? 'Stop' : 'Speak'}>${this.isSpeaking ? '⏹' : '🔊'}</button>
                          ` : nothing}
                          ${x.m.role === 'user' ? html`
                            <button @click=${() => this.regenerateFromMessage(this.currentChatId, x.m.id)} title="Re-send">resend</button>
                          ` : nothing}
                          <button @click=${() => this.deleteMessage(this.currentChatId, x.m.id)} title="Delete">del</button>
                        </span>
                      ` : nothing}
                    </div>
                  ` : nothing}
                  ${this.renderBubble(x.m, { assistantTurnTail: x.assistantTurnTail, assistantIndex: x.i })}
                </div>
              `,
            )}
      </main>

      <footer>
        ${this.hasNewBelow ? html`
          <button class="new-activity-btn" @click=${() => this.scrollToBottom(true)}>
            New activity below ↓
          </button>
        ` : nothing}
        ${this.renderApprovalBanners()}
        ${this.speechNotice ? html`
          <div class="speech-notice">
            <span>🎤 ${this.speechNotice}</span>
            <button class="speech-notice-x" @click=${() => { this.speechNotice = ''; }} title="Dismiss">✕</button>
          </div>
        ` : nothing}
        ${this.autocomplete ? this.renderAutocomplete() : nothing}
        ${this.contextAttachments.length > 0 ? html`
          <div class="ctx-strip">
            <div class="ctx-strip-header">
              <span class="ctx-strip-label">📎 CONTEXT</span>
              <button class="ctx-clear-btn" @click=${() => this.clearAttachments()} title="Clear all">clear</button>
            </div>
            ${this.contextAttachments.map((a) => html`
              <div class="ctx-chip" title=${a.preview}>
                <span class="ctx-chip-icon">${a.icon}</span>
                <span class="ctx-chip-label">${a.label}</span>
                <button class="ctx-chip-x" @click=${() => this.removeAttachment(a.id)} title="Remove">×</button>
              </div>
            `)}
          </div>
        ` : nothing}
        <div class="composer-row">
          <div class="composer-input">
            <div class="composer-mirror" aria-hidden="true">${this.renderMentionedText(this.composerText)}${this.composerText.endsWith('\n') ? ' ' : ''}</div>
            <textarea
              id="prompt-input"
              rows="1"
              spellcheck="false"
              placeholder=${online ? 'Ask or tell Anya what to do…' : 'Bridge offline — waiting to reconnect…'}
              ?disabled=${!online}
              @keydown=${this.onKeyDown}
              @input=${this.onInput}
              @paste=${this.onPaste}
              @scroll=${this.onComposerScroll}
            ></textarea>
          </div>
          <div class="composer-actions">
            <button class="attach-btn" @click=${() => { this.attachMenuOpen = !this.attachMenuOpen; }} title="Attach context (＋)" aria-label="Add context">＋</button>
            ${this.attachMenuOpen ? html`
              <div class="attach-menu">
                <div class="attach-menu-section">CONTEXT</div>
                <button class="attach-menu-item" @click=${() => { this.attachMenuOpen = false; this.attach('tab'); }}><span class="attach-menu-icon">🌐</span> Current tab</button>
                <button class="attach-menu-item" @click=${() => { this.attachMenuOpen = false; this.attach('selection'); }}><span class="attach-menu-icon">✂️</span> Selection</button>
                <button class="attach-menu-item" @click=${() => { this.attachMenuOpen = false; this.attach('tabs'); }}><span class="attach-menu-icon">📑</span> All open tabs</button>
                <button class="attach-menu-item" @click=${() => { this.attachMenuOpen = false; this.attach('clipboard'); }}><span class="attach-menu-icon">📋</span> Clipboard</button>
                <button class="attach-menu-item" @click=${() => { this.attachMenuOpen = false; this.attach('url'); }}><span class="attach-menu-icon">🔗</span> URL</button>
                <button class="attach-menu-item" @click=${() => { this.attachMenuOpen = false; this.attach('title'); }}><span class="attach-menu-icon">📌</span> Title</button>
                <hr class="attach-menu-sep" />
                <button class="attach-menu-item" @click=${() => { this.attachMenuOpen = false; this.attach('bookmarks'); }}><span class="attach-menu-icon">🔖</span> Bookmarks</button>
                <button class="attach-menu-item" @click=${() => { this.attachMenuOpen = false; this.attach('history'); }}><span class="attach-menu-icon">📜</span> Recent history</button>
                <button class="attach-menu-item" @click=${() => { this.attachMenuOpen = false; this.attach('folder'); }}><span class="attach-menu-icon">📁</span> Folder...</button>
              </div>
            ` : nothing}
            <button class="model-pill-btn" @click=${() => { this.modelMenuOpen = !this.modelMenuOpen; }} title="Select model">
              ${this.selectedModel ? this.availableModels.find((m) => m.id === this.selectedModel)?.name ?? this.selectedModel : 'Auto'} ▾
            </button>
            ${this.modelMenuOpen ? html`
              <div class="model-menu">
                <div class="model-menu-header">Select model</div>
                <button class="model-menu-item ${!this.selectedModel ? 'active' : ''}" @click=${() => { this.selectedModel = ''; this.bridgeSend({ type: 'set-model', model: '' }); this.modelMenuOpen = false; }}>
                  <span class="model-menu-check">${!this.selectedModel ? '✓' : ''}</span>
                  <span class="model-menu-info"><span class="model-menu-name">Auto</span><span class="model-menu-detail">SDK picks best model</span></span>
                </button>
                ${this.availableModels.length > 0 ? html`<hr class="model-menu-sep" />` : nothing}
                ${this.availableModels.map((m) => html`
                  <button class="model-menu-item ${m.id === this.selectedModel ? 'active' : ''}" @click=${() => { this.selectedModel = m.id; this.bridgeSend({ type: 'set-model', model: m.id }); this.modelMenuOpen = false; }}>
                    <span class="model-menu-check">${m.id === this.selectedModel ? '✓' : ''}</span>
                    <span class="model-menu-info">
                      <span class="model-menu-name">${m.name}</span>
                      <span class="model-menu-detail">${m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K context` : ''}${m.billingMultiplier && m.billingMultiplier !== 1 ? ` · ${m.billingMultiplier}x` : ''}</span>
                    </span>
                  </button>
                `)}
                ${this.availableModels.length === 0 ? html`
                  <div class="model-menu-empty">Loading models…</div>
                ` : nothing}
              </div>
            ` : nothing}
            <button class="workspace-pill-btn" @click=${() => { this.workspaceMenuOpen = !this.workspaceMenuOpen; }} title=${this.currentChat?.cwd ? `Workspace: ${this.currentChat.cwd}` : 'Default Anya workspace'}>
              📁 ${this.currentChat?.cwd ? this.currentChat.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : 'Anya'} ▾
            </button>
            ${this.workspaceMenuOpen ? html`
              <div class="workspace-menu">
                <div class="workspace-menu-header">Workspace</div>
                ${this.currentChat?.cwd ? html`
                  <div class="workspace-menu-current">
                    <span class="workspace-menu-path" title=${this.currentChat.cwd}>📁 ${this.currentChat.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}</span>
                    <button class="workspace-menu-clear" @click=${() => { this.clearWorkspace(); this.workspaceMenuOpen = false; }} title="Clear workspace">✕</button>
                  </div>
                  <span class="workspace-menu-fullpath">${this.currentChat.cwd}</span>
                  <hr class="workspace-menu-sep" />
                ` : nothing}
                <button class="workspace-menu-item" @click=${() => { this.workspaceMenuOpen = false; this.pickWorkspaceFolder(); }}>
                  <span class="workspace-menu-icon">📂</span> Open folder…
                </button>
              </div>
            ` : nothing}
            <button class="composer-pill-btn" @click=${() => this.toggleToolsPanel()} title="Configure tools">
              🔧 ${TOOL_GROUPS.reduce((n, g) => n + g.tools.filter((t) => !this.disabledTools.has(t.name)).length, 0)}/${TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0)}
            </button>
            <span class="composer-spacer"></span>
            ${this.toolsPanelOpen ? this.renderToolsPanel() : nothing}
            ${this.speechOutput.supported ? html`
              <button
                class="tts-bar-toggle ${this.speechSettings.outputEnabled && this.speechSettings.autoSpeak ? 'on' : ''}"
                @click=${() => {
                  const enabling = !(this.speechSettings.outputEnabled && this.speechSettings.autoSpeak);
                  this.updateSpeechSetting('outputEnabled', enabling);
                  this.updateSpeechSetting('autoSpeak', enabling);
                  if (!enabling && this.isSpeaking) {
                    this.speechOutput.stop();
                    this.isSpeaking = false;
                    this._speechBuffer = '';
                    this._speechStreamingFor = null;
                  }
                }}
                title=${this.speechSettings.outputEnabled && this.speechSettings.autoSpeak ? 'Speaker on — click to stop & mute' : 'Speaker off — click to enable'}
              >${this.speechSettings.outputEnabled && this.speechSettings.autoSpeak ? '🔊' : '🔇'}</button>
            ` : nothing}
            ${this.speechInput.supported && this.speechSettings.inputEnabled ? html`
              <button
                class="mic-btn ${this.isListening ? 'listening' : ''}"
                @click=${() => this.toggleSpeechInput()}
                title=${this.isListening ? 'Stop listening' : 'Voice input'}
                aria-label=${this.isListening ? 'Stop listening' : 'Start voice input'}
              >${this.isListening ? '⏹' : '🎤'}</button>
            ` : nothing}
            ${this.currentChatId && this.streamingIds.has(this.currentChatId)
              ? html`<span class="send-split">
                  <button
                    class="send-btn stop-primary"
                    @click=${() => this.cancelStream(this.currentChatId)}
                    title="Stop generating (Esc)"
                    aria-label="Stop"
                  >◼</button>
                  ${!this.draftEmpty || this.contextAttachments.length > 0 ? html`
                    <button
                      class="send-split-chevron"
                      @click=${() => { this.sendMenuOpen = !this.sendMenuOpen; }}
                      title="More send options"
                      aria-label="Send options"
                    >▾</button>
                    ${this.sendMenuOpen ? html`
                      <div class="send-menu">
                        <button
                          class="send-menu-item"
                          @click=${() => { this.sendMenuOpen = false; this.send('immediate'); }}
                        ><span class="send-menu-icon">↯</span> Stop and Send<span class="send-menu-kbd">Alt+Enter</span></button>
                        <button
                          class="send-menu-item"
                          @click=${() => { this.sendMenuOpen = false; this.send('enqueue'); }}
                        ><span class="send-menu-icon">＋</span> Add to Queue<span class="send-menu-kbd">Enter</span></button>
                        <hr class="send-menu-sep" />
                        <button
                          class="send-menu-item"
                          @click=${() => { this.sendMenuOpen = false; this.cancelStream(this.currentChatId); }}
                        ><span class="send-menu-icon">◼</span> Stop Generating<span class="send-menu-kbd">Esc</span></button>
                      </div>
                    ` : nothing}
                  ` : nothing}
                </span>`
              : html`<button
                  class="send-btn"
                  @click=${() => this.send()}
                  ?disabled=${(this.draftEmpty && this.contextAttachments.length === 0) || !online}
                  title="Send (Enter)"
                >↑</button>`}
          </div>
        </div>
      </footer>

    `;
  }

  private renderAutocomplete() {
    const items = this.filteredAutocomplete();
    if (items.length === 0) return nothing;
    const ac = this.autocomplete!;
    const heading = ac.kind === 'slash' ? 'slash commands' : '@-mentions';
    return html`
      <div class="ac-popup" role="listbox" aria-label=${heading}>
        <div class="ac-head">${heading}${ac.query ? html` · matching <em>${ac.query}</em>` : nothing}</div>
        ${items.map((it, i) => html`
          <div
            class=${i === ac.selectedIdx ? 'ac-item ac-item--sel' : 'ac-item'}
            role="option"
            aria-selected=${i === ac.selectedIdx ? 'true' : 'false'}
            @mousedown=${(e: Event) => {
              // mousedown (not click) so we win the focus race against blur
              e.preventDefault();
              this.applyAutocomplete(it);
            }}
            @mouseenter=${() => {
              if (this.autocomplete) this.autocomplete = { ...this.autocomplete, selectedIdx: i };
            }}
          >
            <span class="ac-tok">${it.token}</span>
            <span class="ac-desc">${it.description}</span>
          </div>
        `)}
        <div class="ac-foot">↑↓ navigate · ↵/⇥ insert · esc dismiss</div>
      </div>
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
          <button class="icon-btn" @click=${() => { this.searchOpen = true; this.chatDrawerOpen = false; }} title="Search chats (Ctrl+K)">⌕</button>
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
              <span class="qp-label">${q.label}</span>
              <span class="qp-hint">${q.hint ?? q.body}</span>
            </button>
          `)}
        </div>
      </aside>
      <div class="drawer-scrim" @click=${() => { this.chatDrawerOpen = false; }}></div>
    `;
  }

  private renderChatRow(c: Chat) {
    const isCurrent = c.id === this.currentChatId;
    const tokens = Math.round(c.messages.reduce((n, m) => n + m.text.length, 0) / 4);
    const age = this.fmtRelative(c.updatedAt);
    const tags = c.tags ?? [];
    return html`
      <div class="chat-row ${isCurrent ? 'current' : ''}" @click=${() => this.switchChat(c.id)}>
        <span class="chat-title">
          ${c.title}
        </span>
        <span class="chat-meta">
          ${c.pinned ? html`<span class="tag-chip mini">pinned</span>` : nothing}
          ${c.messages.length} msg · ~${tokens} tok · ${age}
          ${c.cwd ? html`<span class="tag-chip mini" title=${c.cwd}>📁 ${c.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}</span>` : ''}
          ${tags.map((t) => html`<span class="tag-chip mini">#${t}</span>`) }
        </span>
        <span class="chat-actions">
          <button
            class="icon-btn ${c.pinned ? 'active' : ''}"
            @click=${(e: Event) => { e.stopPropagation(); this.togglePin(c.id); }}
            title=${c.pinned ? 'Unpin' : 'Pin chat'}
          >📌</button>
          <button class="icon-btn" @click=${(e: Event) => { e.stopPropagation(); this.exportChat(c.id); }} title="Export to markdown">⬇</button>
          <button class="icon-btn" @click=${(e: Event) => { e.stopPropagation(); this.deleteChat(c.id); }} title="Delete chat">×</button>
        </span>
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

}

declare global {
  interface HTMLElementTagNameMap {
    'anya-app': AnyaApp;
  }
}
