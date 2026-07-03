# Anya permission model — full design

Status: **design, not yet implemented**. Tracks GitHub issues #1, #2, #3, #4
(partial), #10, #11, #12, #13, #23 on `aasis21/Anya`.

`design.md` §9 has the short summary; this document is the full spec —
surface inventory, taxonomy, storage, wire protocol, and rollout.

## 0. Why this needs to be bigger than "browser permissions"

Anya is not just a browser-automation panel. Its custom agent frontmatter
sets `tools: ["*"]` (`.github/agents/anya.agent.md`), so every chat session
created in `bridge/src/copilot-bridge.ts` (`createChat` → `client.createSession`)
gets the **full Copilot SDK tool surface**, not only the tools Anya defines
itself:

| Family | Examples | Defined in |
| --- | --- | --- |
| Anya browser — read | `get_active_tab`, `list_tabs`, `get_selection`, `get_tab_content`, `browse_history`, `browse_downloads`, `search_chats`, `find_bookmarks` | `bridge/src/tools.ts` (`buildContextTools`) |
| Anya browser — write | `open_tab`/`close_tab`/`focus_tab`, `manage_bookmarks` (create/update/move/**remove**) | `bridge/src/tools.ts` |
| Anya browser — CDP driving | `connect_browser`, `drive_tab`, `drive_browser`, `drive_context` (cookies/storage/auth!), `drive_devtools` | `bridge/src/tools.ts` (`buildCdpTools`/Playwright wrappers) |
| **SDK built-ins** | `view`, `create`, `edit`, `glob`, `grep` (local filesystem), `powershell` (arbitrary shell), `task` (spawns sub-agents that themselves have the same toolset), `sql`, `web_fetch` | SDK-provided, not in `tools.ts` — enabled by `tools: ["*"]` |
| **MCP servers** | Whatever the user has configured in `~/.copilot/mcp-config.json` for the CLI generally — arbitrary third-party tools | Loaded by the SDK at session creation, outside Anya's control |
| Skills | `~/.copilot/skills/` prompts/instructions | Not directly permission-gated (no side effects of their own), out of scope here |

The bridge's single `onPermissionRequest` handler (`makePermissionHandler`,
`copilot-bridge.ts`) intercepts **every** SDK permission request regardless
of which family triggered it — so the redesign below is keyed off the SDK's
own `request.kind` discriminant (`shell` / `write` / `read` / `mcp` /
`url` / `memory` / `custom-tool` / `hook`), not off Anya's own tool names.
That's what makes one handler correctly cover local file edits, shell
commands, MCP tool calls, and Anya's own browser tools uniformly.

**Concretely, today, an unattended Anya chat with autopilot on can**: read
and write any file under the chat's `workingDirectory`, run arbitrary
PowerShell, delete bookmarks recursively, mutate cookies/auth via
`drive_context`, and call any MCP tool the user has configured for the CLI
— all silently. That is the real scope of "the permission feature."

## 1. Universal risk taxonomy (kind-based, not tool-based)

Tiering is decided primarily by the SDK's `request.kind`, with a small set
of name/arg-based escalation rules layered on top. This makes it uniform
across built-ins, MCP, and Anya's own tools — a new MCP tool or a new Anya
tool is automatically tiered correctly without a code change, because it
arrives as one of the SDK's existing kinds.

| Tier | `request.kind` → default | Escalation rules (name/arg based) | Behavior |
| --- | --- | --- | --- |
| **read** | `read`, plus Anya's own `skipPermission: true` read tools (`browse_history`, `browse_downloads`, `search_chats`, `get_*`) | none | Always auto-approved (unchanged from today) |
| **write** | `write`, `url`, `memory`, most `mcp` calls, most `custom-tool` calls, `shell` | none by default | Ask by default; user can flip **Autopilot** to skip asking (see §4) |
| **high-risk** | — (derived from `write`/`shell`/`mcp`/`custom-tool` by escalation rule) | `manage_bookmarks` with `op:'remove', recursive:true`; any `drive_context` call that sets/deletes cookies or storage (not just reads them); `mcp` calls where the request's own `readOnly` flag is `false` **and** the tool name matches a destructive verb (`delete`/`remove`/`drop`/`purge`); form-submitting `drive_tab` actions detected via Playwright's own navigation-type signal where available | **Always asks, ignores Autopilot.** Escape hatch is per-session only ("allow again this session") — never a silent permanent bypass, even with Autopilot on. This is the one true hard floor in the whole system. |

Per user's decision, **MCP is not a separate trust axis** — an MCP tool
call is just a `request.kind === 'mcp'` event and flows through the same
table above (default `write`, escalated to `high-risk` only if it matches
the destructive-verb + non-`readOnly` heuristic). No separate per-MCP-server
grant UI in this pass.

Per user's decision, **shell commands are not escalated based on touching
paths outside `workingDirectory`** — a `powershell` call is `write` tier
like any other write action; the full command text is simply always shown
in the approval preview (§3) so the user can judge that for themselves.

## 2. Trust surfaces

Two independent trust axes remain (MCP dropped per above):

1. **Per-site trust** (web origins) — `chrome.storage.local` map
   `origin → 'granted' | 'denied' | 'ask'`. Gates `page-bridge.ts` capture
   and any `drive_*`/tab tool touching that origin's tab. A Sites settings
   panel exposes a top-level default ("Ask first" vs "Auto-grant new
   sites") plus per-site rows. Addresses #1.
2. **Per-workingDirectory scope** (already implicit, not new UI) — each
   chat's `view`/`edit`/`create`/`powershell`/`glob`/`grep` calls are
   naturally scoped to that chat's `workingDirectory` (set via the 📁
   workspace pill or defaulting to the scratch sessions dir). No new
   per-repo grant UI needed in this pass — the tiering + rich preview
   (§3) is the safeguard, not a repo allowlist.

## 3. Approval UX overhaul

(Unchanged from the design agreed earlier — restated here for completeness.)

- Forward the SDK's real `toolTitle ?? toolName` and `intention` fields
  from `PermissionRequest` — never the bare `toolCallId`/`kind`.
- Render a kind-specific rich preview using fields already on the SDK
  request: `fullCommandText`/`commands` (shell), `diff`/`fileName` (write),
  `serverName`/`toolName`/`args` (mcp), `url` (url) — collapsed one-liner +
  "show full" expando (diff view for writes, monospace for shell/mcp args).
  Never a blind Allow. Addresses #10, #11.
- Ack-confirmed lifecycle: banner state machine `pending → resolving →
  resolved | error`, only cleared on an explicit `permission-ack` frame
  from the bridge (new frame type on the `host.ts` relay), with a
  timeout-to-error state if no ack arrives. Addresses #12.
- Cross-chat inbox: header badge with total pending count across *all*
  chats, dropdown listing each request + "Jump to chat". Addresses #13.
- Stale-clearing: on chat-delete, bridge disconnect, or restart, walk
  `pendingApprovals`/`permissionResolvers`, auto-reject orphans, emit a
  `permission-expired` frame so the UI explains a vanished banner instead
  of silently dropping it. Addresses #23.
- Untrusted-content tie-in (#4, partial): banner shows a ⚠ "requested
  after reading page content" badge when the requesting turn ingested
  untrusted page text this turn.

## 4. Autopilot mode (the easy global override)

Today's shipped default (`autoApprove = true` in `main.ts`) **is** full
autopilot — that's issue #3. The redesign keeps this as an explicit,
easy-to-reach mode rather than removing it, per the user's ask for "how we
can easily change to autopilot too if needed":

- **Where**: a toggle in the **composer bar** (near the existing 🔧 Tools
  pill), not buried in a settings panel and not promoted to a persistent
  header badge — a single click away on every chat, but bounded to the
  chat surface where the user is actively working.
- **Scope**: applies to the current chat's `write`-tier requests only
  (per-chat, matching the existing `set-auto-approve` frame's chat
  scoping) — flip it back per chat, no global hidden state.
- **Confirmation**: **silent** — no dialog. The toggle itself is the
  affordance; it must be visually unambiguous when on (e.g. a filled/lit
  state, distinct color) so there's no confusion about current mode, but
  no click-through friction to enable or disable it.
- **Duration**: simple on/off toggle — no time-boxing in this pass.
- **The one thing Autopilot never skips**: high-risk tier requests (§1).
  This is intentional and non-configurable — it's what makes "safe by
  default" (#3) and "enforce high-risk confirmations" (#2) actually true
  even when the user has opted into speed over friction everywhere else.

## 5. Data model additions

- `chrome.storage.local`:
  - `anya-site-trust`: `Record<origin, 'granted'|'denied'>` + `anya-site-trust-default: 'ask'|'granted'`.
  - `anya-auto-approve` (existing key) — semantics narrow from "approve
    everything" to "approve write-tier requests in this chat"; high-risk
    always prompts regardless. Existing stored `true` values are honored
    under the new narrower meaning (no migration prompt needed — it's a
    strict safety improvement, not a behavior loss the user opted out of).
- Bridge in-memory: `permissionResolvers` gains a `kind`/`tier` tag per
  pending entry so stale-clearing and the cross-chat inbox can label
  entries without re-deriving tier from raw args.

## 6. Wire protocol additions (`bridge/src/host.ts`)

- `permission-request` (existing) — payload extended with the full
  kind-specific SDK fields (§3) instead of the current truncated
  `{toolName, kind, arguments}`.
- `permission-ack` (new) — bridge → extension, confirms a response was
  received and applied before the banner is removed from `pendingApprovals`.
- `permission-expired` (new) — bridge → extension, emitted on stale-clear
  (chat delete / disconnect / restart) so the UI can show *why* a banner
  disappeared instead of it just vanishing.
- `set-auto-approve` (existing) — unchanged wire shape, narrowed semantics
  per §5.

## 7. Non-goals for this pass

- No per-MCP-server trust/grant UI (folded into the universal tiering,
  per user's decision).
- No `manifest.json` `host_permissions` narrowing — site trust gates at
  the tool-call layer, not the browser permission layer.
- No time-boxed/temporary Autopilot — plain on/off only.
- No full mitigation of #4 (prompt-injection) beyond the provenance badge
  tie-in on the approval banner — the rest of #4 (envelope/sanitization of
  untrusted page content before it reaches the model) is a separate design
  pass.

## 8. Implementation order

1. Risk tiers + high-risk hard floor + narrowed Autopilot semantics
   (`bridge/src/tools.ts`, `bridge/src/copilot-bridge.ts`) — #2, #3.
2. Approval banner UX overhaul (`extension/src/main.ts`, `host.ts` new
   frame types) — #10, #11, #12, #13, #23.
3. Per-site trust + Sites settings panel — #1.
4. Untrusted-content badge tie-in — partial #4.
5. Composer-bar Autopilot toggle (replacing/relabeling the current
   Tools-panel checkbox) to make the mode switch easy to find, per this
   design's §4.
