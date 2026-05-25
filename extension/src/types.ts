/**
 * Shared types for the Anya sidebar UI.
 *
 * Anything stored in `chrome.storage.local` is shaped by these interfaces, so
 * be careful when changing field names — `loadChats()` validates and coerces
 * older shapes but new fields should always be optional with a sensible
 * default.
 */

export type Role = 'user' | 'assistant' | 'system';

/**
 * One tool invocation surfaced by the bridge for an in-progress (or completed)
 * assistant turn. Lifecycle: tool-start → tool-progress* → tool-complete.
 */
export interface ToolCall {
  toolCallId: string;
  toolName: string;
  mcpServerName?: string;
  arguments?: unknown;
  status: 'running' | 'success' | 'error';
  startedAt: number;
  finishedAt?: number;
  progress?: string;
  /** Streaming tool output accumulated from tool.execution_partial_result events. */
  partialOutput?: string;
  resultPreview?: string;
  error?: string;
  /** UI-only: card is currently expanded to show args / result. */
  expanded?: boolean;
}

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  /** Set while a streaming assistant message is still being written to. */
  pending?: boolean;
  /** Drives bubble styling for non-normal messages (errors, ping/pong, etc.). */
  kind?: 'normal' | 'pong' | 'error' | 'denied' | 'hello';
  ts: number;
  /** Tool call ids that ran while producing this assistant message. */
  toolCallIds?: string[];
  /** Latest agent intent (from `assistant.intent` SDK event) — shown
      while the bubble is still pending and has no text yet. */
  intent?: string;
  /** Context attachment labels shown as chips in the user bubble. */
  contextLabels?: Array<{ icon: string; label: string; dataUrl?: string }>;
}

/**
 * One conversation thread. Each chat has its own bridge-side Copilot session
 * (keyed by `id`), so switching chats is a true context switch — not just a
 * scrollback flip.
 */
export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  toolCalls: Record<string, ToolCall>;
  createdAt: number;
  updatedAt: number;
  /** Pinned chats float to the top of the drawer. */
  pinned?: boolean;
  /** Free-form labels for the tag filter bar. */
  tags?: string[];
  /** Local folder path — when set, the bridge uses this as the SDK workingDirectory
   *  so skills, prompts, and .copilot-instructions.md are loaded from the repo. */
  cwd?: string;
}


/** A reusable prompt template the user can insert with one click. */
export interface QuickPrompt {
  id: string;
  label: string;
  hint?: string;
  body: string;
}

/** Built-in starter prompts; users can add/remove their own at runtime. */
export const DEFAULT_QUICK_PROMPTS: QuickPrompt[] = [
  {
    id: 'qp-summarize',
    label: 'Summarize This Page',
    hint: 'Key points, risks, and next actions',
    body: 'Summarize @tab into key points, risks, and next actions. Keep it under 8 bullets.',
  },
  {
    id: 'qp-actions',
    label: 'Extract Action Items',
    hint: 'Turn page content into a task list',
    body: 'From @tab, extract concrete action items with owner (if known), due date (if mentioned), and priority.',
  },
  {
    id: 'qp-explain',
    label: 'Explain Selected Code',
    hint: 'Purpose, flow, and edge cases',
    body: 'Explain the code in @selection: purpose, execution flow, assumptions, and edge cases. Keep it concise and technical.',
  },
  {
    id: 'qp-reply',
    label: 'Draft Reply (2 Versions)',
    hint: 'Concise + detailed response',
    body: 'Draft a reply to @selection in the same tone. Provide two versions: concise and detailed.',
  },
  {
    id: 'qp-compare',
    label: 'Compare Open Tabs',
    hint: 'Overlaps, differences, best source',
    body: 'Compare @tabs and return overlaps, differences, and which tab should be treated as the primary source of truth.',
  },
  {
    id: 'qp-downloads',
    label: 'Find Recent Download',
    hint: 'Locate likely file quickly',
    body: 'Check my recent downloads and suggest the most relevant file for this task, including filename and when it was downloaded.',
  },
];

/** One row in the live debug panel — either a frame or a bridge log line. */
export interface DebugEntry {
  id: string;
  ts: number;
  kind: 'in' | 'out' | 'log';
  level?: 'info' | 'warn' | 'error';
  summary: string;
  detail?: string;
}

export const DEBUG_MAX_ENTRIES = 500;

/**
 * Metadata about a text field the user is focused on in a page.
 * Sent by the page-bridge content script on every focusin event.
 */
export interface FocusedField {
  fieldId: string;
  tabId: number;
  tagName: string;
  inputType: string | null;
  placeholder: string;
  label: string;
  ariaLabel: string;
  currentValue: string;
  maxLength: number | null;
  isContentEditable: boolean;
  pageUrl: string;
  pageTitle: string;
}

