import { css } from 'lit';

/**
 * Anya sidebar styles.
 * Editorial-brutalist: bone on near-black, signal-red accent, monospace.
 * Extracted from main.ts to keep the component file focused on behaviour.
 */
export const sidebarStyles = css`
    /* ===========================================================
       ANYA / editorial-brutalist chat
       Bone on near-black. Signal-red as the only accent.
       Monospace everything. No rounded corners.
       =========================================================== */
    :host {
      --bg:        #0c0c0c;
      --bg-rule:   #1a1a1a;
      --bg-soft:   #141414;
      --bg-bubble: #131313;
      --fg:        #ebe4d3;       /* bone */
      --fg-dim:    #8a8576;
      --fg-faint:  #4a4740;
      --accent:    #ff3300;       /* signal red */
      --accent-soft: rgba(255, 51, 0, 0.10);
      --grid:      rgba(235, 228, 211, 0.022);
      --strong:    #ffffff;
      --code-bg:   #000000;
      --code-fg:   #ebe4d3;
    }
    :host([theme="light"]) {
      --bg:        #f5f0e6;       /* cream */
      --bg-rule:   #d8d2c4;
      --bg-soft:   #ece6d6;
      --bg-bubble: #ece6d6;
      --fg:        #1a1a1a;       /* ink */
      --fg-dim:    #6b6655;
      --fg-faint:  #aaa498;
      --accent:    #d92e00;
      --accent-soft: rgba(217, 46, 0, 0.08);
      --grid:      rgba(0, 0, 0, 0.025);
      --strong:    #000000;
      --code-bg:   #2b2620;       /* dark brown so red code still pops on cream */
      --code-fg:   #f5f0e6;
    }
    :host {

      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      background:
        linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 22px,
        var(--bg);
      color: var(--fg);
      font-family: 'JetBrains Mono', 'Cascadia Code', 'Consolas', ui-monospace, monospace;
      font-size: 12.5px;
      line-height: 1.55;
      letter-spacing: 0.005em;
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
    .brand {
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-size: 11px;
    }
    .brand .slash { color: var(--accent); padding: 0 2px; }
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
      background: var(--accent);
      box-shadow: 0 0 0 0 rgba(255,51,0,0.5);
      animation: pulse 1.6s ease-out infinite;
    }
    .theme-toggle {
      background: transparent;
      border: 1px solid var(--bg-rule);
      color: var(--fg-dim);
      font: inherit;
      font-size: 10px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      padding: 4px 8px;
      cursor: pointer;
      transition: color 150ms ease, border-color 150ms ease;
    }
    .icon-btn {
      background: transparent;
      border: 1px solid var(--bg-rule);
      color: var(--fg-dim);
      width: 26px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
      transition: color 150ms ease, border-color 150ms ease;
    }
    .icon-btn:hover { color: var(--fg); border-color: var(--fg-faint); }
    .icon-btn.active { color: var(--accent); border-color: var(--accent); }
    .theme-toggle:hover {
      color: var(--accent);
      border-color: var(--accent);
    }
    @keyframes pulse {
      0%   { box-shadow: 0 0 0 0 rgba(255,51,0,0.45); }
      70%  { box-shadow: 0 0 0 6px rgba(255,51,0,0); }
      100% { box-shadow: 0 0 0 0 rgba(255,51,0,0); }
    }

    /* ---------- TRANSCRIPT ---------- */
    main {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 18px 0 8px;
      scroll-behavior: smooth;
    }
    main::-webkit-scrollbar { width: 8px; }
    main::-webkit-scrollbar-thumb { background: var(--bg-rule); }
    main::-webkit-scrollbar-thumb:hover { background: var(--fg-faint); }

    main > .empty {
      padding: 60px 18px;
      color: var(--fg-faint);
      font-size: 11px;
      text-align: center;
      letter-spacing: 0.06em;
    }
    .empty .glyph {
      color: var(--accent);
      font-size: 28px;
      display: block;
      margin-bottom: 10px;
      font-weight: 700;
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
      padding: 4px 14px 14px;
      animation: slideIn 180ms ease-out;
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .msg .meta {
      display: flex; align-items: center; gap: 8px;
      font-size: 9.5px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--fg-faint);
      margin-bottom: 4px;
    }
    .msg .meta .role { color: var(--fg-dim); font-weight: 700; }
    .msg.user   .meta .role { color: var(--accent); }
    .msg.system .meta .role { color: var(--fg-faint); }
    .msg .meta .rule {
      flex: 1; height: 1px; background: var(--bg-rule);
    }
    .msg .meta .ts { color: var(--fg-faint); }

    .bubble {
      padding: 10px 12px;
      background: var(--bg-bubble);
      border-left: 2px solid var(--bg-rule);
      color: var(--fg);
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .msg.user .bubble {
      border-left-color: var(--accent);
      background: var(--accent-soft);
    }
    .msg.system .bubble {
      background: transparent;
      color: var(--fg-dim);
      font-size: 11px;
      border-left-color: var(--fg-faint);
    }
    .msg.system.error .bubble {
      color: var(--accent);
      border-left-color: var(--accent);
      background: var(--accent-soft);
    }
    .msg.system.pong .bubble {
      color: var(--accent);
      font-weight: 700;
      letter-spacing: 0.20em;
    }

    /* tool call cards (inline in assistant messages, like VS Code Copilot) */
    .toolcalls { display: flex; flex-direction: column; gap: 4px; margin: 0 0 8px; }
    .intent-line {
      color: var(--fg-dim);
      font-style: italic;
      font-size: 11.5px;
      padding: 1px 2px 3px;
      letter-spacing: 0.01em;
      opacity: 0.85;
    }
    .intent-line + .intent-line { display: none; } /* dedupe consecutive */
    .toolcall {
      border: 1px solid var(--border);
      background: var(--bg-bubble);
      font-family: var(--mono);
      font-size: 11px;
      cursor: pointer;
      user-select: none;
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
    .toolcall.running .tc-icon { color: var(--accent); animation: tc-pulse 1s ease-in-out infinite; }
    .toolcall.success .tc-icon { color: #4ec9b0; }
    .toolcall.error   .tc-icon { color: var(--accent); }
    .toolcall.error   { border-color: var(--accent); }
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
    @keyframes tc-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

    /* markdown inside bubbles */
    .bubble :first-child { margin-top: 0; }
    .bubble :last-child  { margin-bottom: 0; }
    .bubble p { margin: 0 0 8px; }
    .bubble strong { color: var(--strong); font-weight: 700; }
    .bubble em { color: var(--fg-dim); font-style: normal; text-decoration: underline; text-decoration-color: var(--fg-faint); }
    .bubble code {
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
      border-radius: 3px;
      padding: 0 4px;
      color: var(--fg);
      font-size: 0.9em;
    }
    .bubble pre {
      background: var(--code-bg);
      border-left: 2px solid var(--accent);
      padding: 10px 12px;
      margin: 8px 0;
      overflow-x: auto;
      font-size: 11.5px;
    }
    .bubble pre code {
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
      width: 7px; height: 13px;
      background: var(--accent);
      vertical-align: -2px;
      margin-left: 2px;
      animation: blink 1s steps(2, start) infinite;
    }
    @keyframes blink { to { visibility: hidden; } }

    /* ---------- COMPOSER ---------- */
    footer {
      display: flex;
      flex-direction: column;
      border-top: 1px solid var(--bg-rule);
      background: var(--bg);
      flex: 0 0 auto;
      position: relative;
    }
    .composer-row {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: stretch;
    }
    .ac-popup {
      position: absolute;
      bottom: 100%;
      left: 8px;
      right: 8px;
      max-height: 260px;
      overflow-y: auto;
      background: var(--bg-soft, var(--bg));
      border: 1px solid var(--bg-rule);
      border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
      margin-bottom: 6px;
      font-size: 12.5px;
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
    .att-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 10px;
      border-bottom: 1px dashed var(--bg-rule);
      background: var(--bg-soft, var(--bg));
    }
    .att-chip {
      position: relative;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 22px 3px 3px;
      border: 1px solid var(--bg-rule);
      border-radius: 6px;
      background: var(--bg);
      font-size: 11px;
      color: var(--fg-soft, var(--fg));
    }
    .att-thumb {
      width: 36px;
      height: 36px;
      object-fit: cover;
      border-radius: 4px;
      display: block;
    }
    .att-meta {
      font-variant-numeric: tabular-nums;
      opacity: 0.75;
    }
    .att-x {
      position: absolute;
      top: 1px;
      right: 2px;
      width: 18px;
      height: 18px;
      border: 0;
      background: transparent;
      color: var(--fg-soft, var(--fg));
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      padding: 0;
      opacity: 0.7;
    }
    .att-x:hover { opacity: 1; color: var(--accent, #f78166); }
    .msg-attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 6px;
    }
    .msg-img-link { display: inline-block; line-height: 0; }
    .msg-img {
      max-width: 200px;
      max-height: 160px;
      border-radius: 6px;
      border: 1px solid var(--bg-rule);
      cursor: zoom-in;
      display: block;
    }
    .msg-text { white-space: pre-wrap; }
    .sigil {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 13px 8px 0 14px;
      color: var(--accent);
      font-weight: 700;
      font-size: 14px;
      user-select: none;
      letter-spacing: 0;
    }
    textarea {
      resize: none;
      min-height: 44px;
      max-height: 160px;
      background: transparent;
      color: transparent;
      -webkit-text-fill-color: transparent;
      border: none;
      padding: 12px 6px;
      font-family: inherit;
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
      padding: 12px 6px;
      font-family: inherit;
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
      display: flex; align-items: center; gap: 8px;
      background: transparent;
      color: var(--fg-dim);
      border: none;
      border-left: 1px solid var(--bg-rule);
      padding: 0 16px;
      cursor: pointer;
      font-family: inherit;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      transition: color 120ms ease, background 120ms ease;
    }
    .send-btn:hover { color: var(--accent); background: var(--bg-soft); }
    .send-btn .kbd {
      display: inline-block;
      padding: 2px 5px;
      border: 1px solid var(--fg-faint);
      color: var(--fg);
      font-size: 10px;
      letter-spacing: 0;
    }
    .send-btn:hover .kbd { border-color: var(--accent); color: var(--accent); }
    .send-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .send-btn:disabled:hover { color: var(--fg-dim); background: transparent; }
    .send-btn:disabled:hover .kbd { border-color: var(--fg-faint); color: var(--fg); }

    /* ---------- PLAYWRIGHT STRIP ---------- */
    .pw-strip {
      flex: 0 0 auto;
      border-top: 1px solid var(--bg-rule);
      background: var(--bg-soft);
      font-size: 10.5px;
      color: var(--fg-dim);
      letter-spacing: 0.04em;
      user-select: none;
    }
    .pw-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      cursor: pointer;
      min-height: 24px;
      flex-wrap: nowrap;
    }
    .pw-strip.nobind .pw-row {
      padding: 3px 12px;
      min-height: 22px;
      cursor: default;
    }
    .pw-strip.nobind .pw-row:hover { background: transparent; color: var(--fg-dim); }
    .pw-row:hover { background: var(--bg); color: var(--fg); }
    .pw-label {
      flex: 0 0 auto;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--fg-faint);
      font-size: 9.5px;
    }
    .pw-current {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--fg);
    }
    .pw-current.empty { color: var(--fg-faint); font-style: italic; }
    .pw-current.error { color: #d96d6d; }
    .pw-icon {
      flex: 0 0 auto;
      background: transparent;
      border: 1px solid var(--bg-rule);
      color: var(--fg-dim);
      height: 20px;
      min-width: 24px;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
      padding: 0 4px;
      font-size: 10px;
      white-space: nowrap;
    }
    .pw-icon:hover { color: var(--accent); border-color: var(--accent); }
    .pw-icon.attach {
      padding: 0 8px;
      font-size: 9.5px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .pw-caret { flex: 0 0 auto; font-size: 9px; color: var(--fg-faint); }
    .pw-list {
      max-height: 200px;
      overflow-y: auto;
      border-top: 1px solid var(--bg-rule);
      background: var(--bg);
    }
    .pw-session {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-left: 2px solid transparent;
      min-width: 0;
    }
    .pw-session + .pw-session { border-top: 1px solid var(--bg-rule); }
    .pw-session.ok    { border-left-color: var(--accent); }
    .pw-session.wait  { border-left-color: #d6a85d; }
    .pw-session.dead  { border-left-color: #d96d6d; opacity: 0.65; }
    .pw-status { flex: 0 0 auto; font-size: 11px; line-height: 1; }
    .pw-status.ok    { color: var(--accent); }
    .pw-status.wait  { color: #d6a85d; }
    .pw-status.dead  { color: #d96d6d; }
    .pw-who {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
    }
    .pw-title {
      color: var(--fg);
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: baseline;
      gap: 6px;
    }
    .pw-hint {
      color: var(--fg-faint);
      font-size: 10px;
      font-style: italic;
    }
    .pw-url {
      color: var(--fg-faint);
      font-size: 10px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .pw-sid {
      color: var(--accent);
      font-family: var(--font-mono, monospace);
      font-size: 9.5px;
      flex: 0 0 auto;
    }
    .pw-tabid {
      color: var(--fg-dim);
      font-family: var(--font-mono, monospace);
      font-size: 9.5px;
      flex: 0 0 auto;
    }
    .pw-urltext {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pw-icon.close {
      color: var(--fg-faint);
      border-color: transparent;
      font-size: 14px;
      line-height: 1;
    }
    .pw-icon.close:hover { color: #d96d6d; border-color: #d96d6d; }
    .pw-header { cursor: default; }
    .pw-header.clickable { cursor: pointer; }
    .pw-header:hover { background: transparent; color: var(--fg-dim); }
    .pw-header.clickable:hover { background: var(--bg); color: var(--fg); }

    /* ---------- DEBUG PANEL ---------- */
    .theme-toggle.active { color: var(--accent); border-bottom: 2px solid var(--accent); }
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

    /* ---- chat title pill in header ---- */
    .chat-title-pill {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: var(--fg);
      cursor: pointer;
      padding: 3px 6px;
      border: 1px dashed transparent;
      border-radius: 2px;
    }
    .chat-title-pill:hover { border-color: var(--bg-rule); color: var(--accent); }

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
      grid-template-columns: 1fr auto auto auto;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      cursor: pointer;
      border-left: 2px solid transparent;
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
    }
    .chat-row .icon-btn { grid-row: 1 / span 2; opacity: 0.5; }
    .chat-row:hover .icon-btn { opacity: 1; }
    .chat-rename {
      grid-column: 1 / 2;
      grid-row: 1 / span 2;
      background: var(--code-bg);
      color: var(--fg);
      border: 1px solid var(--accent);
      padding: 4px 6px;
      font: inherit;
      font-size: 12px;
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
      display: block;
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
    }
    .qp-btn:hover { border-color: var(--accent); color: var(--accent); }

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
    .pin-badge { color: var(--accent); margin-right: 4px; }
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
      background: transparent;
      border: none;
      color: var(--fg-faint);
      cursor: pointer;
      font-size: 14px;
      padding: 0 4px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .msg:hover .msg-menu-btn { opacity: 1; }
    .msg-menu-btn:hover { color: var(--accent); }
    .msg-menu {
      display: inline-flex;
      gap: 2px;
      margin-left: 4px;
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
    .send-btn.stop-btn {
      background: var(--accent);
      color: #000;
      border-color: var(--accent);
    }
    .send-btn.stop-btn:hover { filter: brightness(1.1); }

    /* ---- send button group (visible while streaming) ---- */
    .send-group { display: flex; gap: 4px; }
    .send-btn.steer-btn {
      color: var(--accent);
      border-color: var(--accent);
    }
  `;

