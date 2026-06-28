# Copilot instructions for Anya

Anya is a Chromium MV3 **sidebar extension** that wraps
[`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk) via a
local Node **Native Messaging bridge**. The bridge shells out to `playwright-cli`
to drive the user's real, logged-in browser over CDP. There is no cloud
component — everything runs locally.

Two packages talk over Chrome Native Messaging (length-prefixed JSON frames):

```
extension/  ←──── NM frames ────→  bridge/
(Lit + Vite UI)                    (Node + @github/copilot-sdk, ESM)
```

## Build, type-check, test

```powershell
# Extension (Chromium MV3 sidebar) — output in extension/dist/
cd extension; npm install; npm run build      # vite build (prebuild generates icons)
cd extension; npm run dev                      # vite build --watch
cd extension; npx tsc --noEmit                 # type-check only

# Bridge (Node Native Messaging host) — output in bridge/dist/
cd bridge; npm install; npx tsc -p .           # or: npm run build
cd bridge; npm test                            # ping/pong smoke test — REQUIRES a build first
cd bridge; npx tsc --noEmit                    # type-check only

# Full install + register the Native Messaging host with every Chromium browser
pwsh ./setup.ps1      # Windows / macOS / Linux (PowerShell 7+)
./setup.sh            # macOS / Linux (bash)
```

There is no unit-test framework — `bridge` ships a single ping/pong smoke test
(`bridge/test/ping-test.mjs`) that spawns `bridge/dist/host.js`, so build before
running it. The extension has no test suite; verify changes by building and
reloading.

## The dev loop — rebuild, then reload (do this without being asked)

This is the single most common source of friction. After editing code, the
build is **not** optional — the user is running the loaded `dist/`:

- **Changed `extension/src/`** → run `cd extension; npm run build` **and**
  `npx tsc --noEmit`, then tell the user to click **Reload** on the extension
  card. The build emits to `extension/dist/`; nothing takes effect until reload.
- **Changed `bridge/src/`** → rebuild (`npx tsc -p .`); the next chat reconnect
  picks up the new `bridge/dist/host.js` automatically.

Treat "build" / "rebuild" as part of finishing the change, not a separate step
the user must request. Surface any `tsc` errors and fix them before declaring
done.

## Architecture (the big picture)

**Extension** (`extension/src/`):
- `main.ts` — one `<anya-app>` Lit component. Owns **all** UI state, the chat
  store (`chrome.storage.local`), the NM frame handler, tool-RPC callbacks,
  mention expansion, slash commands, and voice handlers. Section banners mark
  logical groupings. It is large by design (see `design.md` §8).
- `background.ts` — service worker: side-panel registration, "Add to Anya"
  context menu.
- `page-bridge.ts` — content script: DOM capture, selection tracking, AI field
  fill (dispatches `input`+`change` so React/Vue/Angular pick it up).
- `native-bridge.ts` — `chrome.runtime.connectNative` wrapper with auto-reconnect.
- `styles.ts` — **all** CSS in one tagged template. Keep it sectioned; no
  separate CSS files.
- `types.ts` — shared interfaces (`ContextAttachment`, `ChatMessage`, `Chat`,
  `DebugEntry`, …).
- `voice/` — Web Speech STT/TTS + the `mic-permission.html` helper window. Runs
  entirely in the panel; no bridge frames involved.

**Bridge** (`bridge/src/`):
- `host.ts` — NM stdio loop and frame router. **Add new frame types here** plus
  a matching handler in `extension/src/main.ts`.
- `copilot-bridge.ts` — `SessionManager`: one shared `CopilotClient`; one
  `CopilotSession` per chat id, lazily created and cached. The `creating` map
  deduplicates concurrent `getOrCreateChat` calls — preserve it (double-create
  on a brand-new chat is a real race).
- `tools.ts` — all SDK tool definitions via `defineTool()`. Two families:
  context tools (RPC round-trip to the extension for `chrome.*` APIs) and
  Playwright `drive_*` tools (CDP).
- `tool-rpc.ts` — correlates `tool-request`/`tool-result` frames; 30 s timeout.
- `sessions.ts` — **CDP-only** Playwright session manager.
- `paths.ts` — cross-platform data-dir resolver. Always use it; never hardcode
  `%LOCALAPPDATA%` or OS-specific paths.
- `config.ts` — loads `~/.anya/config.json`.

Wire protocol (key frames):
- Extension → bridge: `hello`, `prompt`, `chat-delete`, `tool-result`, `stop`,
  `folder-pick`, `tool-config`, `set-model`, `set-auto-approve`,
  `permission-response`, `list-models`.
- Bridge → extension: `hello`, `delta`, `done`, `error`, `tool-start`,
  `tool-progress`, `tool-complete`, `tool-request`, `log`.

## Working in the browser surface — verify empirically, don't trust the repo

The MV3 **side panel** is a constrained context, and the repo has at times
contained both working and dead implementations of the same capability (plus
committed "fixes" that didn't actually work). Browser-API behavior here differs
from a normal web page — confirm what *actually* runs before extending it:

- `webkitSpeechRecognition` works in the **side panel** but returns
  `service-not-allowed` in an **offscreen document**. STT must run in the panel.
  Do **not** reintroduce an offscreen-doc STT path.
- The side panel **cannot surface the mic permission prompt** (no top-level
  frame). First-time/revoked grants go through the `mic-permission.html` helper
  window, which is a real page that can prompt; the grant then applies to the
  whole extension origin.
- `audioCapture` is **not** a real MV3 permission — don't add it to the manifest.

When a browser API misbehaves, test the actual behavior (build + reload + try)
rather than assuming the existing code is correct.

## Voice I/O specifics

Read `design.md` §8 before touching voice. Hard-won gotchas:
- STT + TTS both run **in the panel** via the Web Speech API — no bridge.
- `speechSynthesis.onend` fires **per-utterance, not per-stream** — check
  `speaking` before clearing an `isSpeaking` flag.
- Rate/voice changes mid-utterance are flaky — apply them on the **next**
  utterance, not in real time.
- Settings live in `chrome.storage.local` under `anya-voice-settings`.

## Conventions

- **TypeScript + ESM everywhere** (bridge is `"type":"module"`; extension is ESM
  via Vite).
- **Lit** for the sidebar UI.
- `persistChats` is **debounced 250 ms** but flushed synchronously in
  `disconnectedCallback` — don't add `await`s to the flush path.
- **Every spawned process** must have `cwd` pinned to the per-OS Anya data dir
  (via `paths.ts`) so junk doesn't land in `bridge/`.
- **No telemetry, no cloud sync.** Never introduce either.

## Environment

- Development is on **Windows + PowerShell**. In PowerShell, `&&` only chains
  external commands — use `;` before keywords (`if`, `foreach`, `$x = …`). Use
  Windows-style backslash paths.
- Runtime state: `chrome.storage.local` keys (`anya-chats`,
  `anya-current-chat`, `anya-theme`, `anya-voice-settings`); bridge scratch +
  `bridge.log` under the per-OS Anya data dir; per-chat working dirs at
  `~/.anya/sessions/<chatId>/`. The sidebar's 🐛 debug panel mirrors every NM
  frame — it's the canonical debugging tool.

## Output & changes — high signal, no padding

Make minimal, surgical changes that fully solve the request; don't pad. When
writing or updating docs, match each file's purpose and include only
high-value content — `README.md` is user-facing, `design.md` records
architecture decisions, `AGENTS.md`/`CLAUDE.md`/this file onboard agents. Don't
duplicate the same detail across all of them.

## What not to do

- Don't skip the rebuild after an `extension/src/` change, or forget to tell the
  user to reload the extension card.
- Don't reintroduce **extension-mode** or **multi-tab binding** Playwright in
  `sessions.ts` — CDP only (see `design.md` §7).
- Don't move **STT into an offscreen document**, or add the bogus `audioCapture`
  permission.
- Don't hardcode `%LOCALAPPDATA%` or OS-specific paths in the bridge — use
  `paths.ts`.
- Don't introduce telemetry, analytics, or cloud sync.
- Don't commit `extension/.extension-key.pem` (gitignored).

## Related docs

- `README.md` — user-facing intro + install.
- `design.md` — architecture spec, abandoned approaches (§7), UI + voice (§8).
- `AGENTS.md` / `CLAUDE.md` — agent onboarding (overlap with this file).
- `.github/agents/anya.agent.md` — the Anya **product** agent's runtime system
  prompt (not about working on this repo).
