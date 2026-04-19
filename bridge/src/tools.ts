// Bridge-side tool definitions for the Copilot SDK.
//
// Tool surface is split into two families:
//
// 1. Chrome-context tools (read-only, free) — defer to the extension over
//    the tool-rpc channel. They wrap chrome.tabs / chrome.scripting.
//
// 2. Tab-binding + driving tools — use playwright-cli. The bridge models a
//    SINGLE bound tab at a time (`bind_tab` opens connect dialog, user
//    picks one tab; `drive_tab` runs a playwright command on it).

import { defineTool, type Tool } from '@github/copilot-sdk';
import { spawn } from 'node:child_process';
import { error, log, warn } from './log.js';
import type { ToolRpc } from './tool-rpc.js';
import { bindTab, getBoundTab, getBoundTabFile, getPlaywrightCwd, unbindTab } from './sessions.js';

const PLAYWRIGHT_CLI = process.env.AGENTEDGE_PLAYWRIGHT_CLI ?? 'playwright-cli';
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
        'real Edge window so they can interact with it. Use this to navigate to a page.',
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

    // ---------------- tab binding ----------------
    defineTool('bind_tab', {
      description:
        'Open a Playwright connect dialog so the user can pick which Edge tab to bind for ' +
        'browser automation. Only ONE tab can be bound at a time — calling `bind_tab` again ' +
        'replaces the prior binding. After the user clicks Connect on a tab, that tab becomes ' +
        'driveable via `drive_tab`. Use the optional `hint` to label this binding so you can ' +
        'remember which tab you wanted (e.g. "Gmail compose", "PR review"). ' +
        'After calling, prompt the user to click Connect, then poll `bound_tab` until the ' +
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
            'Connect on the tab they want bound, then call `bound_tab` to confirm and ' +
            'use `drive_tab` to act on it.',
        });
      },
    }),
    defineTool('bound_tab', {
      description:
        'Return the current bound tab\'s status: {sessionId, status, url, title, hint, ' +
        'chromeTabId, attachedAt, lastSeenAt} — or null if no tab is bound. ' +
        'Use to confirm a binding has connected before calling `drive_tab`, or to check ' +
        'whether the bound tab\'s URL still matches what you intended to drive.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      skipPermission: true,
      handler: async () => JSON.stringify({
        ok: true,
        stateFile: getBoundTabFile(),
        boundTab: getBoundTab(),
      }),
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

export function buildBrowserTool(): Tool {
  return defineTool('drive_tab', {
    description:
      'Drive the currently bound Edge tab via playwright-cli (replaces the old `browser` tool). ' +
      'Required: `argv` — playwright-cli arguments, e.g. ["snapshot"], ["click","e15"], ' +
      '["type","hello"], ["navigate","https://example.com"], ["screenshot"]. ' +
      'Pre-flight: check `bound_tab` first. If it returns null, status="dead", or the URL is ' +
      'not what you want to drive, call `bind_tab({hint:"..."})` and ask the user to click ' +
      'Connect on the right tab. Run argv=["--help"] for command discovery.',
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
      const tab = getBoundTab();
      if (!tab) {
        return JSON.stringify({
          ok: false,
          error: 'no tab is bound — call `bind_tab` first and ask the user to click Connect.',
        });
      }
      if (tab.status === 'waiting-for-connect') {
        return JSON.stringify({
          ok: false,
          error: `bound tab session ${tab.sessionId} is still waiting for the user to click Connect. Ask the user to do so, then retry.`,
        });
      }
      if (tab.status === 'dead') {
        return JSON.stringify({
          ok: false,
          error: `bound tab session ${tab.sessionId} is dead (tab closed or browser quit). Call \`bind_tab\` to bind a fresh tab.`,
        });
      }
      return runPlaywright(a.argv as string[], tab.sessionId);
    },
  });
}

function runPlaywright(argv: string[], sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    const finalArgv = [`-s=${sessionId}`, ...argv];
    log('drive_tab: spawning', PLAYWRIGHT_CLI, finalArgv.join(' '));
    let child: ReturnType<typeof spawn>;
    try {
      // No PLAYWRIGHT_MCP_EXTENSION_TOKEN — `bind_tab` deliberately spawns
      // without it so the user picks the tab. Once bound, follow-up cmds
      // run against that session id and don't need the token.
      const env = { ...process.env };
      delete env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
      child = spawn(PLAYWRIGHT_CLI, finalArgv, { shell: true, windowsHide: true, env, cwd: getPlaywrightCwd() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error('drive_tab spawn failed:', err);
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
      warn('drive_tab process error:', err);
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
