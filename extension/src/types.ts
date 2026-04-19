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
  /** Inline image attachments (paste / drop). User messages only. */
  attachments?: ImageAttachment[];
}

export interface ImageAttachment {
  /** data URL: "data:<mime>;base64,<...>" — used for in-bubble preview. */
  dataUrl: string;
  /** Raw base64 (no data URL prefix) — sent to bridge / SDK. */
  data: string;
  mimeType: string;
  /** Encoded byte count (for the strip badge). */
  bytes: number;
  /** Optional original filename. */
  name?: string;
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

/**
 * Mirror of the bridge's bound Playwright tab. `status === 'connected'` means
 * the user accepted the Playwright extension's connect dialog.
 */
export interface BoundTab {
  sessionId: string;
  status: 'waiting-for-connect' | 'connected' | 'dead' | 'none';
  url: string | null;
  title: string | null;
  hint: string | null;
  chromeTabId: number | null;
  chromeWindowId: number | null;
  attachedAt: string;
  lastSeenAt: string | null;
  markerInjected: boolean;
}

/** A reusable prompt template the user can insert with one click. */
export interface QuickPrompt {
  id: string;
  label: string;
  body: string;
}

/** Built-in starter prompts; users can add/remove their own at runtime. */
export const DEFAULT_QUICK_PROMPTS: QuickPrompt[] = [
  { id: 'qp-summarize', label: 'Summarize page', body: 'Summarize @tab in 5 bullets and end with a one-line verdict.' },
  { id: 'qp-translate', label: 'Translate selection', body: 'Translate @selection to English. Preserve formatting.' },
  { id: 'qp-explain', label: 'Explain code', body: 'Explain what the code in @selection does. Be concise and technical.' },
  { id: 'qp-reply', label: 'Draft reply', body: 'Draft a polite reply to @selection. Match the tone.' },
  { id: 'qp-compare', label: 'Compare tabs', body: 'Compare what is open across @tabs and tell me the key differences.' },
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
