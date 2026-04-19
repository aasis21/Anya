# AgentEdge — Design Document

> **One-liner:** GitHub Copilot CLI, reborn as a Microsoft Edge sidebar app — agentic AI that lives next to your tabs, can read and drive them, and can act on a whitelisted slice of your file system.

---

## 1. What AgentEdge is

AgentEdge is a **general-purpose agentic surface inside Microsoft Edge**.

It is the same `copilot` CLI you run in a terminal, presented as a persistent sidebar that:

- knows what page you are looking at without being told,
- can pull in any open tab, bookmark, selection, or page snapshot on request,
- can drive the real, logged-in browser (click, type, screenshot, extract),
- can read and write files inside folders you have explicitly whitelisted,
- inherits every MCP server and auth token your terminal `copilot` already has.

Anything you can express to Copilot CLI in words — investigate a page, scrape a table, summarise tabs, edit a file in a project, fill a form, file a bug, organise bookmarks, generate a Playwright script — is in scope on day one. AgentEdge does not ship features; it ships **capability**.

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Microsoft Edge (MV3 extension, sidePanel API)               │
│                                                              │
│  ┌─────────────────────────┐    ┌─────────────────────────┐  │
│  │  AgentEdge Sidebar      │    │  Your tabs / pages      │  │
│  │  (Lit + marked)         │    │                         │  │
│  │  ─────────────────────  │    │   github.com/foo/bar    │  │
│  │  > review this PR       │    │   dev.azure.com/...     │  │
│  │  ▍ Reading PR diff…     │    │   localhost:3000        │  │
│  │                         │    │                         │  │
│  │  ┌───────────────────┐  │    └─────────────────────────┘  │
│  │  │ chrome.tabs       │  │              ▲                  │
│  │  │ chrome.bookmarks  │  │              │ drives           │
│  │  │ chrome.scripting  │  │              │ (real Edge,      │
│  │  │ chrome.sidePanel  │  │              │  real logins)    │
│  │  └───────────────────┘  │    ┌─────────────────────────┐  │
│  │                         │    │ Playwright MCP Bridge   │  │
│  │  Native Messaging       │    │ extension (Microsoft)   │  │
│  └────────────┬────────────┘    └────────────┬────────────┘  │
└───────────────┼──────────────────────────────┼───────────────┘
                │ JSON frames                  │ localhost + token
                ▼                              │
┌─────────────────────────────────────────────────────────────┐
│  Local machine — AgentEdge Bridge (Node.js)                │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  bridge host                                         │   │
│  │                                                      │   │
│  │  • CopilotClient (one)                               │   │
│  │  • CopilotSession per sidebar thread                 │   │
│  │  • onPreToolUse → inject browser context             │   │
│  │  • Custom tools (defineTool):                        │   │
│  │      get_active_tab    list_tabs                     │   │
│  │      get_selection     get_tab_content               │   │
│  │      browser  ── shells out to ──┐                   │   │
│  └──────────────────────┬───────────┼───────────────────┘   │
│                         │           │                       │
│           @github/      │           ▼                       │
│           copilot-sdk   │   ┌──────────────────────────┐    │
│                         ▼   │  playwright-cli daemon   │────┘
│  ┌──────────────────────────┤  (@playwright/cli)       │
│  │  copilot CLI             │  • headed, persistent    │
│  │  (bundled @github/copilot)│ • attach --extension    │
│  │  + GitHub / MS Docs /    │  • driving user's Edge   │
│  │    ADO MCP servers       └──────────────────────────┘
│  │    (auto-loaded from                                │   │
│  │     ~/.copilot/mcp-config.json)                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### The four pieces

| # | Component | Tech | Purpose |
|---|---|---|---|
| 1 | **Sidebar UI** | Lit + `marked` | Chat input, streaming Markdown bubbles, status line, theme toggle, mention autocomplete |
| 2 | **Extension layer** | Chrome APIs (`tabs`, `bookmarks`, `scripting`, `sidePanel`, `nativeMessaging`) | Capture browser context, expose 4 lightweight context tools, mediate with bridge |
| 3 | **Bridge host** | Node.js + `@github/copilot-sdk` | One `CopilotClient`, one `CopilotSession` per sidebar thread; defines custom tools; shells out to `playwright-cli` for browser automation |
| 4 | **`copilot` CLI + `playwright-cli`** | bundled by SDK + `@playwright/cli` + Playwright MCP Bridge ext (Microsoft) | The actual agent + browser-driving capability. `playwright-cli attach --extension` connects to the user's **real Edge** (same tabs, same logins) |

