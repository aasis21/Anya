// Bridge-side tool definitions for the Copilot SDK.
//
// Tool surface is split into families:
//
// 1. Chrome-context tools (read-only) — defer to the extension over the
//    tool-rpc channel. They wrap chrome.tabs / chrome.scripting. Always present.
//
// 2. Playwright tools — mode-dependent:
//    - "extension" mode: bind_tab / unbind_tab / bound_tabs + drive_* family
//    - "cdp" mode: connect_browser / disconnect_browser / bound_tabs + drive_* family
//
//    The drive_* family is four sibling tools, all thin wrappers over the
//    `playwright-cli` binary. They differ ONLY in description (which
//    subcommand subset they advertise) — same handler, same runner. The
//    split is purely an affordance signal so the model picks the right
//    family for the job:
//
//      drive_tab      — page-scoped: DOM, nav, screenshots, eval
//      drive_browser  — browser/session/multi-tab lifecycle
//      drive_context  — cookies, web storage, auth state, network mocking
//      drive_devtools — debugging surface: console, network log, tracing, video

import { defineTool, type Tool } from '@github/copilot-sdk';
import { spawn } from 'node:child_process';
import { error, log, warn } from './log.js';
import type { ToolRpc } from './tool-rpc.js';
import type { PlaywrightMode } from './config.js';
import { PLAYWRIGHT_CLI } from './config.js';
import {
  bindTab, getBoundTab, getBoundTabFile, getPlaywrightCwd, unbindTab,
  connectBrowser, disconnectBrowser, getCdpSessionId, isCdpConnected,
  runPlaywrightCmd,
} from './sessions.js';

const PLAYWRIGHT_TIMEOUT_MS = 60_000;

const tabIdSchema = {
  type: 'object',
  properties: {
    tabId: { type: 'number', description: 'Optional tab id; defaults to the active tab.' },
  },
  additionalProperties: false,
} as const;

