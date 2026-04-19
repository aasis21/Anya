# AgentEdge — Design

> **One line.** GitHub Copilot's CLI agent, repackaged as a Microsoft Edge
> sidebar app, so it lives next to your tabs, can see and drive them, and
> inherits every MCP server you have already configured for the terminal.

This document describes the system as it stands today: what each piece does,
why it exists, and the contracts between them. It is the spec — read this
before changing architecture.

---

## 1. Goals

- **Same Copilot, different surface.** Reuse `@github/copilot-sdk` so we get
  streaming, tool calls, MCP, slash commands, and authentication for free.
  AgentEdge is a UI shell, not a model integration.
- **Browser context is implicit.** The agent should always know what tab the
  user is looking at without being asked. Open tabs, selection, page content,
  and bookmarks are first-class inputs.
- **Drive the real, logged-in browser.** When the user says "click that
  button," it should click the button on _their_ Edge — same cookies, same
  SSO, same session — not some headless instance.
- **Multi-thread by default.** Pinning, tagging, switching between unrelated
  conversations should be instant. Each thread keeps its own state on the
  bridge side.
- **Local-first, secret-aware.** No cloud beyond what Copilot itself uses. No
  telemetry. The Playwright extension token never leaves the machine.

### Non-goals

- Polished marketplace distribution. AgentEdge is loaded unpacked.
- Cross-browser support. Edge sidePanel is baked in.
- Replacing the terminal `copilot` CLI. AgentEdge is a peer surface; the CLI
  remains the source of truth for auth, MCP config, and prompt files.

---

## 2. Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Microsoft Edge — MV3 sidePanel                               │
│                                                               │
│  ┌─────────────────────────┐    ┌─────────────────────────┐   │
│  │  AgentEdge sidebar      │    │  Your tabs / pages      │   │
│  │  (Lit + marked)         │    │                         │   │
│  │  ─────────────────────  │    │   github.com/foo/bar    │   │
│  │  > review this PR       │    │   dev.azure.com/...     │   │
│  │  ▍ streaming reply…     │    │   localhost:3000        │   │
│  │                         │    └─────────────────────────┘   │
│  │  reads via              │              ▲                   │
│  │  chrome.tabs            │              │ drives via        │
│  │  chrome.scripting       │              │ Playwright         │
│  │  chrome.bookmarks       │    ┌─────────────────────────┐   │
│  │                         │    │  Playwright MCP Bridge  │   │
│  │  Native Messaging       │    │  extension (MS)         │   │
│  └────────────┬────────────┘    └────────────┬────────────┘   │
└───────────────┼──────────────────────────────┼────────────────┘
                │ length-prefixed JSON         │ localhost + token
                ▼                              │