The heavy lifting (model calls, browser automation, file system, MCP) is done by tools the user already has. AgentEdge is a thin shell that wires them to browser context.

### Why `@github/copilot-sdk`

The SDK is GitHub's official embedding API for Copilot, and its abstractions match AgentEdge's needs directly:

- **`onPermissionRequest(request)`** with `request.kind ∈ {shell, write, read, mcp, url, custom-tool, memory}` — exactly the categories we want for approval cards.
- **`assistant.message_delta`** events stream tokens, perfect for xterm.
- **One `CopilotClient` → many `CopilotSession`s** — one CLI process, multiple parallel conversations.
- **`onPreToolUse`** lets us inject browser context (active tab URL, page snapshot) into tool args before the agent acts.
- **`defineTool({...})`** registers custom tools; that is how `chrome.tabs`, `chrome.bookmarks`, etc. become first-class agent capabilities.
- **`useLoggedInUser: true`** (default) reuses the user's existing `copilot` login.
- **MCP servers** auto-load from `~/.copilot/mcp-config.json`.
- **CLI is bundled** as `@github/copilot` — installer ships everything in one shot.

## 3. Tab and session model

**Mental model: tabs are files, the sidebar is the chat panel.** Direct port of VS Code Copilot Chat.

| VS Code Copilot Chat | AgentEdge |
|---|---|
| Workspace (folder) | Edge window |
| Editor file | Browser tab |
| Active editor | Active tab |
| Selection | Highlighted text on page |
| Chat panel | Sidebar |
| Chat thread | Chat thread (one per sidebar, survives tab switches) |
| `+ New Chat` | `+ New Chat` |
| `#file` mention | `@tab` mention |
| `#selection` | `@selection` |
| Agent reads/edits N files in one turn | Agent reads/operates on N tabs in one turn |

### Rules