export function buildContextTools(rpc: ToolRpc): Tool[] {
  return [
    defineTool('get_active_tab', {
      description:
        'Return the user\'s currently focused browser tab — its tabId, URL, title and favicon. ' +
        'Use this to resolve "this page", "here", "the tab" before any other action.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      skipPermission: true,
      handler: async () => JSON.stringify(await rpc.call('get_active_tab')),
    }),
    defineTool('list_tabs', {
      description:
        'List every open browser tab in the user\'s current Edge window. ' +
        'Returns an array of {tabId, url, title}. Use when the user mentions multiple tabs ' +
        'or asks about their browsing context broadly.',
      parameters: {
        type: 'object',
        properties: { windowId: { type: 'number', description: 'Optional window id.' } },
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => JSON.stringify(await rpc.call('list_tabs', args)),
    }),
    defineTool('get_selection', {
      description:
        'Return the text the user currently has highlighted (selected) on a tab. ' +
        'Defaults to the active tab. Returns an empty string if nothing is selected.',
      parameters: tabIdSchema,
      skipPermission: true,
      handler: async (args) => JSON.stringify(await rpc.call('get_selection', args)),
    }),
    defineTool('get_tab_content', {
      description:
        'Return the readable text content of a tab as Markdown (Readability extraction). ' +
        'Defaults to the active tab. Use this to read articles, PR descriptions, docs, etc. ' +
        'Large pages are truncated.',
      parameters: tabIdSchema,
      skipPermission: true,
      handler: async (args) => JSON.stringify(await rpc.call('get_tab_content', args)),
    }),
    defineTool('focus_tab', {
      description:
        'Bring a specific browser tab to the foreground in the user\'s Edge — activates the ' +
        'tab and focuses its window. Pass the numeric tabId from list_tabs / get_active_tab.',
      parameters: {
        type: 'object',
        properties: { tabId: { type: 'number', description: 'Numeric tab id.' } },
        required: ['tabId'],
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => JSON.stringify(await rpc.call('focus_tab', args)),
    }),
    defineTool('open_tab', {
      description:
        'Open a new browser tab in the user\'s Edge at the given URL. The tab opens in their ' +
        'real browser window so they can interact with it. Use this to navigate to a page.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute URL to open.' },
          background: { type: 'boolean', description: 'If true, open without focusing.' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => JSON.stringify(await rpc.call('open_tab', args)),
    }),
    defineTool('close_tab', {
      description:
        'Close one or more browser tabs in the user\'s Edge. Pass `tabId` (number) for a single ' +
        'tab, or `tabIds` (number[]) for several. Defaults to the active tab if neither is ' +
        'given. Useful for cleaning up after automation, closing stale tabs, or after the user ' +
        'asks "close that tab" / "close those tabs". Resolve tabIds via `list_tabs` or ' +
        '`get_active_tab` first if you don\'t already have them.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'A single tab id to close.' },
          tabIds: {
            type: 'array',
            items: { type: 'number' },
            description: 'Multiple tab ids to close in one call.',
          },
        },
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => JSON.stringify(await rpc.call('close_tab', args)),
    }),

    defineTool('manage_bookmarks', {
      description:
        'Read and manage the user\'s Edge bookmarks via chrome.bookmarks. One umbrella tool ' +
        'with many `op`s — pick the op you need.\n\n' +
        'OPS:\n' +
        '- `list` ({folder?, query?, limit?}) → flat array of {id, parentId, title, url, ' +
        'folderPath, isFolder, index}. `folder` filters by folderPath prefix (case-insensitive); ' +
        '`query` substring-matches title+url. Best for "show me everything" / "find by keyword".\n' +
        '- `tree` ({nodeId?}) → nested chrome bookmark tree. Use when you need full hierarchy.\n' +
        '- `search` ({query, limit?}) → Edge\'s native fuzzy search, decorated with folderPath.\n' +
        '- `open` ({id, background?}) → open the bookmark\'s URL in a new tab. Folders error.\n' +
        '- `create` ({parentId?, title, url?}) → create a bookmark; omit `url` to create a folder.\n' +
        '- `update` ({id, title?, url?}) → rename or re-target a single bookmark/folder.\n' +
        '- `move` ({id? | ids?, parentId, index?}) → reparent one or many. Bulk-friendly: pass ' +
        '`ids: string[]` to move many in one call (assigned consecutive indexes from `index`).\n' +
        '- `remove` ({id? | ids?, recursive?}) → delete one or many. `recursive:true` for ' +
        'non-empty folders. **Destructive — confirm with the user first.**\n\n' +
        'USE CASES: (a) AI-powered reorganize: `tree` → propose plan → confirm → bulk `move`/' +
        '`update`/`remove`. (b) Context-aware navigation: when the user says "open the order ' +
        'release page" or any named workflow, `search` their bookmarks for the relevant entry, ' +
        'then `open` it instead of guessing the URL.',
      parameters: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['list', 'tree', 'search', 'open', 'create', 'update', 'move', 'remove'],
            description: 'Which bookmark operation to perform.',
          },
          // list / search filters
          folder: { type: 'string', description: '(list) Filter by folderPath prefix.' },
          query: { type: 'string', description: '(list/search) Substring or fuzzy query.' },
          limit: { type: 'number', description: '(list/search) Max results.' },
          // tree
          nodeId: { type: 'string', description: '(tree) Subtree root id; omit for full tree.' },
          // open / update / single-target ops
          id: { type: 'string', description: 'Bookmark/folder id (open/update/move/remove).' },
          background: { type: 'boolean', description: '(open) Open without focusing.' },
          // create / update
          parentId: { type: 'string', description: 'Parent folder id (create/move).' },
          title: { type: 'string', description: 'Title (create/update).' },
          url: { type: 'string', description: 'URL (create/update). Omit on create for folder.' },
          // move
          index: { type: 'number', description: '(move) Position within parent.' },
          // bulk move/remove
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bulk ids for move/remove.',
          },
          // remove
          recursive: { type: 'boolean', description: '(remove) Allow non-empty folder delete.' },
        },
        required: ['op'],
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => JSON.stringify(await rpc.call('manage_bookmarks', args)),
    }),

    // ---------------- tab binding (extension mode) / browser connect (cdp mode) ----------------
  ];
}

// ==================== Extension-mode Playwright tools ====================

