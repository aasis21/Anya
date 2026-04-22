# Chrome Web Store — listing copy

Drop-in copy for the Chrome Web Store dashboard. Mirror to Edge Add-ons.

---

## Name
Anya — Copilot in your sidebar

## Summary (≤132 chars)
GitHub Copilot in your browser sidebar. Reads tabs, drives Playwright, edits local code via a native bridge. Local-first.

## Category
Productivity

## Language
English (United States)

---

## Detailed description

Anya is GitHub Copilot, in a sidebar — the same agent you use in your editor, sitting next to the pages you actually work in.

It uses the official @github/copilot-sdk and your existing Copilot subscription. There is no Anya cloud, no telemetry, no relay. Everything runs locally between the extension and a small Node "bridge" you install on your machine.

What it does well:
• Read what you're looking at — "@tab tldr", "summarise this PR", "what does selection mean?"
• Drive your real, logged-in browser — fill forms, click through wizards, navigate dashboards. No reauth, no captcha redo.
• Reason across many tabs at once — "@tabs which of these is red?", "diff GitHub PR vs ADO work item".
• Use your bookmarks as a knowledge graph — "open the order release page", "group these by topic".
• Bring your repo into the loop — point Anya at a local project folder and it gets the full Copilot toolbelt (read, edit, grep, shell, MCP) right alongside the tab it's helping with.

Three little prefixes, that's the whole language:
• @  pulls in browser context (@tab, @selection, @tabs, @clipboard)
• /  acts on the sidebar (/new, /pin, /search, /export)
• #  references your saved things (bookmarks, prior chats)

REQUIRES a one-time install of the local bridge from https://github.com/aasis21/Anya — the extension alone cannot work without it. Install is one command in PowerShell or bash.

Open source, MIT-style. No data leaves your machine that GitHub Copilot doesn't already see.

---

## Single purpose (Chrome required field)
Provide an in-browser sidebar agent powered by the GitHub Copilot SDK that can read the active page, drive tabs via Playwright, and reach local code through a user-installed Node bridge.

---

## Permission justifications

| Permission | Justification |
|---|---|
| `nativeMessaging` | Required. The extension talks to a user-installed local Node "bridge" that wraps `@github/copilot-sdk`. There is no remote backend; nativeMessaging IS the product. |
| `sidePanel` | Renders the Anya UI as a side panel. |
| `tabs` | Resolve "this tab", list open tabs the user references with `@tabs`, focus tabs the user asks Anya to switch to. |
| `activeTab` | Read the URL / title of the page the user is asking about. |
| `scripting` | Inject Mozilla Readability into a tab to extract clean Markdown when the user asks for a summary. Run Playwright commands against a single tab the user explicitly "binds" via the connect dialog. |
| `storage` | Persist chats, settings, and pinned tabs locally via `chrome.storage.local`. |
| `bookmarks` | Search bookmarks when the user references them ("open the order release page") and reorganise on explicit confirmation. |
| `clipboardRead` | Only triggered when the user types `@clipboard` in a prompt. |
| `<all_urls>` host permissions | Required so the user can ask Anya to read or drive a page on any site. The extension does not act on any tab without an explicit user prompt referencing that tab. |

## Remote code use
**No.** All JavaScript executed by the extension is bundled in the package. The bridge (separate, user-installed) is open source and version-pinned by install script.

## Data usage disclosures (Chrome's "Privacy practices" form)
- **Personally identifiable information**: not collected
- **Health information**: not collected
- **Financial info**: not collected
- **Authentication information**: not collected by the extension; GitHub OAuth handled by the SDK on the user's machine
- **Personal communications**: only what the user explicitly types into the chat; sent to GitHub Copilot's API, not to any Anya-owned server
- **Location**: not collected
- **Web history**: not collected
- **User activity**: not collected
- **Website content**: read only when the user explicitly references a tab; sent to GitHub Copilot as part of the user's prompt, never to any Anya-owned server

Certifications:
- ✓ I do not sell or transfer user data to third parties outside of approved use cases
- ✓ I do not use or transfer user data for purposes unrelated to my item's single purpose
- ✓ I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## URLs

- Homepage: https://aasis21.github.io/Anya/
- Privacy policy: https://aasis21.github.io/Anya/privacy.html
- Support: https://github.com/aasis21/Anya/issues
- Source: https://github.com/aasis21/Anya