- **One sidebar = one chat panel = one `CopilotSession`** at a time.
- **Tab switches do not reset the thread.** The active tab is just a moving reference; the conversation persists.
- **`+ New Chat`** spins up a fresh `CopilotSession` and a fresh per-session working directory at `%LOCALAPPDATA%\AgentEdge\sessions\s-<ts>\`.
- **Chat history list** in the sidebar lets the user hop between past threads (persisted via `chrome.storage.local`).
- **Per-window scoping.** Each Edge window has its own sidebar; threads are scoped to the window. Different windows = different conversations. Same as VS Code workspaces.
- **All browser tools accept an optional `tabId`.** Default is the active tab. The agent can operate across multiple tabs in a single turn (just like reading multiple files in VS Code).
- **Closed tabs become unreachable to tools** but remain referenced in conversation history.

### Why not per-tab sessions

Per-tab threads were considered and rejected. They break the "ask about my open tabs collectively" workflow, force the user to babysit which thread belongs to which tab, and create dead conversations every time a tab closes. The notebook-style sidebar mirrors how the user already thinks about Copilot in VS Code.

## 4. Approval model

Every action the agent takes falls into one of these categories:

| Category | Examples |
|---|---|
| **Read** | Page snapshot, screenshot, FS read inside whitelist, read-only eval, GET requests |
| **FS write** | Create / modify / delete files inside the whitelist |
| **Shell** | `npm install`, `git`, `rm`, `mv`, build commands |
| **Browser write** | Form submit, click on a tagged destructive element, navigation away from a dirty form |
| **Network write** | POST / PUT / DELETE from a generated script |

By default, **reads are auto-approved** and every other category prompts the user before executing. The agent renders an inline approval card in the sidebar showing exactly what it is about to do; the user clicks **Approve** / **Deny** / **Always-approve-this-kind**.

### Auto-approve toggles

The settings panel has one checkbox per category to skip the prompt for that category:

```
[ ] Auto-approve FS writes inside whitelisted folders
[ ] Auto-approve shell commands
[ ] Auto-approve browser writes
[ ] Auto-approve network writes
```

Any toggle that is on shows up as a small chip in the sidebar header (`auto: shell, fs`) so the elevated trust is always visible. Toggles **reset on browser restart** — auto-approval is sticky-session-only, never the persisted default.

A "🔥 Auto-approve all" master toggle exists for short bursts of unattended work; flipping it on shows a red banner until it is flipped off or the session ends.

## 5. Browser context

Three layers of context delivery.

### Implicit (always sent with every prompt)
- Active tab URL
- Active tab title
- Active tab `<meta>` tags (description, `og:*`)
- A short structured snapshot (title + h1/h2/h3 only, ~500 tokens)

### Explicit `@`-mentions in the input box

| Mention | Expands to |
|---|---|
| `@page` | Full page text content of active tab (Readability-extracted, truncated at ~3k tokens) |
| `@tab:<idx>` | Same, but for a specific tab from `@tabs` list |
| `@selection` | Currently selected text on the active tab |
| `@tabs` | All open tab URLs + titles (numbered) |
| `@bookmarks` | Bookmark tree (folder structure + URLs) — *v2+* |
| `@history` | Last N visited URLs — *v2+* |
| `@cookies` | Cookies for current domain — *v2+* |

### Standing capabilities (always available to the agent)

#### AgentEdge-native tools (defined in the bridge, backed by the extension)

These four tools are the unique contribution of AgentEdge — fast, sidebar-native, no MCP roundtrip:

| Tool | Signature | Returns |
|---|---|---|
| `get_active_tab` | `()` | `{tabId, url, title, favIconUrl}` |
| `list_tabs` | `(windowId?)` | `[{tabId, url, title}]` |
| `get_selection` | `(tabId?)` | `{text, tabId}` |
| `get_tab_content` | `(tabId?)` | `{markdown, url, title}` (Readability extraction) |

`tabId?` always defaults to the active tab. Uses Chrome's `chrome.tabs.Tab.id` (numeric, in-session only).

#### Browser automation — `playwright-cli`

A single bridge tool, `browser`, shells out to `playwright-cli` (which runs as a persistent daemon). Playwright is **attached to the user's real Edge** via `playwright-cli attach --extension` and the **Playwright MCP Bridge extension** (Microsoft, installed once by the user). All snapshot, click, fill, type, navigate, screenshot, eval, network and storage commands are reachable through that one tool.

```ts
defineTool({
  name: 'browser',
  description: 'Drive the user\'s Edge via playwright-cli. See `browser install --skills`.',
  parameters: { argv: z.array(z.string()) },
  run: async ({ argv }) => exec('playwright-cli', argv, { cwd: sessionDir })
})
```

**Why `playwright-cli`, not Playwright MCP:** the official docs identify CLI as the right shape for "coding agents working with Copilot CLI" — concise output, skills loaded on demand, daemon-backed, lower token cost than MCP's tool-schema-per-turn overhead. Both options support `attach --extension`; the CLI is simply better fit for our context budget. Captured in §13 open questions if we ever need to switch.

#### Other capabilities

- **FS read/write** — scoped to whitelisted folders (bridge enforces via SDK's `onPermissionRequest`).
- **Shell** — for builds, installs, git, etc. (denied by default; user enables in settings).
- **Any MCP server** the user already has configured for `copilot` (Microsoft Docs, GitHub, ADO, etc.). Auto-loaded from `~/.copilot/mcp-config.json`.

## 6. The whitelist

A list of absolute folder paths the agent is allowed to read and write. **Enforcement happens at the SDK's permission callback** in the bridge, which is the only chokepoint that all FS access flows through.

### Configuration
Two synced surfaces:
- **Sidebar settings panel** — visual editor (add / remove folders, enable / disable each).
- **`whitelist.json`** at `%APPDATA%\AgentEdge\whitelist.json` — what the bridge reads.

The settings UI writes the JSON; the bridge watches it for changes.

### Enforcement
- Every `write` / `read` permission request from the SDK carries `request.fileName`.
- bridge resolves the absolute path and checks it against the whitelist.
- Outside the whitelist → auto-denied; surfaced as "blocked by whitelist" in the sidebar.
- Inside the whitelist → goes through the normal approval flow (auto-approved if FS auto-toggle is on, else prompts the user).
- `cd` cannot escape because the check is on the resolved absolute path.

### Default
Empty. Folders must be added explicitly.

## 7. Auth

Zero setup beyond what the user already has.

| Service | Source |
|---|---|
| Copilot subscription | `useLoggedInUser: true` (SDK default) — uses existing `copilot` CLI login |
| GitHub API | `gh auth` token |
| Browser sessions | Live Edge cookies via `playwright-cli attach --extension` (real user profile) |
| MCP servers | Existing user-level `~/.copilot/mcp-config.json` (auto-loaded by SDK) |

The bridge runs the SDK as the user, so all existing auth flows just work. No tokens are stored in the extension or bridge config; no third-party API key fields exist in settings.

## 8. UI

- **Edge MV3 extension using the `sidePanel` API** — vertical sidebar, persistent within a window.
- **Lit** for components — small bundle, web-standards, fast Edge Add-ons review.
- **`marked`** renders Markdown bubbles (headings, lists, fenced code blocks). Both dark and light palettes are first-class; the only hardcoded colors are CSS variables (`--strong`, `--code-bg`, `--code-fg`, etc.) defined in both themes.
- **One textarea input** at the bottom with a `›` sigil and `SEND ↵` button (disabled until input is non-empty). `@`-mention autocomplete planned.
- **Header** shows `VER`/`PID`/`LIVE` status line and a `☀ LIGHT` / `☾ DARK` theme toggle (persisted via `chrome.storage.local`).
- **Empty state** is invitational (`what's on your mind?`); chat history flows above the input.
- **Edge titlebar** — `manifest.default_title: "AgentEdge"` is the brand surface (Edge owns it; we don't restyle).
- **Inline approval cards** above the input when the agent is waiting on a permission. *(Deferred — auto-allow during build-out; see §12.)*
- **Stop button** sends a cancel signal to the active `CopilotSession`.

The mental model matches VS Code Copilot Chat — same `@`-mention vocabulary, same back-and-forth rhythm. The differences: real Markdown bubbles instead of an editor diff, and context that automatically follows the active tab.

## 9. v1 scope (MVP)

**Phase 1 — Walking skeleton (✅ complete)**
- Edge MV3 extension with `sidePanel` API (Lit shell, `marked` Markdown bubbles).
- Bridge host (Node.js) using `@github/copilot-sdk`; one `CopilotClient`, one `CopilotSession`.
- Native Messaging between extension and bridge (4-byte LE length-prefixed JSON frames; structured event model).
- Streaming `assistant.message_delta` chunks rendered as Markdown bubbles.
- Per-session working dir at `%LOCALAPPDATA%\AgentEdge\sessions\s-<ts>\`.
- Dark/light theme with persistence; clean status line (`VER`, `PID`, `LIVE`).

**Phase 2 — Browser context and automation (next)**
- Implicit context: active tab URL + title prefixed to every prompt.
- 4 AgentEdge-native tools: `get_active_tab`, `list_tabs`, `get_selection`, `get_tab_content` via `defineTool`.
- `@page`, `@selection`, `@tabs`, `@tab:<idx>` mention parser in sidebar input.
- `playwright-cli` integration: bridge `browser` tool shells out to the daemon; user installs Playwright MCP Bridge ext + runs `playwright-cli attach --extension` once.
- Tabs-as-files session model: thread persists across tab switches; `+ New Chat` button.
- Auto-allow all tool categories during this phase (approval UI deferred).

**Phase 3 — Trust, whitelist, polish**
- Inline approval cards for `write` / `shell` / `mcp` / `url` permission kinds.
- Per-category auto-approve toggles (sticky-session-only) + master "auto-approve all" with red banner.
- Whitelist settings panel + JSON sync + bridge enforcement (auto-deny FS outside whitelist).
- Shell **denied by default**; toggle in settings to enable.
- Auto-follows Edge dark/light theme (currently a manual toggle).

Everything else (full `@`-mention vocabulary including `@bookmarks`/`@history`/`@cookies`, saved skill snippets, multi-window thread sync, history panel, per-folder read-vs-write granularity, BYOM, telemetry) is v2+.

## 10. Security & trust

| Risk | Mitigation |
|---|---|
| Agent writes outside intended folder | Whitelist auto-denies FS writes outside it via SDK's `onPermissionRequest`; default empty |
| Agent runs `rm -rf /` | `shell` is denied by default; user must enable; auto-approve is sticky-session-only with header chips |
| Agent leaks page content to third parties | Only the user's existing Copilot backend is called; no third-party API key fields |
| Hostile page tricks the agent | Page text is delivered as content, never auto-executed; shell/write goes through approval gate |
| Native Messaging abuse from another extension | Native Messaging manifest restricts `allowed_origins` to AgentEdge's extension ID only |
| Auto-approve left on by accident | All toggles reset on browser restart; header chips visible during session; master toggle shows red banner |
| SDK breaking changes (preview status) | bridge isolates the SDK behind a small interface; swap to a different agent backend later means rewriting one file |

## 11. Edge Add-ons store

Publishing requires:
- Privacy policy (no data leaves the user's machine except via their own GitHub Copilot subscription).
- Justification for each `permissions:` entry in the store listing.
- Disclosure of the bridge (the extension cannot install it; ship a separate signed `agentedge-install.exe` that drops the bridge binary, the Native Messaging manifest, and the HKCU registry entry pointing Edge at it).

**Permissions to declare:**
```json
{
  "permissions": [
    "sidePanel",
    "nativeMessaging",
    "tabs",
    "activeTab",
    "bookmarks",
    "history",
    "storage"
  ],
  "host_permissions": ["<all_urls>"],
  "key": "<stable extension public key — pinned so the ID does not drift>"
}
```

**Windows install notes:**
- Native Messaging manifest installed under `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\<host_name>` (no admin required).
- The manifest's `path` must point to a launcher (`.cmd` or `.exe`); it cannot directly invoke `node host.js`.
- `allowed_origins` in the manifest must list the extension ID only.
- bridge logs to **stderr only** — stdout is owned by the Native Messaging protocol.

## 12. Implementation milestones

**Phase 1 — walking skeleton (✅ complete)**
1. **M1 — Hello sidebar.** Edge MV3 extension with `sidePanel`, Lit + Markdown shell, stable extension ID via manifest `key`. ✅
2. **M2 — Bridge handshake.** Node.js bridge registered as Native Messaging host (HKCU + `.cmd` launcher). Sidebar ↔ bridge JSON frames. ✅
3. **M3 — SDK one-shot.** Bridge wires `@github/copilot-sdk`: `CopilotClient.start()` → `createSession()` → `send({prompt})` → stream `assistant.message_delta` to sidebar. ✅
4. **M3.5 — UI polish.** Markdown bubbles, dark/light theme toggle with persistence, clean status line, invitational empty state. ✅

**Phase 2 — browser context and automation (next)**
5. **M4 — AgentEdge-native tools.** `defineTool` for `get_active_tab`, `list_tabs`, `get_selection`, `get_tab_content`. Bridge ↔ extension RPC channel for chrome.tabs / chrome.scripting calls.
6. **M5 — Implicit context.** Active tab URL/title prefixed to every prompt via `onPreToolUse` or system prompt prefix.
7. **M6 — Mention parser.** `@page`, `@selection`, `@tabs`, `@tab:<idx>` autocomplete and expansion in sidebar input.
8. **M7 — `playwright-cli` integration.** User installs Playwright MCP Bridge ext + `npm i -g @playwright/cli`. Bridge `browser` tool shells out via `playwright-cli attach --extension`. Smoke test: "summarize this PR and post a comment" end-to-end.
9. **M8 — Session model.** `+ New Chat` button, thread persistence in `chrome.storage.local`, history list, per-thread `CopilotSession`.

**Phase 3 — trust, install, ship**
10. **M9 — Whitelist.** Settings panel + JSON config + bridge's `onPermissionRequest` auto-denies FS outside whitelist.
11. **M10 — Approval flow.** Inline approval cards for `write` / `shell` / `mcp` / `url` permission kinds; per-category auto-approve toggles; master toggle with red banner.
12. **M11 — Installer.** One-click signed installer that drops the bridge binary, Native Messaging manifest, HKCU entry, and prompts to install Playwright MCP Bridge ext + `@playwright/cli`.
13. **M12 — Edge Add-ons submission.** Privacy policy, store listing, screenshots, internal review.

## 13. Open questions

- **Multi-window Edge:** the bridge is per-install but may be invoked by multiple sidebar instances. Plan: one `CopilotSession` per sidebar instance, multiplexed over a single `CopilotClient`. Validated at M2; revisit at M8 when threads persist.
- **`browser` tool shape:** expose as a single shell-passthrough (`browser <argv...>`) or as N explicit `defineTool`s mirroring CLI commands? Single passthrough wins on token cost (one schema vs ~50) but loses LLM-friendly per-command parameter docs. Decision deferred to M7; start with passthrough.
- **Skill discovery:** `playwright-cli install --skills` exposes capability files. Should the bridge auto-run that on first launch, or surface a settings toggle? Decision at M7.
- **MCP Bridge pairing UX:** the Playwright MCP Bridge extension requires a one-time token pairing with `playwright-cli`. Document in setup, or detect-and-prompt from the sidebar?
- **Headed vs headless default:** `playwright-cli` defaults to headless. With `attach --extension` it's irrelevant (it's the user's already-running Edge). Confirm at M7.
- **Telemetry:** the SDK exposes `telemetry: { otlpEndpoint, ... }`. v2 question: minimum honest disclosure?
- **Subscription detection:** how do we surface "you do not have a Copilot subscription" gracefully on first launch? SDK's `client.start()` failure mode TBD.

---

*Last updated: see git history.*