function buildExtensionTools(): Tool[] {
  return [
    defineTool('bind_tab', {
      description:
        'Open a Playwright connect dialog so the user can pick which browser tab to bind for ' +
        'browser automation. Only ONE tab can be bound at a time — calling `bind_tab` again ' +
        'replaces the prior binding. After the user clicks Connect on a tab, that tab becomes ' +
        'driveable via the `drive_*` family (`drive_tab`, `drive_browser`, ' +
        '`drive_context`, `drive_devtools`). Use the optional `hint` to label ' +
        'this binding so you can ' +
        'remember which tab you wanted (e.g. "Gmail compose", "PR review"). ' +
        'After calling, prompt the user to click Connect, then poll `bound_tabs` until the ' +
        '`status` flips from "waiting-for-connect" to "connected".',
      parameters: {
        type: 'object',
        properties: {
          hint: { type: 'string', description: 'Human-readable label for this binding.' },
        },
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => {
        const a = (args ?? {}) as { hint?: unknown };
        const hint = typeof a.hint === 'string' && a.hint.trim() ? a.hint.trim() : undefined;
        const tab = bindTab({ hint });
        return JSON.stringify({
          ok: true,
          sessionId: tab.sessionId,
          status: tab.status,
          hint: tab.hint,
          stateFile: getBoundTabFile(),
          message:
            'A connect dialog should now be open in the browser. Ask the user to click ' +
            'Connect on the tab they want bound, then call `bound_tabs` to confirm and ' +
            'use the `drive_*` tools to act on it.',
        });
      },
    }),
    defineTool('unbind_tab', {
      description:
        'Release the currently bound tab (kills the playwright-cli attach process). Use when ' +
        'you are done with browser automation, or before binding a different tab if you want ' +
        'to be explicit. `bind_tab` also auto-replaces, so calling unbind first is optional.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      skipPermission: true,
      handler: async () => {
        const ok = await unbindTab();
        return JSON.stringify({ ok });
      },
    }),
  ];
}

// ==================== CDP-mode Playwright tools ====================

function buildCdpTools(): Tool[] {
  return [
    defineTool('connect_browser', {
      description:
        'Attach to the user\'s browser via Chrome DevTools Protocol. This gives full control ' +
        'over all tabs — you can open new tabs, switch between them, and close them via ' +
        '`drive_*` family. No connect dialog needed. Requires the user to have enabled remote ' +
        'debugging: open edge://inspect/#remote-debugging and check "Allow remote debugging ' +
        'for this browser instance". Call this before any `drive_*` tool if `bound_tabs` shows no ' +
        'connection.',
      parameters: {
        type: 'object',
        properties: {
          browser: { type: 'string', description: 'Browser channel. Default: "msedge". Also: "chrome".' },
        },
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => {
        const a = (args ?? {}) as { browser?: unknown };
        const browser = typeof a.browser === 'string' && a.browser.trim() ? a.browser.trim() : 'msedge';
        const result = await connectBrowser(browser);
        return JSON.stringify(result);
      },
    }),
    defineTool('disconnect_browser', {
      description:
        'Release the CDP connection to the browser. Use when you are done with browser ' +
        'automation. The browser stays open — only the Playwright control is released.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      skipPermission: true,
      handler: async () => {
        const ok = await disconnectBrowser();
        return JSON.stringify({ ok });
      },
    }),
  ];
}

// ==================== Shared Playwright tools (both modes) ====================

function buildSharedPlaywrightTools(): Tool[] {
  return [
    defineTool('bound_tabs', {
      description:
        'List the tabs currently under Playwright control. In extension mode this returns ' +
        'the single bound tab. In CDP mode this returns all tabs the browser has open. ' +
        'Use to confirm a connection is active before calling any `drive_*` tool.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      skipPermission: true,
      handler: async () => {
        // CDP mode: use tab-list for multi-tab info
        const cdpSid = getCdpSessionId();
        if (cdpSid) {
          const result = await runPlaywrightCmd(['tab-list'], cdpSid, 8_000);
          return JSON.stringify({
            ok: result.ok,
            mode: 'cdp',
            sessionId: cdpSid,
            tabs: result.ok ? result.stdout : undefined,
            error: result.ok ? undefined : result.stderr.trim().split(/\r?\n/)[0],
          });
        }
        // Extension mode: single bound tab
        return JSON.stringify({
          ok: true,
          mode: 'extension',
          stateFile: getBoundTabFile(),
          boundTab: getBoundTab(),
        });
      },
    }),
    buildDriveTool('drive_tab', DRIVE_TAB_DESC),
    buildDriveTool('drive_browser', DRIVE_BROWSER_DESC),
    buildDriveTool('drive_context', DRIVE_CONTEXT_DESC),
    buildDriveTool('drive_devtools', DRIVE_DEVTOOLS_DESC),
  ];
}

// ---- Descriptions for the drive_* family ---------------------------------
//
// All four tools share the same handler — they shell out to `playwright-cli`
// with `argv` forwarded verbatim. They differ only in description, which
// advertises a focused subset of subcommands. Pick the family that matches
// the JOB; argv routing is unconstrained, so a wrong pick still works, but
// the right pick gives the model better priors when constructing argv.
//
// Universal escape hatch: any tool accepts `["--help"]` to dump the full
// `playwright-cli` command list.

const DRIVE_TAB_DESC =
  'Drive the currently focused page. Thin wrapper over the `playwright-cli` ' +
  'binary — `argv` is forwarded verbatim. Use this for ANY page-scoped DOM ' +
  'or navigation action: ' +
  '`goto`, `click`, `dblclick`, `type`, `fill`, `press`, `hover`, `select`, ' +
  '`check`, `uncheck`, `upload`, `drag`, mouse (`mousemove`, `mousedown`, ' +
  '`mouseup`, `mousewheel`), keyboard (`keydown`, `keyup`), navigation ' +
  '(`go-back`, `go-forward`, `reload`), inspection (`snapshot`, `eval`, ' +
  '`run-code`), output (`screenshot`, `pdf`), dialogs (`dialog-accept`, ' +
  '`dialog-dismiss`). ' +
  'Examples: ["snapshot"], ["click","e15"], ["type","hello"], ' +
  '["fill","e15","value"], ["goto","https://example.com"], ["screenshot"], ' +
  '["eval","() => document.title"]. ' +
  'For browser-wide actions (tab management, sessions) use `drive_browser`. ' +
  'For cookies/storage/network mocking use `drive_context`. ' +
  'For console logs / network requests / tracing use `drive_devtools`. ' +
  'Call ["--help"] to list every supported subcommand. ' +
  'Pre-flight: `bound_tabs` must show a connection — otherwise call ' +
  '`connect_browser` (CDP mode) or `bind_tab` (extension mode).';

const DRIVE_BROWSER_DESC =
  'Drive the browser/session itself — anything NOT scoped to a single page. ' +
  'Thin wrapper over the `playwright-cli` binary; `argv` is forwarded ' +
  'verbatim. Covers: ' +
  'tab management (`tab-list`, `tab-new`, `tab-close`, `tab-select`), ' +
  'window (`resize`), ' +
  'session lifecycle (`open`, `close`, `attach`, `delete-data`, `list`, ' +
  '`close-all`, `kill-all`), ' +
  'install (`install`, `install-browser`). ' +
  'Examples: ["tab-list"], ["tab-new","https://..."], ["tab-select","2"], ' +
  '["resize","1280","800"], ["list"]. ' +
  'For page-scoped actions (click, type, snapshot) use `drive_tab`. ' +
  'For cookies/storage use `drive_context`. ' +
  'Call ["--help"] to list every supported subcommand. ' +
  'Pre-flight: same as `drive_tab` — requires an active connection.';

const DRIVE_CONTEXT_DESC =
  'Manage browser-context state — cookies, web storage, auth, network ' +
  'mocking. Thin wrapper over the `playwright-cli` binary; `argv` is ' +
  'forwarded verbatim. State here persists across page navigations within ' +
  'the same browser session. Covers: ' +
  'cookies (`cookie-list`, `cookie-get <name>`, `cookie-set <name> <value>`, ' +
  '`cookie-delete <name>`, `cookie-clear`), ' +
  'localStorage (`localstorage-list`, `localstorage-get <key>`, ' +
  '`localstorage-set <key> <value>`, `localstorage-delete <key>`, ' +
  '`localstorage-clear`), ' +
  'sessionStorage (`sessionstorage-*` mirroring localStorage), ' +
  'auth state (`state-save [filename]`, `state-load <filename>` — useful ' +
  'for "log in once, replay later"), ' +
  'network mocking (`route <pattern>`, `route-list`, `unroute [pattern]`), ' +
  'connectivity (`network-state-set online|offline`). ' +
  'Examples: ["cookie-list"], ["state-save","auth.json"], ' +
  '["network-state-set","offline"], ["route","**/api/**"]. ' +
  'For page DOM actions use `drive_tab`. For tab/session lifecycle use ' +
  '`drive_browser`. For console/network observation use `drive_devtools`. ' +
  'Call ["--help"] to list every supported subcommand. ' +
  'NOTE: cookie/storage operations expose sensitive data (tokens, session ' +
  'IDs). Treat output with care.';

const DRIVE_DEVTOOLS_DESC =
  'Inspect and debug the page like a DevTools panel. Thin wrapper over the ' +
  '`playwright-cli` binary; `argv` is forwarded verbatim. Read-only ' +
  'observation plus tracing. Covers: ' +
  'console (`console [min-level]` — levels: log, info, warn, error, debug — ' +
  'returns buffered messages since page load), ' +
  'network requests (`network` — list all requests since page load), ' +
  'tracing (`tracing-start`, `tracing-stop` — Playwright trace zip), ' +
  'video recording (`video-start [filename]`, `video-stop`, ' +
  '`video-chapter <title>`), ' +
  'live debug (`show` — open browser devtools, `pause-at <location>`, ' +
  '`resume`, `step-over`). ' +
  'Examples: ["console"], ["console","error"], ["network"], ' +
  '["tracing-start"], ["tracing-stop"]. ' +
  'For DOM actions use `drive_tab`. For network MOCKING (vs observing) use ' +
  '`drive_context route`. ' +
  'Call ["--help"] to list every supported subcommand. ' +
  'NOTE: `console` and `network` are buffer dumps, not live streams — call ' +
  'them after the action you want to observe.';

function buildDriveTool(name: string, description: string): Tool {
  return defineTool(name, {
    description,
    parameters: {
      type: 'object',
      properties: {
        argv: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments passed verbatim to playwright-cli.',
        },
      },
      required: ['argv'],
      additionalProperties: false,
    },
    skipPermission: true,
    handler: async (args) => {
      const a = (args ?? {}) as { argv?: unknown };
      if (!Array.isArray(a.argv) || a.argv.some((v) => typeof v !== 'string')) {
        return JSON.stringify({ ok: false, error: 'argv must be an array of strings' });
      }
      // Try CDP session first, then extension session.
      const cdpSid = getCdpSessionId();
      if (cdpSid) {
        return runPlaywright(a.argv as string[], cdpSid, name);
      }
      const tab = getBoundTab();
      if (!tab) {
        return JSON.stringify({
          ok: false,
          error: 'No browser connection. Call `connect_browser` (CDP mode) or `bind_tab` (extension mode) first.',
        });
      }
      if (tab.status === 'waiting-for-connect') {
        return JSON.stringify({
          ok: false,
          error: `Bound tab session ${tab.sessionId} is still waiting for the user to click Connect. Ask the user to do so, then retry.`,
        });
      }
      if (tab.status === 'dead') {
        return JSON.stringify({
          ok: false,
          error: `Bound tab session ${tab.sessionId} is dead (tab closed or browser quit). Call \`bind_tab\` to bind a fresh tab.`,
        });
      }
      return runPlaywright(a.argv as string[], tab.sessionId, name);
    },
  });
}

// ==================== Public builder ====================

export function buildPlaywrightTools(mode: PlaywrightMode): Tool[] {
  const modeTools = mode === 'cdp' ? buildCdpTools() : buildExtensionTools();
  return [...modeTools, ...buildSharedPlaywrightTools()];
}

function runPlaywright(argv: string[], sessionId: string, toolName = 'drive'): Promise<string> {
  return new Promise((resolve) => {
    const finalArgv = [`-s=${sessionId}`, ...argv];
    log(`${toolName}: spawning`, PLAYWRIGHT_CLI, finalArgv.join(' '));
    let child: ReturnType<typeof spawn>;
    try {
      // Ensure no stale token env var interferes.
      const env = { ...process.env };
      delete env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
      child = spawn(PLAYWRIGHT_CLI, finalArgv, { shell: true, windowsHide: true, env, cwd: getPlaywrightCwd() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error(`${toolName} spawn failed:`, err);
      resolve(JSON.stringify({
        ok: false,
        error: `Failed to spawn playwright-cli: ${msg}. Install with: npm install -g @playwright/cli`,
      }));
      return;
    }

    const out: Buffer[] = [];
    const errOut: Buffer[] = [];
    let settled = false;

    const finish = (payload: object) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(JSON.stringify(payload));
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish({ ok: false, error: `playwright-cli timed out after ${PLAYWRIGHT_TIMEOUT_MS}ms` });
    }, PLAYWRIGHT_TIMEOUT_MS);

    child.stdout?.on('data', (b: Buffer) => out.push(b));
    child.stderr?.on('data', (b: Buffer) => errOut.push(b));
    child.on('error', (err) => {
      warn(`${toolName} process error:`, err);
      finish({ ok: false, error: `playwright-cli process error: ${err.message}` });
    });
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(errOut).toString('utf8');
      finish({
        ok: code === 0,
        exitCode: code,
        stdout: truncate(stdout, 60_000),
        stderr: truncate(stderr, 8_000),
      });
    });
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}