┌──────────────────────────────────────────────┼────────────────┐
│  AgentEdge Bridge — Node.js                 │                │
│                                              │                │
│  ┌──────────────────────────────────────────┴──────────────┐  │
│  │  host.ts        : NM stdio loop, frame router            │  │
│  │  copilot-bridge : SessionManager (one CopilotSession      │  │
│  │                   per chat id, on top of one CopilotClient│ │
│  │  sessions.ts    : single bound Playwright tab + polling   │  │
│  │  tools.ts       : context tools + browser tool definitions│ │
│  │  tool-rpc.ts    : bridge → extension RPC for chrome.*     │  │
│  └──────────────────┬────────────────────────────────────────┘  │
│                     │                                           │
│   @github/copilot-  │                          ┌──────────────┐ │
│   sdk               ▼                          │ playwright-  │ │
│  ┌────────────────────────┐                    │ cli daemon    │─┘
│  │ Copilot agent process  │ ── browser tool ──▶│ (headed Edge) │
│  │  + MCP servers from    │                    └──────────────┘
│  │   ~/.copilot/...       │
│  └────────────────────────┘
└────────────────────────────────────────────────────────────────┘
```

### Five components

| # | Component                | Tech                             | What it does                                                  |
| - | ------------------------ | -------------------------------- | ------------------------------------------------------------- |
| 1 | Sidebar UI               | Lit, `marked`                    | Chat surface, drawer, mentions, slash commands, debug panel   |
| 2 | Extension layer          | `chrome.tabs/scripting/...`      | Captures browser context; mediates the bridge connection      |
| 3 | Native Messaging bridge  | Node + `@github/copilot-sdk`     | Owns Copilot sessions, runs tools, persists state             |
| 4 | Playwright control plane | `@playwright/cli` + MS extension | Drives the user's real Edge tab                               |
| 5 | Config + logs            | `~/.agentedge/`, `bridge.log`    | Local-only state, optional auto-attach token, live trace      |

The boundary that matters most is **(2) ↔ (3)**: a length-prefixed JSON
channel via Edge's Native Messaging API. Everything is asynchronous; everything
is JSON. There is no shared memory, no Web Worker, no bundled SDK in the
extension.

---

## 3. The wire protocol

The extension and bridge speak frames over Native Messaging. Each frame is a
JSON object with a `type` discriminator. There is no schema validation today
beyond TypeScript types — the assumption is that both sides ship together.

### Extension → bridge

| `type`              | Payload                                          | Purpose                                       |
| ------------------- | ------------------------------------------------ | --------------------------------------------- |
| `hello`             | `{ version }`                                    | Sent on connect                               |
| `prompt`            | `{ chatId, text }`                               | Send a user message into a chat               |
| `chat-delete`       | `{ chatId }`                                     | Tear down the bridge-side session for a chat  |
| `tool-result`       | `{ requestId, ok, result?, error? }`             | Reply to a tool RPC from the bridge           |
| `pw-bind`           | `{ hint? }`                                      | Spawn a new bound Playwright tab              |
| `pw-unbind`         | `{}`                                             | Release the bound tab                         |
| `pw-status`         | `{}`                                             | Force-refresh the bound tab snapshot          |

### Bridge → extension

| `type`             | Payload                                                     | Purpose                                |
| ------------------ | ----------------------------------------------------------- | -------------------------------------- |
| `hello`            | `{ version, pid, logFile, playwrightToken }`                | Sent on connect                        |
| `delta`            | `{ chatId, text }`                                          | Streaming chunk                        |
| `message`          | `{ chatId, text }`                                          | Final assistant message text           |
| `done`             | `{ chatId }`                                                | Stream complete                        |
| `error`            | `{ chatId, message }`                                       | Session error                          |
| `tool-start`       | `{ chatId, toolCallId, toolName, arguments?, mcpServerName? }` | Tool call started                   |
| `tool-progress`    | `{ chatId, toolCallId, message }`                           | Tool emitted progress                  |
| `tool-complete`    | `{ chatId, toolCallId, success, resultPreview?, error? }`   | Tool finished                          |
| `tool-request`     | `{ requestId, name, args }`                                 | Bridge needs a `chrome.*` lookup       |
| `pw-status`        | `{ tab: BoundTab }`                                         | Snapshot of the bound tab              |
| `log`              | `{ level, summary, detail? }`                               | Mirrored bridge log line               |

### Frames the user sees

The 🐛 panel in the sidebar mirrors every in/out frame and every `log` line.
Click any row to expand the JSON. This is the canonical way to debug the
system; if behaviour looks wrong, the answer is in the panel.

---

## 4. Sessions and chats

### One client, many sessions

`SessionManager` (`bridge/src/copilot-bridge.ts`) starts exactly one
`CopilotClient` per bridge process. The first chat to send a prompt triggers
`client.start()`; subsequent chats reuse it. Each chat id gets its own
`CopilotSession`, lazily created and cached in a `Map<chatId, ChatHandle>`.

Why per-chat sessions instead of one shared session?

- **Independent context.** The model's context window is per-session. Chats
  shouldn't bleed into each other.
- **Independent tool state.** A `browser` tool call in chat A shouldn't
  surface in chat B's tool card stream.
- **Cheap to scale.** Sessions are objects, not processes. The expensive
  thing is the client (which spawns the agent process).

`getOrCreateChat(chatId)` deduplicates concurrent creates via an in-flight
`Promise` map (`creating: Map<chatId, Promise<ChatHandle>>`). This matters when
the user mashes Enter twice on a brand-new chat.

`stop()` clears `creating` _before_ disconnecting sessions to prevent a
just-resolved promise from attaching listeners onto a stopped client.

### Working directory per chat

Each chat gets its own working directory under `~/.agentedge/sessions/<safeId>/`
where `safeId` strips chat ids down to `[a-zA-Z0-9_-]{1..64}`. This lets the
agent's filesystem tools operate without colliding across chats.

### Persistence

- **Bridge side:** session state is stateless across bridge restarts (the
  Copilot SDK manages its own sessions). The bridge does persist the bound
  Playwright tab to `~/.agentedge/playwright-session.json` so a bridge restart
  doesn't kill a working tab.
- **Extension side:** `chrome.storage.local` holds the chat list, the current
  chat id, the theme, the debug-mode flag, and quick prompts. Writes are
  debounced (250 ms), and `disconnectedCallback` flushes any pending write
  synchronously so a sidebar close in the debounce window doesn't lose data.

---

## 5. Tool model

There are two flavours of tools:

### Bridge-resident tools

Defined in `bridge/src/tools.ts` via the SDK's `defineTool()`. They run inside
the bridge process. `browser` is the prime example — it shells out to
`playwright-cli` against the bound tab.

### Extension-resident tools (RPC)

Some context tools need `chrome.*` APIs that only exist in the extension. The
bridge declares them as `defineTool` but their handler sends a `tool-request`
frame back to the extension and awaits a `tool-result`. `tool-rpc.ts`
correlates them via `requestId` and applies a 30-second timeout.

The four context tools wired this way:

| Tool              | What it returns                                                |
| ----------------- | -------------------------------------------------------------- |
| `get_active_tab`  | URL, title, tabId, windowId for the user's active tab          |
| `list_tabs`       | Every open tab's id, url, title, active flag                   |
| `get_selection`   | The current text selection in the active tab                   |
| `get_tab_content` | Plain-text body of a tab (active or `tabId`-specified)         |

These are also accessible to the user via mentions (see §6).

---

## 6. Browser context: mentions

Before any prompt is sent, the extension's `expandMentions(text)` walks the
draft and replaces tokens with the relevant context inline. The agent sees
plain Markdown; it doesn't have to call a tool to look at what the user is
already pointing at.

| Token        | Replacement                                                       |
| ------------ | ----------------------------------------------------------------- |
| `@tab`       | `### Active page: <title> — <url>` + plain-text body              |
| `@selection` | The selected text in the active tab                               |
| `@url`       | Active tab URL                                                    |
| `@title`     | Active tab title                                                  |
| `@clipboard` | System clipboard text                                             |
| `@tabs`      | A markdown table of all tabs (id, active flag, title, url)        |
| `@tab:<id\|query>` | Same as `@tab` but for a specific tab — numeric id OR substring of title/url |

This is a deliberate design choice: **tool calls are for actions, mentions are
for context.** Pre-expanded mentions cost zero round trips and zero tool-call
budget.

---

## 7. Playwright control plane

The agent drives the user's real browser via the `browser` tool. Mechanics:

1. The user clicks **bind** in the sidebar's footer strip.
2. The bridge spawns `playwright-cli attach --extension=msedge` with a
   minted `sessionId`.
3. The Playwright MCP Bridge extension (Microsoft, separate install) shows a
   **Connect?** dialog. The user accepts.
4. The bridge starts polling `playwright-cli list` to track URL/title/status.
5. Subsequent `browser` tool calls invoke `playwright-cli` with the same
   `sessionId`, scoping every command to that tab.
6. **unbind** kills the child process and clears the bound state.

### Why one tab at a time?

Earlier versions tried multi-tab attachment with marker injection to
disambiguate which tab the model meant. It failed: the model gets confused,
the polling overhead multiplies, and the connect dialog flow gets
unrecoverably messy when you have three pending dialogs at once. The current
design — one bound tab, replace on rebind — keeps the user's mental model
("there is _the_ browser") aligned with the bridge's.

### Polling loop

`startPolling()` schedules a `tick` that runs `playwright-cli list`, updates
the bound-tab snapshot, and reschedules itself. Two safety properties:

- **Sessionid capture.** `tick` captures the sessionid at start. If `bindTab`
  replaces the binding mid-await, the orphan tick bails instead of scheduling
  a new timer onto the new binding.
- **Adaptive interval.** 8 s when connected, 2 s while waiting for connect.

### Auto-attach token

The Playwright MCP Bridge extension issues a per-machine token. If the user
captures it once and pastes it into `~/.agentedge/config.json` or sets
`PLAYWRIGHT_MCP_EXTENSION_TOKEN`, the connect dialog is bypassed on
subsequent binds. The token is treated as local-only (never logged in full,
never sent over the wire).

---

## 8. UI architecture

### Single Lit component

`<agent-edge-app>` (`extension/src/main.ts`) is a single Lit component. It
owns all UI state, the chat store, the frame handler, the tool RPC, and the
render tree. The original sin of putting it all in one file is mitigated by:

- **`styles.ts`** — the full ~860-line CSS tagged template lives there.
- **`types.ts`** — every shared interface and constant.
- **Section banners** in `main.ts` mark logical groupings (`// ----- chat
  store ------`, `// ----- frame handling ------`, etc.).

If the file ever needs to grow further, the natural next splits are:

- A `chat-store.ts` for `loadChats` / `persistChats` / `mutateChat` etc.
- A `mentions.ts` for `expandMentions` and friends.
- A `slash-commands.ts` for the `handleSlashCommand` router.

### State model

All UI state is reactive via Lit `@state`. Two non-reactive sets carry
runtime-only flags:

- `streamingIds: Map<chatId, messageId>` — which streaming message is
  currently being painted for which chat.
- `cancelledChats: Set<chatId>` — soft-cancel marker; cleared on `done`.

Persistence is in `chrome.storage.local` under three keys: `agentedge-chats`,
`agentedge-current-chat`, `agentedge-theme`. Quick prompts and the debug-mode
flag are separate keys.

### Streaming

The frame handler (`handleFrame`) accumulates `delta` events into the chat's
in-progress message. If the chat id is in `cancelledChats`, deltas are
dropped on the floor. `done` clears the streaming flag and the cancel marker.

### Tool cards

Each `tool-start` frame creates a `ToolCall` record on the chat's `toolCalls`
map. The currently-streaming assistant message tracks its tool call ids in
`toolCallIds`, so each card stays attached to the right turn even after
several streams have completed.

---

## 9. Security model

- **Extension ↔ bridge channel** is Edge-managed Native Messaging. Only the
  extension whose ID matches the bridge's manifest can connect — that's why
  we pin the extension ID via `manifest.key`.
- **Bridge ↔ Copilot agent** uses the SDK's standard process model. Auth comes
  from the user's existing `copilot` login.
- **MCP servers** are loaded from `~/.copilot/mcp-config.json` — same as the
  CLI. AgentEdge does not introduce a new MCP config surface.
- **Playwright auto-attach token** is local-only. If present in
  `~/.agentedge/config.json`, the bridge logs `present (auto-attach enabled)`
  but never logs the value itself.
- **User content** (page text, selection, tab list) is sent only when the
  user explicitly invokes a mention or the agent calls a tool. There is no
  background scraping.

`onPermissionRequest: approveAll` is wired up: the bridge auto-approves every
SDK permission request because in this UI the implicit consent comes from
binding the Playwright tab. Revisit if AgentEdge ever ships outside developer
mode.

---

## 10. Lifecycle and cleanup

These are easy to get wrong; they are documented here so we don't lose them.

### Bridge

- `host.ts` listens for `disconnect` and calls `SessionManager.stop()`.
- `stop()` rejects all in-flight RPCs, clears the `creating` map (so just-
  resolved sessions don't attach to a dead client), disconnects every cached
  `CopilotSession`, and clears the `client` and `starting` refs.
- `sessions.ts` keeps the bound Playwright child until the user explicitly
  unbinds. Rebinding without unbinding does the right thing — it kills the
  prior child first.

### Extension

`disconnectedCallback`:

- Unsubscribes from `nativeBridge` message and disconnect events.
- Removes the global `keydown` listener.
- **Flushes** the pending `persistChats` debounce synchronously before
  clearing the timer, so a sidebar close in the 250 ms write window doesn't
  lose state.

### Tabs being deleted

`deleteChat`:

- Removes from `streamingIds` and `cancelledChats` (otherwise the cancel set
  leaks deleted ids forever).
- Sends `chat-delete` to the bridge, which disconnects that chat's session.
- Confirmation prompt to avoid Ctrl+Backspace mishaps.

---

## 11. Build, install, and runtime

### Setup script

`setup.ps1` is the one-shot install. It runs:

1. `npm ci` in both projects (or `npm install` if no lockfile).
2. `npm run build` in both projects.
3. The bridge ping smoke test (sends a `hello` frame, expects a `hello`
   reply).
4. Native Messaging host registration (writes the manifest to the registry).

`setup.ps1 -Uninstall` reverses steps 4. The user removes the unpacked
extension manually.

### Extension build

`vite build` produces `dist/sidebar.js` (~150 kB) plus `dist/background.js`
and `dist/sidebar.html`. Vite is configured to inline the entry HTML
references. The extension's `manifest.json` carries a stable RSA `key` so the
extension ID never drifts.

### Bridge build

Plain `tsc -p .`. Output goes to `bridge/dist/`. `launcher.cmd` is the entry
point referenced by the Native Messaging manifest; it just shells to `node`.

### Runtime layout

| Path                                          | Contents                                       |
| --------------------------------------------- | ---------------------------------------------- |
| `~/.agentedge/config.json`                    | Optional Playwright token, future settings     |
| `~/.agentedge/sessions/<chatId>/`             | Per-chat Copilot working directory             |
| `~/.agentedge/playwright-session.json`        | Persisted bound tab snapshot                   |
| `%LOCALAPPDATA%\AgentEdge\bridge.log`         | Append-only bridge log                         |
| `chrome.storage.local`                        | Extension state (chats, theme, prompts, debug) |

---

## 12. Things deliberately out of scope

- **Multiple browsers bound at once.** Tried; failed on UX grounds (see §7).
- **Cross-machine sync.** No cloud means no sync. Use the export-to-Markdown
  flow if you want to move a conversation.
- **Custom agent definitions.** AgentEdge ships one custom agent
  (`.github/agents/agentedge.agent.md`). The user can edit it, but there is
  no UI for managing multiple.
- **Telemetry.** None.
- **Public marketplace listing.** Not until the project graduates from
  developer-mode loading.
