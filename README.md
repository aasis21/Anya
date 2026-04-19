# AgentEdge

> GitHub Copilot CLI, reborn as a Microsoft Edge sidebar app.

See [`design.md`](./design.md) for the full design.

## Status

**Phase 1 / walking skeleton.** Goal: open the AgentEdge sidebar in Edge, type "hello", see real Copilot SDK output stream into xterm.js.

## Repo layout

```
AgentEdge/
├── design.md                 # the spec
├── extension/                # Edge MV3 extension (Lit + xterm.js)
│   ├── manifest.json
│   ├── sidebar.html
│   └── src/
└── bridge/                   # Node.js Native Messaging host (uses @github/copilot-sdk)
    ├── src/
    ├── manifest.template.json
    ├── launcher.cmd
    └── install.ps1
```

## Build & install (Phase 1)

### One-time setup
1. **Install Node 20+.**
2. **Make sure `copilot` CLI is logged in** (`copilot auth status`).

### One-shot setup
```pwsh
.\setup.ps1
```
Installs deps, builds both projects, runs the bridge ping test, and registers the Native Messaging host. Run with `-SkipTest` to skip the smoke test, or `-Uninstall` to tear down.

### Load the extension in Edge
1. Open `edge://extensions`.
2. Toggle **Developer mode** (bottom left).
3. Click **Load unpacked** → select `extension/dist/`.
4. Confirm the extension ID is `oopdnihjfloclgnbbkebgeiipfadebid` (pinned via the manifest `key` so it never drifts).
5. Click the AgentEdge icon → sidebar opens.

### Smoke test
- Type `ping` → see `PONG` response (echo path; verifies bridge handshake).
- Type a real prompt → see streamed Copilot response in the xterm pane.

## Uninstall

```pwsh
.\setup.ps1 -Uninstall
```
Then remove the unpacked extension from `edge://extensions`.

## Development

Logs from the bridge go to `%LOCALAPPDATA%\AgentEdge\bridge.log`.

To rebuild during development:
```pwsh
cd extension && npm run dev    # Vite watches src/
```

The extension keypair lives at `.extension-key.pem` (gitignored). The corresponding pubkey is baked into `extension/manifest.json` so the extension ID stays stable across reloads.