/**
 * A context attachment shown as a chip above the composer. Added via:
 * - Right-click "Add to Anya" (element, selection, field, link, page)
 * - @-mention autocomplete (@tab, @selection, @tabs, @clipboard, @url, @title)
 * - Alt+A keyboard shortcut
 *
 * Multiple chips can stack. All are injected into the prompt on send.
 */
export type AttachmentKind =
  | 'element'     // right-click on a DOM element
  | 'selection'   // selected text on page, or @selection
  | 'tab'         // full tab content, @tab
  | 'field'       // editable text field
  | 'link'        // right-click on an <a> element
  | 'tabs'        // @tabs — list of all open tabs
  | 'clipboard'   // @clipboard
  | 'url'         // @url — just the active tab URL
  | 'title'       // @title — just the active tab title
  | 'bookmark'    // @bookmark — a saved bookmark by search
  | 'history'     // @history — recent browsing history
  | 'image'       // pasted/dropped image
  | 'folder';     // local project folder

/** Max chars stored by-value in an attachment. Larger content is truncated;
 *  the model can fetch the full version via reference tools. */
export const ATTACHMENT_VALUE_CAP = 5_000;

// --------------- TOOL REGISTRY ---------------
// Used by the sidebar tools-settings panel to let the user enable/disable
// individual tools. Groups provide visual organisation.

export interface ToolMeta {
  /** Machine name — must match the defineTool() name on the bridge side. */
  name: string;
  /** Short human-readable label. */
  label: string;
  /** One-line description shown below the label. */
  description: string;
  /** True for tools that modify browser state (tabs, bookmarks, DOM, storage).
   *  Write tools go through the approval flow when auto-approve is off;
   *  read tools (`write` absent or false) always execute immediately. */
  write?: boolean;
}

export interface ToolGroup {
  id: string;
  label: string;
  icon: string;
  tools: ToolMeta[];
}

/**
 * Canonical tool groups. Kept in the extension so the UI can render without
 * a bridge connection. Names MUST match `defineTool(name, ...)` in
 * `bridge/src/tools.ts`.
 */
export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'browser',
    label: 'Browser',
    icon: '🌐',
    tools: [
      { name: 'get_active_tab', label: 'Current Tab', description: 'See what page you\'re on' },
      { name: 'get_tab_content', label: 'Page Content', description: 'Read the page as text' },
      { name: 'get_selection', label: 'Selection', description: 'Grab highlighted text' },
      { name: 'list_tabs', label: 'Open Tabs', description: 'See all your open tabs' },
      { name: 'open_tab', label: 'Open Tab', description: 'Open a new tab', write: true },
      { name: 'close_tab', label: 'Close Tab', description: 'Close tabs', write: true },
      { name: 'focus_tab', label: 'Switch Tab', description: 'Jump to a tab', write: true },
      { name: 'browse_history', label: 'History', description: 'Search past visits' },
      { name: 'browse_downloads', label: 'Downloads', description: 'Search recent downloads' },
      { name: 'search_chats', label: 'Chat History', description: 'Search past Anya conversations' },
      { name: 'manage_bookmarks', label: 'Bookmarks', description: 'Find and manage bookmarks', write: true },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    icon: '🎭',
    tools: [
      { name: 'connect_browser', label: 'Connect', description: 'Start controlling the browser', write: true },
      { name: 'disconnect_browser', label: 'Disconnect', description: 'Stop controlling the browser', write: true },
      { name: 'bound_tabs', label: 'Status', description: 'Check the connection' },
      { name: 'drive_tab', label: 'Interact', description: 'Click, type, fill, screenshot', write: true },
      { name: 'drive_browser', label: 'Manage Tabs', description: 'Open, close, switch tabs', write: true },
      { name: 'drive_context', label: 'Data & State', description: 'Cookies, storage, auth, network', write: true },
      { name: 'drive_devtools', label: 'Inspect', description: 'Console, network, tracing', write: true },
    ],
  },
];

export interface ContextAttachment {
  id: string;
  kind: AttachmentKind;
  icon: string;
  label: string;
  preview: string;
  /** By-value content, capped at ATTACHMENT_VALUE_CAP chars. */
  content: string;
  /** By-reference coordinates for fetching fresh/full content on demand. */
  ref?: {
    tabId?: number;
    ctxId?: string;       // data-anya-ctx attribute for elements
    fieldId?: string;     // data-anya-field-id for fields
    folderPath?: string;  // local filesystem path for folders
  };
  /** Total char count of the original content (before truncation). */
  fullLength?: number;
  pageUrl: string;
  /** For image attachments — the blob data. */
  imageData?: {
    dataUrl: string;     // data:mime;base64,... for thumbnail
    data: string;        // raw base64 (sent to bridge)
    mimeType: string;
    bytes: number;
    name?: string;
  };
}
