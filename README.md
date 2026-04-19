# Anya

> github copilot for your browser. powered by the copilot sdk.

Anya is an MV3 sidebar extension for any Chromium-based browser — Edge, Chrome,
Chromium, Brave, Vivaldi — that talks to a local Node bridge wrapping
[`@github/copilot-sdk`]. The result is the same agentic Copilot you run in your
terminal — streaming output, tool calls, MCP servers — sitting next to your
tabs, with a side helping of browser automation via Playwright.

```
┌────────────────────┐    JSON frames    ┌────────────────────┐
│  Browser sidebar   │ ◀─────────────▶   │  Node bridge       │
│  (Lit + marked)    │  Native Messaging │  @github/copilot-  │
│                    │                   │  sdk + tools       │
└────────────────────┘                   └────────────────────┘
        │                                          │
        │ chrome.tabs / scripting                  │ shells out to
        ▼                                          ▼
   browser context                          playwright-cli
```

---

## What you get

- **Real Copilot, real streaming.** The bridge owns one `CopilotClient` and one
  `CopilotSession` per chat thread, so messages stream token-by-token with
  proper tool-call lifecycle events.
- **Multi-chat with persistence.** Drawer of chats, each with its own
  bridge-side session. Pin, tag, search, rename, delete, export to Markdown.
  Survives restarts via `chrome.storage.local`.
