# AGENTS.md

Onboarding for AI agents (Copilot CLI, Cursor, Codex, etc.) working **on**
this repository. The runtime system prompt for the Anya product agent
itself lives in [`.github/agents/anya.agent.md`](.github/agents/anya.agent.md)
and is loaded by `bridge/src/copilot-bridge.ts` at session creation time.

## What this repo is

**Anya** — a Chromium MV3 sidebar extension that wraps
[`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk)
via a Node Native Messaging bridge. The bridge spawns `playwright-cli` for
in-tab browser automation. There is no cloud component.

```
extension/   Chromium MV3 sidebar (Lit + Vite + TypeScript)
bridge/      Node Native Messaging host (TypeScript, ESM)
.github/agents/anya.agent.md   System prompt loaded by the SDK
scripts/     One-off automation
```

## Build & run

```powershell
# Extension
cd extension
npm install
npm run build              # vite + tsc; output in extension/dist
# Then load extension/dist as an unpacked extension in your browser (edge://extensions, chrome://extensions, brave://extensions, vivaldi://extensions, arc://extensions, ...).

# Bridge
cd bridge
npm install
npx tsc -p .               # output in bridge/dist

# Register the Native Messaging host with every detected Chromium browser.
# Pick whichever entry point matches your shell:
pwsh ./install.ps1         # Windows / macOS / Linux (PowerShell 7+)
./install.sh               # macOS / Linux (bash)
```

After changing extension code, rebuild and click "Reload" on the extension
card. After changing bridge code, rebuild — the next chat reconnect picks
up the new `bridge/dist/host.js`.

## Type-check only

```powershell
cd extension; npx tsc --noEmit
cd bridge;    npx tsc --noEmit
```

## UI testing (Playwright, isolated from your live browser)

You can drive the **real, built** sidebar end-to-end — including a live
bridge connection, real tool calls, and real streamed Copilot replies —
without touching whatever browser you use day-to-day, and without any
manual "reload extension" step.

The trick: launch a throwaway Chromium instance with the unpacked
`extension/dist` loaded via `--load-extension`, in a scratch profile
directory **outside this repo**. Because it's a brand-new browser process
each run, Chromium always reads the current `dist/` off disk — no stale
cache, no manual reload in `chrome://extensions` (that's only needed for
your own persistent, already-running browser).

```js
// scratch/run.mjs — not committed; put scratch scripts outside the repo
import { chromium } from 'playwright'; // npm install playwright (scratch dir, --no-save)

const extensionPath = 'C:\\path\\to\\Anya\\extension\\dist'; // must be built first: npm run build
const context = await chromium.launchPersistentContext('./profile', {
  headless: false, // extensions require a headed context
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

// MV3 service worker registers async — wait for it, then derive the extension id.
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
const extensionId = sw.url().split('/')[2];

const page = await context.newPage();
await page.goto(`chrome-extension://${extensionId}/sidebar.html`);
// ...drive it: page.locator('textarea, [contenteditable="true"]') is the composer,
// button.stop-primary is the stop/cancel button, .attach-btn opens the context menu,
// .tc-action-btn are tool-card actions (View full output / Copy full), etc.

