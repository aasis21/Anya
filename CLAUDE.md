# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build commands

```bash
# Extension (Chromium MV3 sidebar)
cd extension && npm install && npm run build   # vite build → extension/dist/
cd extension && npm run dev                    # watch mode

# Bridge (Node Native Messaging host)
cd bridge && npm install && npm run build      # tsc → bridge/dist/
cd bridge && npm test                          # ping smoke test

# Type-check without emitting
cd extension && npx tsc --noEmit
cd bridge    && npx tsc --noEmit

# Full install + register NM host
pwsh ./setup.ps1      # Windows
./setup.sh            # macOS / Linux
```

After changing extension code: rebuild, then click **Reload** on the extension card in the browser.
After changing bridge code: rebuild — the next reconnect picks up the new `bridge/dist/host.js`.

## Architecture

Anya has two packages that communicate over Chrome's Native Messaging (length-prefixed JSON):

```
extension/  ←──── NM frames ────→  bridge/
(Lit UI)                           (Node + @github/copilot-sdk)
```

**Extension** (`extension/src/`):
- `main.ts` — single `<anya-app>` Lit component. Owns all UI state, the chat store (`chrome.storage.local`), the frame handler, tool-RPC callbacks, mention expansion, and slash commands. Section banners mark logical groupings.
- `background.ts` — service worker: side panel registration, context menu.
- `page-bridge.ts` — content script: DOM capture, selection tracking, AI field fill.
- `native-bridge.ts` — `chrome.runtime.connectNative` wrapper with auto-reconnect.
- `styles.ts` — all CSS in one tagged template. Keep it sectioned, no separate CSS files.
- `types.ts` — shared interfaces (`ContextAttachment`, `ChatMessage`, `Chat`, `DebugEntry`, etc.).

**Bridge** (`bridge/src/`):
- `host.ts` — NM stdio loop and frame router. Add new frame types here.
- `copilot-bridge.ts` — `SessionManager`: one `CopilotClient` shared across all chats; one `CopilotSession` per chat id, lazily created and cached.
- `tools.ts` — all tool definitions via `defineTool()`. Two families: context tools (RPC to extension for `chrome.*` APIs) and Playwright tools (CDP connection + `drive_*` commands).
- `tool-rpc.ts` — correlates `tool-request` / `tool-result` frames between bridge and extension; 30 s timeout.
- `sessions.ts` — CDP-only Playwright session manager: `connectBrowser`, `disconnectBrowser`, `runPlaywrightCmd`.
- `paths.ts` — cross-platform data-dir resolver. Always use this; never hardcode `%LOCALAPPDATA%` or OS paths.
- `config.ts` — loads `~/.anya/config.json`.

## Wire protocol (key frame types)

Extension → bridge: `hello`, `prompt { chatId, text }`, `chat-delete { chatId }`, `tool-result { requestId, ok, result?, error? }`, `stop { chatId }`, `folder-pick`, `tool-config`, `set-model`, `set-auto-approve`, `permission-response`, `list-models`

Bridge → extension: `hello`, `delta { chatId, text }`, `done { chatId }`, `error { chatId, message }`, `tool-start`, `tool-progress`, `tool-complete`, `tool-request { requestId, name, args }`, `log`

## Important conventions

- **TypeScript everywhere.** Bridge is ESM (`"type":"module"`); extension is also ESM via Vite.
- **CDP only** for Playwright. Extension mode and multi-tab binding were deliberately abandoned (see `design.md` §7).
- **Tool flavours**: bridge-resident tools run in Node; four context tools (`get_active_tab`, `list_tabs`, `get_selection`, `get_tab_content`) use the RPC round-trip to reach `chrome.*` APIs.
- **Mentions expand before the prompt is sent** — `expandMentions()` in `main.ts` inlines `@tab`, `@selection`, `@url`, etc. as Markdown. Tool calls are for actions; mentions are for context.
- **`persistChats` is debounced 250 ms** but flushed synchronously in `disconnectedCallback`. Don't add `await`s inside the flush path.
- **`creating` map in `SessionManager`** deduplicates concurrent `getOrCreateChat` calls. Preserve this — double-create on a brand-new chat is a real race.
- **All spawned processes** must have `cwd` pinned to the Anya data dir (via `paths.ts`) so junk doesn't land in `bridge/`.
- **No telemetry, no cloud sync.** Don't introduce either.

## Runtime state locations

| Path | Purpose |
|------|---------|
| `%LOCALAPPDATA%\Anya\bridge.log` | Append-only bridge trace |
| `~/.anya/sessions/<chatId>/` | Per-chat Copilot working directory |
| `chrome.storage.local` keys: `anya-chats`, `anya-current-chat`, `anya-theme` | Extension state |

The debug panel in the sidebar mirrors every NM frame and log line — this is the canonical debugging tool.

## What not to do

- Don't hardcode OS-specific paths — use `bridge/src/paths.ts`.
- Don't reintroduce extension mode or multi-tab binding in `sessions.ts` — CDP only.
- Don't commit `extension/.extension-key.pem` (gitignored).
- Don't add telemetry, analytics, or cloud sync.
- Don't put unrelated files in `bridge/` — pin `cwd` so output lands in the Anya data dir.
