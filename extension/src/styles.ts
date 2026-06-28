import { css } from 'lit';

/**
 * Anya sidebar styles.
 * Copilot-familiar layout with GitHub-like neutral surfaces.
 * Sans-serif body, monospace code. Rounded, clean, readable.
 * Extracted from main.ts to keep the component file focused on behaviour.
 */
export const sidebarStyles = css`
    /* ===========================================================
       ANYA — GitHub Copilot-aligned chat skin
       Neutral dark palette with Copilot-style blue accent.
       Sans-serif body, monospace code only.
       =========================================================== */
    :host {
      --bg:        #0d1117;
      --bg-rule:   #30363d;
      --bg-soft:   #161b22;
      --bg-bubble: #161b22;
      --fg:        #e6edf3;
      --fg-dim:    #8b949e;
      --fg-faint:  #6e7681;
      --accent:    #2f81f7;
      --accent-soft: rgba(47, 129, 247, 0.14);
      --grid:      rgba(230, 237, 243, 0.02);
      --strong:    #ffffff;
      --code-bg:   #0b0f14;
      --code-fg:   #e6edf3;
      --success:   #3fb950;
      --warning:   #d29922;
      --error:     #f85149;
    }
    :host([theme="light"]) {
      --bg:        #ffffff;
      --bg-rule:   #d0d7de;
      --bg-soft:   #f6f8fa;
      --bg-bubble: #f6f8fa;
      --fg:        #24292f;
      --fg-dim:    #57606a;
      --fg-faint:  #6e7781;
      --accent:    #0969da;
      --accent-soft: rgba(9, 105, 218, 0.1);
      --grid:      rgba(0, 0, 0, 0.025);
      --strong:    #000000;
      --code-bg:   #0f1720;
      --code-fg:   #e6edf3;
      --success:   #1a7f37;
      --warning:   #9a6700;
      --error:     #cf222e;
    }
    :host {
      --mono: 'JetBrains Mono', 'Cascadia Code', 'Consolas', ui-monospace, monospace;
      --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;

      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--sans);
      font-size: 13px;
      line-height: 1.55;
      letter-spacing: 0;
    }

    /* ---------- HEADER ---------- */
    header {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--bg-rule);
      flex: 0 0 auto;
    }
    .header-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .header-actions {
      display: inline-flex;
      gap: 4px;
      flex: 0 0 auto;
    }
    .signal {
      display: inline-flex; align-items: center;
      flex: 0 0 auto;
      cursor: help;
    }
    .signal .pulse {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--fg-faint);
      transition: background 200ms ease, box-shadow 200ms ease;
    }
    .signal.on .pulse {
      background: var(--success, #4ade80);
      box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5);
      animation: pulse 2s ease-out infinite;
    }
    .icon-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--fg-dim);
      width: 28px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      border-radius: 6px;
      transition: color 150ms ease, background 150ms ease;
    }
    .icon-btn:hover { color: var(--fg); background: var(--bg-soft); border-color: var(--bg-rule); }
    .icon-btn.active { color: var(--accent); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }

    /* ---- header overflow menu ---- */
    .header-more-wrap { position: relative; display: inline-flex; }
    .header-menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      min-width: 180px;
      background: var(--bg-soft);
      border: 1px solid var(--bg-rule);
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      padding: 4px;
      z-index: 50;
      display: flex;
      flex-direction: column;
    }
    .header-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      background: transparent;
      color: var(--fg);
      border: none;
      border-radius: 6px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      text-align: left;
      white-space: nowrap;
      transition: background 100ms ease;
    }
    .header-menu-item:hover { background: var(--bg-bubble); }
    .header-menu-icon { flex: 0 0 18px; text-align: center; font-size: 13px; }
    .header-menu-check { margin-left: auto; color: var(--accent); font-size: 11px; }
    .header-menu-badge {
      margin-left: auto;
      font-size: 10px;
      color: var(--fg-faint);
      background: var(--bg);
      padding: 1px 6px;
      border-radius: 8px;
    }
    .header-menu-sep {
      border: none;
      border-top: 1px solid var(--bg-rule);
      margin: 2px 6px;
    }
    @keyframes pulse {
      0%   { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.45); }
      70%  { box-shadow: 0 0 0 6px rgba(74, 222, 128, 0); }
      100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
    }

    /* ---------- TRANSCRIPT ---------- */
    main {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 18px 0 8px;
      scroll-behavior: smooth;
    }
    main::-webkit-scrollbar { width: 6px; }
    main::-webkit-scrollbar-track { background: transparent; }
    main::-webkit-scrollbar-thumb { background: var(--bg-rule); border-radius: 3px; }
    main::-webkit-scrollbar-thumb:hover { background: var(--fg-faint); }

    main > .empty {
      padding: 80px 24px 60px;
      color: var(--fg-faint);
      font-size: 11px;
      text-align: center;
      letter-spacing: 0.06em;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .empty .glyph {
      color: var(--accent);
      font-size: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      margin-bottom: 8px;
      font-weight: 800;
      font-family: 'Segoe UI', system-ui, sans-serif;
      letter-spacing: -0.02em;
    }
    .empty .empty-title {
      color: var(--fg);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .empty .empty-sub {
      color: var(--fg-dim);
      font-size: 11.5px;
      line-height: 1.5;
      max-width: 260px;
      letter-spacing: 0;
    }
    .empty .hint {
      margin-top: 14px;
      color: var(--fg-dim);
      font-size: 10px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
    }

    /* Offline banner when bridge is not connected */
    .offline-banner { padding-top: 80px; }
    .offline-title {
      display: block;
      color: var(--accent);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    .offline-hint {
      display: block;
      color: var(--fg-dim);
      font-size: 11px;
      line-height: 1.6;
      letter-spacing: 0.04em;
    }
    .offline-hint code {
      background: var(--bg-bubble);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 10px;
    }

    .msg {
      padding: 8px 16px 10px;
      animation: slideIn 280ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .msg.assistant.continuation {
      padding-top: 2px;
      padding-bottom: 4px;
    }
    .msg.assistant.continuation .meta { display: none; }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .msg .meta {
      display: flex; align-items: center; gap: 8px;
      font-size: 11px;
      color: var(--fg-faint);
      margin-bottom: 4px;
    }
    .msg .meta .avatar {
      width: 22px; height: 22px;
      border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
      background: var(--bg-rule);
      color: var(--fg-dim);
    }
    .msg.user .meta .avatar { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
    .msg.assistant .meta .avatar { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #6ee7b7)); color: #fff; }
    .msg.assistant .meta .avatar .avatar-icon { width: 14px; height: 14px; display: block; }
    .msg .meta .role { color: var(--fg-dim); font-weight: 600; font-size: 11.5px; letter-spacing: 0.03em; }
    .msg.user   .meta .role { color: var(--fg); }
    .msg.system .meta .role { color: var(--fg-faint); }
    .msg .meta .rule {
      flex: 1; height: 0; background: transparent;
    }
    .msg .meta .ts { color: var(--fg-faint); font-size: 10px; }

    .bubble {
      padding: 8px 12px;
      background: transparent;
      border-left: none;
      border-radius: 10px;
      color: var(--fg);
      word-wrap: break-word;
    }
    .msg.user .bubble {
      padding: 10px 14px;
      background: var(--accent-soft);
      border-radius: 10px;
      line-height: 1.5;
      border: 1px solid color-mix(in srgb, var(--accent) 15%, transparent);
    }
    .msg.system .bubble {
      background: transparent;
      color: var(--fg-dim);
      font-size: 12px;
      white-space: pre-wrap;
    }
    .msg.system.error .bubble {
      color: var(--error, #f87171);
      background: color-mix(in srgb, var(--error, #f87171) 8%, transparent);
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--error, #f87171) 18%, transparent);
    }
    .msg.system.pong .bubble {
      color: var(--accent);
      font-weight: 700;
    }

    /* tool call cards (inline in assistant messages, like VS Code Copilot) */
    .toolcalls { display: flex; flex-direction: column; gap: 4px; margin: 0 0 4px; }
    .intent-line {
      color: var(--fg-dim);
      font-style: italic;
      font-size: 11.5px;
      padding: 1px 2px 3px;
      letter-spacing: 0.01em;
      opacity: 0.85;
    }
    .intent-line + .intent-line { display: none; } /* dedupe consecutive */

    /* Pre-streaming "thinking" indicator — animated dots like VS Code Copilot.
       Shown when an assistant turn has started but no tokens or tool calls
       have arrived yet. Intent text replaces default label when available. */
    .thinking {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 2px 0 4px 2px;
      padding: 0;
      color: var(--fg-dim);
      font-size: 12px;
    }
    .thinking-dots {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .thinking-dots span {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--fg-dim);
      animation: thinkingBounce 1.4s ease-in-out infinite;
    }
    .thinking-dots span:nth-child(1) { animation-delay: 0s; }
    .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes thinkingBounce {
      0%, 80%, 100% { opacity: 0.25; transform: scale(1); }
      40% { opacity: 1; transform: scale(1.3); }
    }
    .thinking-text {
      color: var(--fg-dim);
      font-weight: 400;
      font-size: 12px;
    }
    .toolcall {
      border: 1px solid var(--bg-rule);
      background: var(--bg-soft);
      border-radius: 10px;
      font-family: var(--mono);
      font-size: 11px;
      cursor: pointer;
      user-select: none;
      overflow: hidden;
      transition: border-color 200ms ease, box-shadow 200ms ease;
    }
    .toolcall:hover {
      border-color: color-mix(in srgb, var(--accent) 30%, transparent);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    }
    .toolcall .tc-head {
      display: flex; align-items: baseline; gap: 8px;
      padding: 4px 8px;
      line-height: 1.4;
    }
    .toolcall .tc-icon { color: var(--fg-dim); width: 10px; display: inline-block; }
    .toolcall .tc-name { color: var(--strong); font-weight: 700; }
    .toolcall .tc-args { color: var(--fg-dim); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toolcall .tc-status { color: var(--fg-faint); font-variant-numeric: tabular-nums; }
    .toolcall.running .tc-icon { color: var(--accent); animation: tc-spin 1s linear infinite; }
    .toolcall.success .tc-icon { color: var(--success, #4ade80); }
    .toolcall.error   .tc-icon { color: var(--error, #f87171); }
    .toolcall.error   { border-color: var(--error, #f87171); }
    .toolcall .tc-detail {
      border-top: 1px solid var(--border);
      padding: 6px 8px;
      max-height: 240px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--fg);
      background: var(--bg);
    }
    .toolcall .tc-detail .tc-section { color: var(--fg-faint); margin-top: 6px; font-weight: 700; letter-spacing: 0.08em; }
    .toolcall .tc-detail .tc-section:first-child { margin-top: 0; }
    .toolcall .tc-detail .tc-partial {
      margin: 2px 0 0;
      font-size: 11px;
      line-height: 1.4;
      max-height: 120px;
      overflow-y: auto;
      color: var(--fg-faint);
      white-space: pre-wrap;
      word-break: break-word;
    }
    @keyframes tc-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    /* markdown inside bubbles */
    .bubble :first-child { margin-top: 0; }
    .bubble :last-child  { margin-bottom: 0; }
    .bubble p { margin: 0 0 8px; }
    .bubble strong { color: var(--strong); font-weight: 700; }
    .bubble em { color: var(--fg-dim); font-style: normal; text-decoration: underline; text-decoration-color: var(--fg-faint); }
    .bubble code {
      font-family: var(--mono);
      background: color-mix(in srgb, var(--accent) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 16%, transparent);
      border-radius: 5px;
      padding: 1px 5px;
      color: var(--fg);
      font-size: 0.85em;
    }
    .bubble pre {
      font-family: var(--mono);
      background: var(--code-bg);
      border-radius: 10px;
      border: 1px solid var(--bg-rule);
      padding: 14px 16px;
      margin: 8px 0;
      overflow-x: auto;
      font-size: 12px;
    }
    .bubble pre code {
      font-family: var(--mono);
      background: transparent;
      border: 0;
      padding: 0;
      color: var(--code-fg);
    }
    .bubble ul, .bubble ol { margin: 6px 0 8px; padding-left: 22px; }
    .bubble li { margin: 2px 0; }
    .bubble li::marker { color: var(--accent); }
    .bubble a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
    .bubble h1, .bubble h2, .bubble h3 {
      font-size: 12.5px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      color: var(--fg);
      margin: 12px 0 6px;
      border-bottom: 1px solid var(--bg-rule);
      padding-bottom: 3px;
    }
    .bubble blockquote {
      border-left: 2px solid var(--fg-faint);
      padding-left: 10px;
      margin: 6px 0;
      color: var(--fg-dim);
    }
    .bubble hr { border: none; border-top: 1px dashed var(--bg-rule); margin: 12px 0; }

    .caret {
      display: inline-block;
      width: 2px; height: 14px;
      background: var(--accent);
      vertical-align: -2px;
      margin-left: 2px;
      border-radius: 1px;
      animation: caretBlink 1.1s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    @keyframes caretBlink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    /* ---------- COMPOSER ---------- */
    footer {
      display: flex;
      flex-direction: column;
      border-top: 1px solid var(--bg-rule);
      background: var(--bg);
      flex: 0 0 auto;
      position: relative;
      padding: 6px 10px;
    }
    .new-activity-btn {
      align-self: center;
      margin: 0 0 6px;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
      background: color-mix(in srgb, var(--accent) 14%, var(--bg));
      color: var(--fg);
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      transition: border-color 120ms ease, transform 120ms ease;
    }
    .new-activity-btn:hover {
      border-color: var(--accent);
      transform: translateY(-1px);
    }
    .composer-row {
      display: flex;
      flex-direction: column;
      position: relative;
      border: 1px solid var(--bg-rule);
      border-radius: 16px;
      background: var(--bg-soft);
      padding: 4px 6px;
      transition: border-color 200ms ease, box-shadow 200ms ease;
    }
    .composer-row:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
    }
    .composer-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 0 2px 0;
      min-height: 28px;
      position: relative;
    }
    .composer-spacer { flex: 1 1 auto; }
    .composer-pill-btn {
      font-size: 11px;
      color: var(--fg-dim);
      padding: 2px 8px;
      border-radius: 8px;
      background: var(--bg);
      border: 1px solid var(--bg-rule);
      cursor: pointer;
      white-space: nowrap;
      font-family: inherit;
      line-height: 1.3;
      transition: color 120ms ease, border-color 120ms ease;
    }
    .composer-pill-btn:hover { color: var(--fg); border-color: var(--accent); }
    .model-pill-btn {
      font-size: 11px;
      color: var(--fg-dim);
      padding: 2px 8px;
      border-radius: 8px;
      background: var(--bg);
      border: 1px solid var(--bg-rule);
      cursor: pointer;
      white-space: nowrap;
      font-family: inherit;
      line-height: 1.3;
      transition: color 120ms ease, border-color 120ms ease;
    }
    .model-pill-btn:hover { color: var(--fg); border-color: var(--accent); }
    .model-menu {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 30px;
      min-width: 240px;
      max-width: 300px;
      background: var(--bg-soft);
      border: 1px solid var(--bg-rule);
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      padding: 4px;
      z-index: 35;
      animation: attachMenuIn 0.12s ease-out;
    }
    .model-menu-header {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--fg-faint);
      padding: 6px 10px 4px;
    }
    .model-menu-sep {
      border: none;
      border-top: 1px solid var(--bg-rule);
      margin: 2px 6px;
    }
    .model-menu-item {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      width: 100%;
      text-align: left;
      background: transparent;
      border: none;
      padding: 6px 10px;
      font-size: 12px;
      font-family: inherit;
      color: var(--fg);
      cursor: pointer;
      border-radius: 6px;
      transition: background 100ms ease;
    }
    .model-menu-item:hover { background: var(--bg-bubble); }
    .model-menu-item.active { color: var(--accent); }
    .model-menu-check {
      flex: 0 0 16px;
      text-align: center;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.4;
      color: var(--accent);
    }
    .model-menu-info {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .model-menu-name {
      font-size: 12.5px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .model-menu-detail {
      font-size: 10px;
      color: var(--fg-faint);
      white-space: nowrap;
    }
    .model-menu-empty {
      padding: 8px 10px;
      font-size: 11px;
      color: var(--fg-faint);
      font-style: italic;
    }

    /* ── Workspace pill & menu ──────────────────────────── */
    .workspace-pill-btn {
      font-size: 11px;
      color: var(--fg-dim);
      padding: 2px 8px;
      border-radius: 8px;
      background: var(--bg);
      border: 1px solid var(--bg-rule);
      cursor: pointer;
      white-space: nowrap;
      font-family: inherit;
      line-height: 1.3;
      transition: color 120ms ease, border-color 120ms ease;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .workspace-pill-btn:hover { color: var(--fg); border-color: var(--accent); }
    .workspace-menu {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 30px;
      min-width: 220px;
      max-width: 320px;
      background: var(--bg-soft);
      border: 1px solid var(--bg-rule);
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      padding: 4px;
      z-index: 35;
      animation: attachMenuIn 0.12s ease-out;
    }
    .workspace-menu-header {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--fg-faint);
      padding: 6px 10px 4px;
    }
    .workspace-menu-current {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 10px;
      font-size: 12px;
      color: var(--fg);
    }
    .workspace-menu-path {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .workspace-menu-clear {
      background: none;
      border: none;
      color: var(--fg-faint);
      cursor: pointer;
      font-size: 12px;
      padding: 2px 4px;
      border-radius: 4px;
      margin-left: 6px;
      flex-shrink: 0;
    }
    .workspace-menu-clear:hover { color: var(--fg); background: var(--bg-bubble); }
    .workspace-menu-fullpath {
      display: block;
      font-size: 10px;
      color: var(--fg-faint);
      padding: 0 10px 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .workspace-menu-sep {
      border: none;
      border-top: 1px solid var(--bg-rule);
      margin: 2px 8px;
    }
    .workspace-menu-item {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--fg-dim);
      background: none;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      text-align: left;
    }
    .workspace-menu-item:hover { background: var(--bg-bubble); color: var(--fg); }
    .workspace-menu-icon { font-size: 13px; flex-shrink: 0; }

    /* ── Approval banner ────────────────────────────────── */
    .approval-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--bg-soft);
      border: 1px solid #d4a017;
      border-radius: 8px;
      margin: 0 8px 6px;
      animation: attachMenuIn 0.15s ease-out;
    }
    .approval-icon { font-size: 16px; flex-shrink: 0; }
    .approval-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .approval-tool {
      font-size: 12px;
      font-weight: 600;
      color: var(--fg);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .approval-kind {
      font-size: 10px;
      color: var(--fg-faint);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .approval-btn {
      font-size: 11px;
      font-family: inherit;
      padding: 3px 10px;
      border-radius: 6px;
      cursor: pointer;
      border: 1px solid var(--bg-rule);
      transition: background 120ms ease, color 120ms ease;
      flex-shrink: 0;
    }
    .approval-btn.approve {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .approval-btn.approve:hover { filter: brightness(1.15); }
    .approval-btn.deny {
      background: var(--bg);
      color: var(--fg-dim);
    }
    .approval-btn.deny:hover { background: var(--bg-bubble); color: var(--fg); }

    /* ── Approval toggle in tools panel ─────────────────── */
    .tools-approval-row {
      padding: 4px 8px 2px;
      border-bottom: 1px solid var(--bg-rule);
    }
    .approval-toggle .tool-desc {
      font-style: italic;
    }
    .attach-menu-item.selected { color: var(--accent); font-weight: 500; }
    .ac-popup {
      position: absolute;
      bottom: 100%;
      left: 8px;
      right: 8px;
      max-height: 260px;
      overflow-y: auto;
      background: var(--bg-soft);
      border: 1px solid var(--bg-rule);
      border-radius: 12px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
      margin-bottom: 6px;
      font-size: 13px;
      z-index: 30;
    }
    .ac-head, .ac-foot {
      padding: 4px 10px;
      color: var(--fg-dim);
      font-size: 11px;
      letter-spacing: 0.02em;
    }
    .ac-head {
      border-bottom: 1px solid var(--bg-rule);
      text-transform: uppercase;
    }
    .ac-head em { color: var(--fg); font-style: normal; }
    .ac-foot {
      border-top: 1px solid var(--bg-rule);
      text-align: right;
    }
    .ac-item {
      display: grid;
      grid-template-columns: minmax(120px, max-content) 1fr;
      gap: 12px;
      padding: 6px 10px 6px 8px;
      cursor: pointer;
      align-items: baseline;
      border-left: 2px solid transparent;
    }
    .ac-item--sel {
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      border-left-color: var(--accent);
    }
    .ac-item--sel .ac-tok { color: var(--accent); font-weight: 700; }
    .ac-item--sel .ac-desc { color: var(--fg); }
    .ac-tok {
      font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;
      color: var(--fg);
    }
    .ac-desc {
      color: var(--fg-dim);
    }

    /* Recognised @-mentions in the user bubble. */
    .msg.user .mention {
      color: var(--accent);
      background: var(--accent-soft);
      border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
      border-radius: 3px;
      padding: 0 4px;
      font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;
      font-size: 0.92em;
      white-space: nowrap;
    }
    /* ---------- CONTEXT ATTACHMENT STRIP ---------- */
    .ctx-strip {
      padding: 6px 10px;
      border-bottom: 1px dashed var(--bg-rule);
      background: color-mix(in srgb, var(--accent) 5%, var(--bg));
      animation: ctxStripIn 0.2s ease-out;
    }
    @keyframes ctxStripIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .ctx-strip-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .ctx-strip-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--fg-soft, var(--fg));
      opacity: 0.6;
    }
    .ctx-clear-btn {
      background: transparent;
      border: none;
      color: var(--fg-soft, var(--fg));
      font-size: 10px;
      cursor: pointer;
      opacity: 0.5;
      padding: 0 2px;
      font-family: inherit;
    }
    .ctx-clear-btn:hover { opacity: 1; color: var(--accent); }
    .ctx-chip {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 8px;
      margin-bottom: 3px;
      border-radius: 8px;
      background: var(--bg-soft);
      border: 1px solid var(--bg-rule);
      font-size: 12px;
      color: var(--fg-soft, var(--fg));
      animation: ctxStripIn 0.15s ease-out;
    }
    .ctx-chip-icon { font-size: 12px; flex-shrink: 0; }
    .ctx-chip-label {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .ctx-chip-x {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      border: 0;
      background: transparent;
      color: var(--fg-soft, var(--fg));
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
      padding: 0;
      opacity: 0.5;
      border-radius: 3px;
    }
    .ctx-chip-x:hover { opacity: 1; background: var(--bg-rule); }

    /* ---------- ＋ ATTACH / TOOLS / MODEL MENU ---------- */
    .attach-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid var(--bg-rule);
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      width: 26px;
      height: 26px;
      margin: 0;
      padding: 0;
      border-radius: 6px;
      color: var(--fg-dim);
      line-height: 1;
      transition: color 0.12s, background 0.12s, border-color 0.12s;
      flex-shrink: 0;
    }
    .attach-btn:hover { color: var(--fg); background: var(--bg-bubble); border-color: var(--accent); }
    .attach-menu {
      position: absolute;
      bottom: 100%;
      left: 6px;
      margin-bottom: 4px;
      background: var(--bg-soft);
      border: 1px solid var(--bg-rule);
      border-radius: 10px;
      padding: 4px;
      z-index: 20;
      min-width: 220px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      animation: attachMenuIn 0.12s ease-out;
    }
    @keyframes attachMenuIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .attach-menu-section {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--fg-faint);
      padding: 6px 10px 3px;
    }
    .attach-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      text-align: left;
      background: transparent;
      border: none;
      padding: 6px 10px;
      font-size: 12.5px;
      font-family: inherit;
      color: var(--fg);
      cursor: pointer;
      white-space: nowrap;
      border-radius: 6px;
      transition: background 100ms ease;
    }
    .attach-menu-item:hover { background: var(--bg-bubble); }
    .attach-menu-info { cursor: default; opacity: 0.7; }
    .attach-menu-info:hover { background: transparent; }
    .attach-menu-icon { flex: 0 0 18px; text-align: center; font-size: 13px; }
    .attach-menu-badge {
      margin-left: auto;
      font-size: 10px;
      color: var(--fg-faint);
      background: var(--bg);
      padding: 1px 6px;
      border-radius: 8px;
    }
    .attach-menu-sep {
      border: none;
      border-top: 1px solid var(--bg-rule);
      margin: 2px 6px;
    }
    .attach-menu-div {
      border: none;
      border-top: 1px solid var(--bg-rule);
      margin: 4px 0;
    }

    /* ---------- BUBBLE ACTION ICONS (copy / insert / append) ---------- */
    .bubble-actions {
      display: flex;
      justify-content: flex-end;
      gap: 2px;
      margin-top: 6px;
      padding-top: 4px;
      border-top: 1px solid color-mix(in srgb, var(--fg) 8%, transparent);
      opacity: 0;
      transition: opacity 0.15s;
    }
    .bubble:hover .bubble-actions { opacity: 1; }
    .bubble-action-btn {
      background: transparent;
      border: none;
      border-radius: 3px;
      padding: 2px 6px;
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
      color: var(--fg-soft, var(--fg));
      opacity: 0.6;
      transition: opacity 0.12s, background 0.12s;
    }
    .bubble-action-btn:hover {
      opacity: 1;
      background: color-mix(in srgb, var(--fg) 10%, transparent);
    }

    /* ---------- CONTEXT CHIPS IN USER BUBBLES ---------- */
    .msg-ctx-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .msg-ctx-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 8px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      color: var(--accent);
      font-size: 10.5px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 220px;
      line-height: 1.4;
      letter-spacing: 0.2px;
    }
    .msg-ctx-chip-thumb {
      width: 18px;
      height: 18px;
      object-fit: cover;
      border-radius: 3px;
      flex-shrink: 0;
    }

    .msg-text { white-space: pre-wrap; }
    .sigil {
      display: none;
    }
    textarea {
      resize: none;
      min-height: 38px;
      max-height: 160px;
      background: transparent;
      color: transparent;
      -webkit-text-fill-color: transparent;
      border: none;
      padding: 10px 8px;
      font-family: var(--sans);
      font-size: 13px;
      line-height: 1.5;
      outline: none;
      caret-color: var(--accent);
      position: relative;
      z-index: 1;
      width: 100%;
      display: block;
    }
    textarea::placeholder { color: var(--fg-faint); -webkit-text-fill-color: var(--fg-faint); }
    /* When user selects text in the (transparent) textarea, the browser would
       normally show only the selection rectangle. Force the selection to also
       paint the text in a contrasting colour so it stays readable. */
    textarea::selection {
      background: color-mix(in srgb, var(--accent) 35%, transparent);
      color: var(--fg);
      -webkit-text-fill-color: var(--fg);
    }

    /* ---------- COMPOSER HIGHLIGHT OVERLAY ---------- */
    /* The textarea is rendered with transparent text on top of a mirror div
       that holds the same text wrapped in span.mention for any recognised
       at-token. The mirror is purely visual; clicks/selection still hit the
       textarea. Padding / font-metrics MUST match exactly. */
    .composer-input {
      position: relative;
      display: block;
      min-width: 0;
    }
    .composer-mirror {
      position: absolute;
      inset: 0;
      padding: 10px 8px;
      font-family: var(--sans);
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      word-break: break-word;
      color: var(--fg);
      pointer-events: none;
      user-select: none;
      overflow: hidden;
      z-index: 0;
    }
    /* IMPORTANT: do NOT add padding/border/margin/font-weight to this rule —
       any width change vs. the un-decorated character would shift the
       textarea/mirror alignment by even a sub-pixel and the overlay would
       drift. Colour-only highlight keeps the glyph metrics identical. */
    .composer-mirror .mention {
      color: var(--accent);
      background: var(--accent-soft);
      border-radius: 2px;
    }

    .send-btn {
      display: flex; align-items: center; justify-content: center;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 8px;
      width: 28px; height: 28px;
      margin: 0;
      padding: 0;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      transition: background 200ms ease, opacity 200ms ease, transform 150ms ease;
      flex-shrink: 0;
    }
    .send-btn:hover { background: color-mix(in srgb, var(--accent) 85%, #fff); transform: scale(1.05); }
    .send-btn .kbd { display: none; }
    .send-btn:disabled {
      opacity: 0.25;
      cursor: default;
    }
    .send-btn:disabled:hover { background: var(--accent); transform: none; }

    /* ---------- VOICE I/O ---------- */
    .voice-notice {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 0 0 6px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--fg);
      background: color-mix(in srgb, var(--error) 12%, var(--bg-soft));
      border: 1px solid color-mix(in srgb, var(--error) 35%, transparent);
      border-radius: 8px;
    }
    .voice-notice-x {
      background: transparent;
      border: none;
      color: var(--fg-dim);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 4px;
      flex: 0 0 auto;
    }
    .voice-notice-x:hover { color: var(--fg); }
    .mic-btn {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: 1px solid var(--bg-rule);
      background: transparent;
      color: var(--fg-dim);
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      flex-shrink: 0;
    }
    .mic-btn:hover { color: var(--fg); border-color: var(--accent); }
    .mic-btn.listening {
      color: var(--error);
      border-color: var(--error);
      background: rgba(248, 81, 73, 0.1);
      animation: mic-pulse 1.5s ease-in-out infinite;
    }
    @keyframes mic-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(248, 81, 73, 0.3); }
      50% { box-shadow: 0 0 0 6px rgba(248, 81, 73, 0); }
    }

    /* ---------- TTS PLAYBACK (inline toggle) ---------- */
    .tts-bar-toggle {
      background: transparent;
      border: 1px solid var(--bg-rule);
      color: var(--fg-faint);
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 5px;
      cursor: pointer;
      transition: color 150ms, background 150ms, border-color 150ms;
    }
    .tts-bar-toggle:hover { color: var(--fg-dim); background: var(--bg-bubble); }
    .tts-bar-toggle.on {
      color: var(--accent);
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
      background: color-mix(in srgb, var(--accent) 8%, transparent);
    }

    /* Speed +/- in menu */
    .speed-btn {
      background: transparent;
      border: 1px solid var(--bg-rule);
      color: var(--fg-dim);
      width: 20px; height: 18px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      margin: 0 2px;
    }
    .speed-btn:hover { color: var(--fg); background: var(--bg-bubble); }
    .speed-value {
      font-size: 11px;
      color: var(--fg-dim);
      min-width: 34px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .header-menu-item.sub {
      padding-left: 28px;
      font-size: 11px;
      color: var(--fg-dim);
    }
    .header-menu-item.sub:hover { color: var(--fg); }
    .header-menu-label {
      display: block;
      padding: 4px 12px 2px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--fg-dim);
      opacity: 0.7;
    }

    /* ---------- DEBUG PANEL ---------- */
    .debug {
      border-bottom: 1px solid var(--bg-rule);
      background: var(--bg-soft);
      max-height: 40vh;
      display: flex;
      flex-direction: column;
      font-size: 11px;
    }
    .debug-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--bg-rule);
      color: var(--fg-dim);
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .debug-bar .grow { flex: 1; }
    .debug-bar button {
      background: transparent;
      color: var(--fg-dim);
      border: 1px solid var(--bg-rule);
      padding: 2px 8px;
      cursor: pointer;
      font-family: inherit;
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .debug-bar button:hover { color: var(--accent); border-color: var(--accent); }
    .debug-bar button.active {
      color: var(--fg);
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 14%, transparent);
    }
    .debug-path {
      padding: 4px 12px;
      color: var(--fg-faint);
      border-bottom: 1px solid var(--bg-rule);
      font-size: 10px;
      word-break: break-all;
      cursor: pointer;
    }
    .debug-path:hover { color: var(--accent); }
    .debug-list {
      flex: 1;
      overflow: auto;
      padding: 4px 0;
    }
    .debug-row {
      display: grid;
      grid-template-columns: 70px 36px 1fr;
      gap: 8px;
      padding: 2px 12px;
      border-bottom: 1px dashed transparent;
      cursor: pointer;
      line-height: 1.5;
    }
    .debug-row:hover { background: var(--bg-bubble); }
    .debug-row.no-detail { cursor: default; }
    .debug-row.synthetic .summary { color: var(--fg-dim); font-style: italic; }
    .debug-row .ts { color: var(--fg-faint); font-variant-numeric: tabular-nums; }
    .debug-row .tag {
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .debug-row.in   .tag { color: #4ec9b0; }
    .debug-row.out  .tag { color: #569cd6; }
    .debug-row.log  .tag { color: var(--fg-dim); }
    .debug-row.warn .tag { color: #d7ba7d; }
    .debug-row.error .tag { color: var(--accent); }
    .debug-row.error .summary,
    .debug-row.warn .summary { color: var(--fg); }
    .debug-row .summary {
      color: var(--fg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .debug-row.expanded {
      grid-template-columns: 70px 36px 1fr;
    }
    .debug-row.expanded .summary { white-space: pre-wrap; word-break: break-word; }
    .debug-detail {
      grid-column: 3 / 4;
      margin-top: 2px;
      padding: 6px 8px;
      background: var(--code-bg);
      color: var(--code-fg);
      white-space: pre-wrap;
      word-break: break-word;
      border-left: 2px solid var(--accent);
    }
    .debug-empty {
      padding: 12px;
      color: var(--fg-faint);
      text-align: center;
      font-style: italic;
    }

    /* ---------- TOOLS SETTINGS PANEL ---------- */
    .tools-panel {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 0;
      right: 0;
      background: var(--bg-soft);
      border: 1px solid var(--bg-rule);
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.35);
      max-height: 50vh;
      display: flex;
      flex-direction: column;
      font-size: 12px;
      overflow: hidden;
      z-index: 30;
      animation: attachMenuIn 0.12s ease-out;
    }
    .tools-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--bg-rule);
      color: var(--fg-dim);
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .tools-bar .grow { flex: 1; }
    .tools-bar button {
      background: transparent;
      color: var(--fg-dim);
      border: 1px solid var(--bg-rule);
      padding: 2px 8px;
      cursor: pointer;
      font-family: inherit;
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      border-radius: 4px;
    }
    .tools-bar button:hover { color: var(--accent); border-color: var(--accent); }
    .tools-hint {
      padding: 4px 12px;
      color: var(--fg-faint);
      font-size: 10px;
      font-style: italic;
      border-bottom: 1px solid var(--bg-rule);
    }
    .tools-groups {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    /* group header */
    .tool-group { border-bottom: 1px solid var(--bg-rule); }
    .tool-group:last-child { border-bottom: none; }
    .tool-group-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      cursor: pointer;
      user-select: none;
    }
    .tool-group-header:hover { background: var(--bg-bubble); }
    .tool-group-chevron {
      flex: 0 0 12px;
      font-size: 10px;
      color: var(--fg-faint);
    }
    .tool-group-icon { flex: 0 0 auto; font-size: 13px; }
    .tool-group-label {
      flex: 1 1 auto;
      font-weight: 600;
      font-size: 11.5px;
      color: var(--fg);
    }
    .tool-group-count {
      flex: 0 0 auto;
      color: var(--fg-faint);
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }
    .tool-group-toggle {
      flex: 0 0 auto;
      background: transparent;
      border: 1px solid var(--bg-rule);
      color: var(--fg-dim);
      padding: 1px 6px;
      font-family: inherit;
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      border-radius: 4px;
      cursor: pointer;
    }
    .tool-group-toggle:hover { border-color: var(--accent); color: var(--accent); }
    .tool-group-toggle.on { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
    .tool-group-toggle.off { color: var(--fg-faint); }
    .tool-group-toggle.partial { color: #d6a85d; border-color: color-mix(in srgb, #d6a85d 40%, transparent); }

    /* group body — individual tools */
    .tool-group-body { padding: 2px 12px 6px 30px; }
    .tool-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 0;
      cursor: pointer;
    }
    .tool-item:hover { color: var(--fg); }
    .tool-item.disabled .tool-name { color: var(--fg-faint); }
    .tool-item.disabled .tool-desc { color: var(--fg-faint); opacity: 0.6; }

    /* toggle switch */
    .tool-switch {
      flex: 0 0 auto;
      position: relative;
      display: inline-block;
      width: 28px;
      height: 16px;
    }
    .tool-switch input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }
    .tool-slider {
      position: absolute;
      inset: 0;
      background: var(--bg-rule);
      border-radius: 8px;
      transition: background 200ms ease;
    }
    .tool-slider::before {
      content: '';
      position: absolute;
      left: 2px;
      top: 2px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--fg-dim);
      transition: transform 200ms ease, background 200ms ease;
    }
    .tool-switch input:checked + .tool-slider {
      background: color-mix(in srgb, var(--accent) 35%, transparent);
    }
    .tool-switch input:checked + .tool-slider::before {
      transform: translateX(12px);
      background: var(--accent);
    }

    .tool-info {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .tool-name {
      font-size: 12px;
      font-weight: 500;
      color: var(--fg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tool-desc {
      font-size: 10px;
      color: var(--fg-dim);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ---- chat title pill in header ---- */
    .chat-title-pill {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 600;
      color: var(--fg);
      cursor: pointer;
      padding: 3px 6px;
      border: 1px solid transparent;
      border-radius: 6px;
    }
    .chat-title-pill:hover { background: var(--bg-soft); color: var(--accent); }
    .chat-title-edit {
      flex: 1 1 auto;
      min-width: 0;
      background: var(--bg-soft);
      color: var(--fg);
      border: 1px solid var(--accent);
      border-radius: 6px;
      padding: 3px 6px;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      outline: none;
    }

    /* ---- chat drawer (B4) ---- */
    .drawer-scrim {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 50;
    }
    .drawer {
      position: fixed;
      top: 0; left: 0; bottom: 0;
      width: min(320px, 80vw);
      background: var(--bg-soft);
      border-right: 1px solid var(--bg-rule);
      z-index: 51;
      display: flex;
      flex-direction: column;
      box-shadow: 4px 0 12px rgba(0, 0, 0, 0.5);
    }
    .drawer-head {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--bg-rule);
    }
    .drawer-title {
      flex: 1;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: var(--fg-dim);
      font-size: 11px;
    }
    .drawer-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px 0;
    }
    .chat-row {
      display: grid;
      grid-template-columns: 1fr;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      cursor: pointer;
      border-left: 2px solid transparent;
      position: relative;
    }
    .chat-row:hover { background: var(--bg-bubble); }
    .chat-row.current { border-left-color: var(--accent); background: var(--accent-soft); }
    .chat-row .chat-title {
      grid-column: 1 / 2;
      grid-row: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--fg);
    }
    .chat-row .chat-meta {
      grid-column: 1 / 2;
      grid-row: 2;
      font-size: 10px;
      color: var(--fg-faint);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat-actions {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 120ms ease;
      z-index: 1;
    }
    .chat-actions .icon-btn {
      opacity: 1;
      transform: none;
    }
    .chat-row:hover .chat-actions,
    .chat-row.current .chat-actions,
    .chat-row:focus-within .chat-actions {
      opacity: 1;
      pointer-events: auto;
    }
    .chat-row:hover .chat-title,
    .chat-row.current .chat-title,
    .chat-row:focus-within .chat-title,
    .chat-row:hover .chat-meta,
    .chat-row.current .chat-meta,
    .chat-row:focus-within .chat-meta {
      padding-right: 88px;
    }
    .drawer-section {
      border-top: 1px solid var(--bg-rule);
      padding: 8px 12px;
      max-height: 40%;
      overflow-y: auto;
    }
    .drawer-section-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: var(--fg-dim);
      margin-bottom: 6px;
    }
    .qp-btn {
      display: flex;
      flex-direction: column;
      gap: 1px;
      width: 100%;
      text-align: left;
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--bg-rule);
      padding: 6px 8px;
      margin-bottom: 4px;
      font: inherit;
      font-size: 11px;
      cursor: pointer;
      border-radius: 6px;
    }
    .qp-btn:hover { border-color: var(--accent); color: var(--accent); }
    .qp-label {
      font-weight: 600;
      color: var(--fg);
      font-size: 11.5px;
      line-height: 1.35;
    }
    .qp-hint {
      color: var(--fg-faint);
      font-size: 10px;
      line-height: 1.35;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ---- search overlay (C4) ---- */
    .search-scrim {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 60;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 10vh;
    }
    .search-box {
      width: min(560px, 92vw);
      background: var(--bg-soft);
      border: 1px solid var(--accent);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
      max-height: 70vh;
    }
    .search-input-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      border-bottom: 1px solid var(--bg-rule);
      background: var(--bg-bubble);
    }
    .search-icon { color: var(--fg-faint); font-size: 14px; }
    .search-input {
      flex: 1;
      background: transparent;
      color: var(--fg);
      border: none;
      padding: 12px 0;
      font: inherit;
      font-size: 13px;
      outline: none;
    }
    .search-count {
      color: var(--fg-faint);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .search-results { overflow-y: auto; }
    .search-row {
      padding: 8px 14px;
      border-bottom: 1px solid var(--bg-rule);
      cursor: pointer;
    }
    .search-row.active,
    .search-row:hover { background: var(--bg-bubble); }
    .search-row-head {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .search-row-title {
      color: var(--strong);
      font-weight: 600;
      font-size: 12.5px;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .search-row-where {
      color: var(--fg-faint);
      font-size: 9.5px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 1px 5px;
      border: 1px solid var(--bg-rule);
      border-radius: 2px;
    }
    .search-row-meta {
      color: var(--fg-faint);
      font-size: 10.5px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .search-row-snippet {
      color: var(--fg-dim);
      font-size: 11px;
      margin-top: 3px;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.45;
    }
    .search-row mark.hl,
    .search-row .hl {
      background: color-mix(in srgb, var(--accent) 32%, transparent);
      color: var(--strong);
      padding: 0 1px;
      border-radius: 2px;
    }
    .search-hint {
      padding: 16px;
      color: var(--fg-faint);
      text-align: center;
      font-size: 11px;
    }
    .search-hint .kbd {
      display: inline-block;
      margin: 0 4px;
      padding: 0 4px;
      border: 1px solid var(--bg-rule);
      border-radius: 2px;
      font-size: 10px;
      color: var(--fg-dim);
    }

    /* ---- D1 pinned + D6 tags + D7 stats ---- */
    .icon-btn.active { color: var(--accent); }
    .drawer-subtitle {
      padding: 6px 12px 2px;
      font-size: 9px;
      letter-spacing: 0.12em;
      color: var(--fg-faint);
      font-weight: 700;
    }
    .drawer-tagbar {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--bg-rule);
    }
    .tag-chip {
      background: transparent;
      border: 1px solid var(--bg-rule);
      color: var(--fg-dim);
      padding: 2px 6px;
      font: inherit;
      font-size: 10px;
      letter-spacing: 0.04em;
      cursor: pointer;
    }
    .tag-chip:hover { border-color: var(--accent); color: var(--accent); }
    .tag-chip.active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    .tag-chip.mini {
      padding: 0 4px;
      margin-left: 4px;
      font-size: 9px;
      cursor: default;
    }

    /* ---- D2 message hover menu ---- */
    .msg-menu-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: var(--fg-faint);
      cursor: pointer;
      font-size: 14px;
      width: 20px;
      height: 20px;
      margin-left: auto;
      padding: 0;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .msg:hover .msg-menu-btn { opacity: 1; }
    .msg-menu-btn:hover { color: var(--accent); }
    .msg-menu {
      display: inline-flex;
      gap: 2px;
      margin-left: 2px;
    }
    .msg-menu button {
      background: var(--bg-bubble);
      border: 1px solid var(--bg-rule);
      color: var(--fg-dim);
      padding: 1px 6px;
      font: inherit;
      font-size: 10px;
      cursor: pointer;
    }
    .msg-menu button:hover { border-color: var(--accent); color: var(--accent); }

    /* ---- D3 stop button ---- */
    .send-btn.stop-primary {
      background: var(--fg-dim);
      color: var(--bg);
      font-size: 10px;
    }
    .send-btn.stop-primary:hover { background: var(--accent); transform: scale(1.05); }

    /* ---- send split-button (visible while streaming) ---- */
    .send-split {
      display: flex;
      align-items: center;
      gap: 0;
      margin: 0;
      position: relative;
    }
    .send-split-chevron {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 28px;
      background: transparent;
      color: var(--fg-dim);
      border: none;
      border-left: 1px solid var(--bg-rule);
      cursor: pointer;
      font-size: 13px;
      padding: 0;
      border-radius: 0 8px 8px 0;
      transition: color 120ms ease, background 120ms ease;
    }
    .send-split-chevron:hover { color: var(--accent); background: var(--bg-soft); }

    /* dropdown menu for send options while streaming */
    .send-menu {
      position: absolute;
      bottom: calc(100% + 6px);
      right: 0;
      min-width: 220px;
      background: var(--bg-soft);
      border: 1px solid var(--bg-rule);
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      padding: 4px;
      z-index: 40;
      display: flex;
      flex-direction: column;
    }
    .send-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      background: transparent;
      color: var(--fg);
      border: none;
      border-radius: 6px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      text-align: left;
      white-space: nowrap;
      transition: background 100ms ease;
    }
    .send-menu-item:hover { background: var(--bg-bubble); }
    .send-menu-item:disabled { opacity: 0.35; cursor: default; }
    .send-menu-item:disabled:hover { background: transparent; }
    .send-menu-icon {
      flex: 0 0 16px;
      text-align: center;
      font-size: 13px;
      color: var(--fg-dim);
    }
    .send-menu-kbd {
      margin-left: auto;
      padding-left: 16px;
      color: var(--fg-faint);
      font-size: 11px;
      font-family: var(--sans);
    }
    .send-menu-sep {
      border: none;
      border-top: 1px solid var(--bg-rule);
      margin: 2px 6px;
    }
  `;