await context.close(); // always close — don't leave orphaned Chromium processes
```

Notes:
- **Rebuild first.** `npm run build` in `extension/` before every test run —
  the script only ever sees what's on disk in `dist/`.
- **Native messaging still works** — a fresh profile with the extension's
  fixed key (`extension/manifest.json`'s `"key"`) still resolves to the same
  extension ID the installed `com.anya.bridge.json` manifest whitelists, so
  the bridge connects normally (assuming `install.ps1`/`install.sh` has been
  run at least once on the machine).
- Lit renders into light DOM here (no shadow root), but `document.body.innerText`
  can still miss text in some overlay/toast timing windows — prefer
  screenshots (`page.screenshot(...)`) to visually confirm banners/notices
  rather than trusting a single `innerText` snapshot.
- Some states need mocking to reach: offline send (block/kill the bridge
  mid-request), clipboard failures (`context.grantPermissions([...])` +
  `page.evaluate(() => navigator.clipboard.readText = () => Promise.reject(...))`),
  mic-denied (deny the permission or override `getUserMedia`). Model-list
  failure needs the bridge's `list-models` request to fail — easiest is to
  read the code path instead of forcing it live.
- This composes with the `ui-bug-sweep` skill (cortex `.github/skills/`) for
  full sweeps, and the `ui-screenshots` skill's DOM-posing technique when a
  live bridge isn't available.

## Conventions

- **TypeScript everywhere**, ESM in the bridge (`"type":"module"` in
  `bridge/package.json`).
- **Lit** for the sidebar UI; styles live in `extension/src/styles.ts` (one
  big tagged template — keep it sectioned, no separate CSS files).
- **No telemetry, no cloud sync.** Everything is local — chats live in
  `chrome.storage.local`; bridge state in `%LOCALAPPDATA%\Anya\`.
- **Native messaging frames** are JSON, one per message; the host's frame
  router lives in `bridge/src/host.ts`. Add new frame types there + matching
  handler in `extension/src/main.ts`.
- **Tools** for the SDK agent are defined in `bridge/src/tools.ts` via
  `defineTool(...)` from `@github/copilot-sdk`. Browser-context tools defer
  to the extension over the tool-rpc channel; Playwright driving is the
  CDP session in `bridge/src/sessions.ts`.
- **Voice I/O** lives in `extension/src/speech/` (Web Speech API). STT and TTS
  both run in the side panel — there is no bridge involvement.

## Runtime layout (per OS)

The bridge writes its scratch state under a per-OS data dir, resolved by
`bridge/src/paths.ts`:

| OS      | Data dir                                              |
| ------- | ----------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\Anya\`                                |
| macOS   | `~/Library/Application Support/Anya/`                 |
| Linux   | `${XDG_DATA_HOME:-~/.local/share}/Anya/`              |

Inside that dir:

| Path | Purpose |
| ---- | ------- |
| `sessions/<chatId>/` | Per-chat `workingDirectory` passed to `CopilotSession`. SDK-managed checkpoints, plan.md, files. |
| `playwright/` | `cwd` pinned for spawned `playwright-cli` processes. Holds `.playwright-cli/console-*.log` and stdout dumps from `evaluate` calls. Safe to wipe. |
| `bridge.log` | Rolling trace of every native-messaging frame and error. |
| `com.anya.bridge.json` | Native-messaging host manifest (written by install scripts). On Windows the registry points at this single file; on macOS/Linux a copy is dropped into each browser's `NativeMessagingHosts/` dir. |

## Things not to do

- Don't add unrelated files to `bridge/` — pin `cwd` for any spawn so junk
  lands in the per-OS Anya data dir under `playwright/` instead.
- Don't hardcode `%LOCALAPPDATA%` or any OS-specific path in the bridge —
  go through `bridge/src/paths.ts` so things keep working off Windows.
- Don't introduce telemetry, analytics, or cloud sync.
- Don't reintroduce extension mode in `sessions.ts` — CDP is the only
  Playwright mode. The prior extension and multi-bind designs both failed.
- Don't move speech-to-text into an offscreen document —
  `webkitSpeechRecognition` returns `service-not-allowed` there. It must run in
  the side panel; the mic prompt comes from the `mic-permission.html` helper
  window because the panel can't show it directly.
- Don't commit `extension/.extension-key.pem` (already gitignored).

## Related docs

- `README.md` — user-facing intro + install instructions.
- `design.md` — design decisions and out-of-scope list.
- `.github/agents/anya.agent.md` — the agent's own system prompt.
- See "UI testing (Playwright, isolated from your live browser)" above for
  driving the real built sidebar end-to-end without disturbing your daily browser.
