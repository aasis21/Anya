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
  single bound tab in `bridge/src/sessions.ts`.

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
| `bound-tab.json` | Active Playwright binding state (single source of truth). |
| `sessions/<chatId>/` | Per-chat `workingDirectory` passed to `CopilotSession`. SDK-managed checkpoints, plan.md, files. |
| `playwright/` | `cwd` pinned for spawned `playwright-cli` processes. Holds `.playwright-cli/console-*.log` and stdout dumps from `evaluate` calls. Safe to wipe. |
| `bridge.log` | Rolling trace of every native-messaging frame and error. |
| `com.anya.bridge.json` | Native-messaging host manifest (written by install scripts). On Windows the registry points at this single file; on macOS/Linux a copy is dropped into each browser's `NativeMessagingHosts/` dir. |
| `attached-tabs.json` | Legacy multi-attach state. Safe to delete. |

## Things not to do

- Don't add unrelated files to `bridge/` — pin `cwd` for any spawn so junk
  lands in the per-OS Anya data dir under `playwright/` instead.
- Don't hardcode `%LOCALAPPDATA%` or any OS-specific path in the bridge —
  go through `bridge/src/paths.ts` so things keep working off Windows.
- Don't introduce telemetry, analytics, or cloud sync.
- Don't break the single-bound-tab invariant in `sessions.ts` — the prior
  multi-bind design is documented in `design.md` §7 as a deliberate failure.
- Don't commit `extension/.extension-key.pem` (already gitignored).

## Related docs

- `README.md` — user-facing intro + install instructions.
- `design.md` — design decisions and out-of-scope list.
- `.github/agents/anya.agent.md` — the agent's own system prompt.