- **Browser context as first-class input.** The composer speaks three
  languages — `/` for client commands, `@` for ambient browser context,
  `#` (planned) for named references. See [Composer language](#composer-language).
- **Playwright automation built in.** A `drive_tab` tool shells out to
  `playwright-cli` so the agent can drive your real, logged-in browser — click,
  type, screenshot, extract — with the same auth your tabs already have.
- **Inline tool cards.** Every tool call renders as a VS Code-style card with
  args, progress, and result preview. Click to expand.
- **Live debug panel.** A 🐛 button opens a trace of every Native Messaging
  frame and bridge log line. Click any row to see the full payload.
- **Hotkeys, slash commands.** Ctrl+B/N/K/L/. and Ctrl+1..9, plus `/help`,
  `/pin`, `/stop`, `/tag`, `/clear`, `/export`, `/quick`.

See [`design.md`](./design.md) for the full architecture.

---

## Repo layout

```
Anya/                              # repo dir name is still "AgentEdge" on disk
├── README.md
├── design.md                     # full design spec
├── setup.ps1                     # one-shot install/build/test/register
├── extension/                    # Chromium MV3 extension (Lit + Vite)
│   ├── manifest.json
│   ├── sidebar.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.ts               # the <anya-app> Lit component
│       ├── styles.ts             # extracted CSS for the sidebar
│       ├── types.ts              # Chat / ChatMessage / ToolCall / ...
│       ├── native-bridge.ts      # chrome.runtime.connectNative wrapper
│       └── background.ts         # opens the side panel on action click
└── bridge/                       # Node Native Messaging host
    ├── manifest.template.json
    ├── launcher.cmd
    ├── install.ps1               # multi-Chromium HKCU registration
    ├── uninstall.ps1
    └── src/
        ├── host.ts               # NM stdio loop + frame router
        ├── copilot-bridge.ts     # SessionManager (one Copilot session per chat)
        ├── sessions.ts           # single-bound Playwright tab + polling
        ├── tools.ts              # context tools + browser tool definitions
        ├── tool-rpc.ts           # bridge → extension tool RPC
        ├── native-messaging.ts   # length-prefixed JSON framing
        ├── config.ts             # ~/.anya/config.json loader
        └── log.ts                # bridge.log + debug-mirror sink
```

`AGENTS.md` at the repo root onboards any AI agent (Copilot CLI, Cursor,
etc.) working **on** the codebase. Anya's own system prompt is
`.github/agents/anya.agent.md` — a Copilot CLI
[custom-agent profile](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli)
loaded by `bridge/src/copilot-bridge.ts`.

---

## Install

### Requirements

- **Windows** with PowerShell 5.1+ (the install scripts are PowerShell; the
  rest of the codebase is OS-agnostic but the Native Messaging registration
  layer is Windows-only today).
- **Node 20+** (`node -v`)
- **A Chromium-based browser** with developer-mode extensions enabled. Anya is
  installed and tested in: **Microsoft Edge, Google Chrome, Chromium, Brave,
  Vivaldi**. Any other Chromium-based browser that registers under
  `HKCU:\Software\<vendor>\<browser>\NativeMessagingHosts\` should also work
  — pass the registry root via a one-line tweak to `install.ps1`.
- A logged-in **Copilot CLI** (`copilot auth status`)
- _Optional, for browser automation:_ `npm i -g @playwright/cli` and the
  Playwright MCP Bridge extension in your browser.

### One-shot setup (recommended)

```pwsh
.\setup.ps1
```

This runs `npm install` + `npm run build` for both projects, the bridge ping
smoke test, then registers the Native Messaging host **for every Chromium
browser detected on the machine** and prints the per-browser load
instructions. If multiple browsers are present you'll get an interactive
picker.

| Switch              | Effect                                                              |
| ------------------- | ------------------------------------------------------------------- |
| `-Browsers edge`    | Register only for the named browser(s). Valid: `edge`, `chrome`, `chromium`, `brave`, `vivaldi`, `all`. |
| `-Quiet`            | Skip the interactive picker; install for everything detected.       |
| `-SkipTest`         | Skip the bridge ping/pong smoke test.                               |
| `-Uninstall`        | Remove the registry entries + manifest from every Chromium browser (and clean up legacy `com.agentedge.bridge` entries from earlier versions). |

### Load the extension in each browser

Once the bridge is registered you need to load the unpacked extension in each
browser you plan to use Anya in. The manifest pins a deterministic extension
ID (`oopdnihjfloclgnbbkebgeiipfadebid`) via its `key` field, so the same ID
is granted Native Messaging access in every browser.

| Browser   | Extensions URL          |
| --------- | ----------------------- |
| Edge      | `edge://extensions`     |
| Chrome    | `chrome://extensions`   |
| Brave     | `brave://extensions`    |
| Vivaldi   | `vivaldi://extensions`  |
| Chromium  | `chrome://extensions`   |

In each:

1. Toggle **Developer mode**.
2. **Load unpacked** → pick `extension/dist/`.
3. Confirm the extension ID matches `oopdnihjfloclgnbbkebgeiipfadebid`.
4. Pin the action icon → click it → sidebar opens.

### Smoke test

- Type `ping` → should answer `PONG`. This validates the bridge handshake
  without involving the Copilot SDK.
- Type a real prompt → streamed response with inline tool cards.


---

## Using the sidebar

### Header

| Icon  | Action                                                       |
| ----- | ------------------------------------------------------------ |
| ☰     | Toggle the chat drawer (`Ctrl+B`)                            |
| ⌕     | Open chat search (`Ctrl+K`)                                  |
| 🐛    | Toggle the bridge debug panel                                |
| ☀ / ☾ | Toggle light / dark theme (persisted)                        |

### Chat drawer

- **`＋`** — new chat (`Ctrl+N`)
- **`★ / ☆`** — pin / unpin (pinned chats float to the top)
- **`✎`** — rename
- **`⬇`** — export to Markdown
- **`×`** — delete (asks for confirmation)
- **Tag chips** — click to filter; click _all_ to clear
- **Per-row stats** — `N msg · ~T tok · age` (relative time)

### Composer language

The textarea recognises three prefixes. Each has a distinct, non-overlapping
purpose so the composer never feels ambiguous:

| Prefix | Purpose | Mental model | Sent to model? |
| ------ | ------- | ------------ | -------------- |
| `/`    | **Commands to the client** — chat lifecycle, UI state, search | "Do something to the sidebar." | No — intercepted |
| `@`    | **Ambient browser context** — the *here, now* state | "Look at what I'm looking at." | Yes — expanded inline |
| `#`    | **Named, curated references** (planned) — bookmarks, files, chats by name | "Look up the thing I labelled X." | Yes — would expand inline |

**Why three?** They map to three different cognitive moves the user makes:
*manage their workspace* (`/`), *point at what's on screen right now* (`@`),
and *cite something they curated earlier* (`#`). Lumping them together is
what makes other chat UIs feel mushy.

**Design principles:**

1. **`/` never reaches the model.** Client-only — keeps the prompt
   transcript clean and lets us add UI ops without bloating context.
2. **`@` is for now-state.** Anything that depends on what the browser
   is currently showing (active tab, selection, open tabs, clipboard).
   Expanded **before** the bridge sees the prompt, so the model gets
   real content and never needs a tool round-trip for these.
3. **`#` is for named lookups.** Reserved for things you address by
   name (bookmark titles, folders, file paths, prior chats). Not yet
   implemented — see the `#` subsection below.
4. **Ergonomics over completeness.** A token only earns its place if a
   tool call is too high-friction for the same job. Things the model
   can fetch on its own (most web search, ad-hoc URLs) intentionally
   don't get a prefix.

#### `/` — slash commands

Client-side only. Never sent to the model.

| Command                  | Action                                                  |
| ------------------------ | ------------------------------------------------------- |
| `/new`                   | Start a fresh chat (`Ctrl+N`)                           |
| `/clear`                 | Wipe the current chat (`Ctrl+L`)                        |
| `/rename [title]`        | Rename current chat (no arg → inline edit)              |
| `/delete`                | Delete current chat                                     |
| `/pin`                   | Toggle pin for the current chat                         |
| `/tag add\|rm <name>`    | Add or remove a tag                                     |
| `/tag list`              | List tags on the current chat                           |
| `/search [query]`        | Open chat search, optionally pre-filled (`Ctrl+K`)      |
| `/export`                | Download the current chat as Markdown                   |
| `/stop`                  | Cancel the in-flight stream (`Ctrl+.`)                  |
| `/help`                  | Print this list inside the chat                         |

#### `@` — ambient browser context

Expanded inline by the extension *before* the prompt is sent. The model
sees the resolved content, not the literal `@token`. Restricted URLs
and empty results return a friendly placeholder so the prompt always
goes through.

| Token                  | Resolves to                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| `@tab`                 | Active tab's content as Markdown (Readability), capped at ~30 KB            |
| `@selection`           | Highlighted text on the active tab, blockquoted                             |
| `@url`                 | Active tab URL only                                                         |
| `@title`               | Active tab title only                                                       |
| `@clipboard`           | System clipboard text in a code fence                                       |
| `@tabs`                | Markdown table of every open tab — id, active flag, title, url              |
| `@tab:<id\|query>`     | One specific tab — numeric chrome id OR substring of title/url (top hit; multi-match note included) |

**Plus**: paste an image into the composer (`Ctrl+V`) to attach it as a
proper SDK vision blob. Up to 3 MB total per turn.

#### `#` — named references (planned)

Reserved namespace. Bookmark search, file lookup, and similar named
references will land here once we have autocomplete plus at least two
named-thing kinds to justify the dedicated prefix.

### Hotkeys

| Key            | Action                                          |
| -------------- | ----------------------------------------------- |
| `Ctrl+B`       | Toggle chat drawer                              |
| `Ctrl+N`       | New chat                                        |
| `Ctrl+K`       | Search chats                                    |
| `Ctrl+L`       | Clear current chat                              |
| `Ctrl+.`       | Cancel in-flight stream                         |
| `Ctrl+1..9`    | Switch to the Nth chat in drawer order          |
| `Ctrl+/`       | Cycle through quick-prompt templates            |
| `Esc`          | Close drawer / search / debug                   |

### Per-message actions

Hover any message and click `⋯` to copy, delete, or (on user messages) re-send
the same prompt as a fresh turn.

### Stop generating

While a response is streaming, the **send** button becomes a red **stop**
button. Pressing it (or `Ctrl+.`) flips a soft-cancel flag that ignores any
remaining deltas. Note: the bridge keeps streaming on its end — the SDK does
not yet expose `abort()` — so we just stop painting.

---

## Browser automation (Playwright)

Anya can drive your real, logged-in Edge browser. The flow:

1. Sidebar shows a "BOUND TAB" strip in the footer with status.
2. Click **bind** → bridge spawns `playwright-cli attach --extension=msedge`.
3. The Playwright MCP Bridge extension shows a **Connect?** dialog. Accept it.
4. Now the agent's `browser` tool drives _that_ tab.
5. Click **unbind** to release.

Only one tab is bound at a time by design — keeps the model's mental model
simple ("there is one browser") and means tool calls don't need a session
selector.

### Skip the connect dialog (optional)

Each accept produces a token. To auto-attach next time:

1. Trigger the dialog once and copy the long token from
   `PLAYWRIGHT_MCP_EXTENSION_TOKEN=…` shown in the panel.
2. Paste it into `~/.anya/config.json`:
   ```json
   { "playwrightExtensionToken": "<paste-here>" }
   ```
3. Reload the extension. The 🐛 panel will log `playwright extension token:
   present (auto-attach enabled)`.

The token is a local secret. Treat it like an SSH key. Setting
`$env:PLAYWRIGHT_MCP_EXTENSION_TOKEN` overrides the config file.

---

## Debug panel

Click 🐛 in the header for a live trace of every Native Messaging frame and
every `log()` line from the bridge. Click any row to expand its JSON. The
bridge log file path is shown at the top — click to copy. From DevTools:
`anya.debug()`.

For terminal tailing:

```pwsh
.\scripts\tail-bridge-log.ps1
```

---

## Development

```pwsh
cd extension && npm run dev      # Vite watches src/
cd bridge    && npm run build    # tsc; rerun after .ts changes
```

Logs go to `%LOCALAPPDATA%\Anya\bridge.log` (also live in the 🐛 panel).

The extension keypair lives at `.extension-key.pem` (gitignored). Its public
key is baked into `extension/manifest.json` so the extension ID stays stable
across reloads — that matters because the bridge's Native Messaging manifest
whitelists exactly that ID.

### File-by-file

**Extension (`extension/src/`):**

- `main.ts` — `<anya-app>` Lit component. Owns all UI state, the chat
  store, the frame handler, the tool RPC, and the render tree.
- `styles.ts` — extracted CSS (one big `css` tagged template).
- `types.ts` — `Chat`, `ChatMessage`, `ToolCall`, `BoundTab`, `QuickPrompt`,
  `DebugEntry`, `DEFAULT_QUICK_PROMPTS`, `DEBUG_MAX_ENTRIES`.
- `native-bridge.ts` — wraps `chrome.runtime.connectNative` with auto-reconnect
  and a small pub-sub for incoming frames.
- `background.ts` — opens the side panel on the action click.

**Bridge (`bridge/src/`):**

- `host.ts` — Native Messaging stdio loop. Routes incoming frames to the
  `SessionManager` or directly to tool/RPC handlers.
- `copilot-bridge.ts` — `SessionManager`. One `CopilotClient` shared, one
  `CopilotSession` per chat id, lazy-created and cached.
- `sessions.ts` — single-bound Playwright tab. Spawns `playwright-cli attach`,
  polls via `playwright-cli list`, persists state to disk.
- `tools.ts` — defines context tools (`get_active_tab`, `list_tabs`,
  `get_selection`, `get_tab_content`) and the `browser` tool that shells out
  to `playwright-cli`.
- `tool-rpc.ts` — request/response correlation for bridge → extension tool
  calls (where the bridge needs `chrome.*` data).
- `config.ts` — loads `~/.anya/config.json`.
- `log.ts` — appends to `bridge.log` and mirrors to the debug panel.

---

## Uninstall

```pwsh
.\setup.ps1 -Uninstall
```

Then remove the unpacked extension from `edge://extensions`.

[`@github/copilot-sdk`]: https://www.npmjs.com/package/@github/copilot-sdk
