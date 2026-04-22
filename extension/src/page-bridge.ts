/**
 * page-bridge.ts — Content script injected into every page.
 *
 * Three responsibilities:
 * 1. Silent field tracking — tracks focused text fields for Insert/Append.
 * 2. Context capture — right-click "Add to Anya" or Alt+A captures page
 *    elements, selections, fields, links, or the full page as context chips.
 * 3. Fill handler — sidebar sends text to insert into a tracked field.
 *
 * Zero visual footprint — no buttons, badges, or overlays on the page.
 */

// ---------------------------------------------------------------------------
// Types (mirrors ContextAttachment in types.ts, but we can't import here)
// ---------------------------------------------------------------------------

interface AttachmentPayload {
  kind: 'element' | 'selection' | 'page' | 'field' | 'link';
  icon: string;
  label: string;
  preview: string;
  content: string;
  fullLength?: number;
  ref?: { tabId?: number; ctxId?: string; fieldId?: string };
  pageUrl: string;
}

interface FieldMeta {
  fieldId: string;
  tagName: string;
  inputType: string | null;
  placeholder: string;
  label: string;
  ariaLabel: string;
  currentValue: string;
  maxLength: number | null;
  isContentEditable: boolean;
  pageUrl: string;
  pageTitle: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TEXT = 30;
const MAX_TEXT = 10_000;
const VALUE_CAP = 5_000;
const SEMANTIC_TAGS = new Set([
  'article', 'section', 'table', 'blockquote', 'pre', 'details',
  'figure', 'main', 'aside', 'form', 'li', 'nav',
]);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let activeField: HTMLElement | null = null;
let activeFieldId: string | null = null;
let blurTimer: ReturnType<typeof setTimeout> | null = null;
let fieldIdCounter = 0;
let ctxIdCounter = 0;
/** The element the user last right-clicked on (captured before menu shows). */
let lastContextTarget: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Helpers — text fields
// ---------------------------------------------------------------------------

function isTextField(el: unknown): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    return ['text', 'search', 'url', 'email', 'tel', ''].includes(t);
  }
  return false;
}

function getFieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  return el.innerText || el.textContent || '';
}

function findLabel(el: HTMLElement): string {
  if (el.id) {
    const lbl = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl?.textContent) return lbl.textContent.trim();
  }
  const wrap = el.closest('label');
  if (wrap?.textContent) {
    const clone = wrap.cloneNode(true) as HTMLElement;
    clone.querySelector('input, textarea, [contenteditable]')?.remove();
    const t = clone.textContent?.trim();
    if (t) return t;
  }
  return el.getAttribute('aria-label') || '';
}

function buildFieldMeta(el: HTMLElement): FieldMeta {
  const id = el.getAttribute('data-anya-field-id') || `af-${++fieldIdCounter}-${Date.now()}`;
  el.setAttribute('data-anya-field-id', id);
  const value = getFieldValue(el);
  return {
    fieldId: id,
    tagName: el.tagName.toLowerCase(),
    inputType: el instanceof HTMLInputElement ? el.type : null,
    placeholder: (el as HTMLInputElement).placeholder || el.getAttribute('aria-placeholder') || '',
    label: findLabel(el),
    ariaLabel: el.getAttribute('aria-label') || '',
    currentValue: value.length > 500 ? value.slice(0, 500) + '…' : value,
    maxLength: (el as HTMLInputElement).maxLength > 0 ? (el as HTMLInputElement).maxLength : null,
    isContentEditable: el.isContentEditable,
    pageUrl: location.href,
    pageTitle: document.title,
  };
}

// ---------------------------------------------------------------------------
// Helpers — element capture
// ---------------------------------------------------------------------------

/** Walk up from the clicked element to find a meaningful content container. */
function findMeaningfulContainer(el: HTMLElement): HTMLElement {
  let current: HTMLElement | null = el;
  let best: HTMLElement = el;

  while (current && current !== document.body && current !== document.documentElement) {
    const text = (current.innerText || '').trim();
    const len = text.length;
    const tag = current.tagName.toLowerCase();

    // Too big — stop walking
    if (len > MAX_TEXT) break;

    // Semantic tag with enough text — great match
    if (SEMANTIC_TAGS.has(tag) && len >= MIN_TEXT) return current;

    // Heading-anchored div
    if (tag === 'div' && len >= MIN_TEXT) {
      const h = current.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
      if (h) return current;
    }

    // Track the best substantial container
    if (len >= 100) best = current;

    current = current.parentElement;
  }

  // If best has enough text, use it
  if ((best.innerText || '').trim().length >= MIN_TEXT) return best;

  // Fallback to body (whole page)
  return document.body;
}

/** Generate a human-readable label for a captured element. */
function getElementLabel(el: HTMLElement): string {
  if (el === document.body) return document.title || location.hostname;
  const tag = el.tagName.toLowerCase();

  // Check for a heading child
  const h = el.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
  if (h?.textContent?.trim()) {
    const ht = h.textContent.trim();
    return ht.length > 60 ? ht.slice(0, 57) + '…' : ht;
  }

  // Semantic name
  const names: Record<string, string> = {
    table: 'Table', blockquote: 'Blockquote', pre: 'Code block',
    form: 'Form', article: 'Article', section: 'Section',
    details: 'Details', figure: 'Figure', nav: 'Navigation',
    aside: 'Aside', main: 'Main content',
  };
  if (names[tag]) return names[tag];

  // First line of text
  const text = (el.innerText || '').trim();
  const line = text.split('\n')[0].trim();
  return line.length > 60 ? line.slice(0, 57) + '…' : line;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `…[+${text.length - max}]`;
}

function hostname(): string {
  try { return new URL(location.href).hostname; } catch { return location.href; }
}

// ---------------------------------------------------------------------------
// Context capture — builds an attachment payload for the sidebar.
// ---------------------------------------------------------------------------

function cap(text: string): { capped: string; full: number } {
  const full = text.length;
  return { capped: full > VALUE_CAP ? text.slice(0, VALUE_CAP) : text, full };
}

function tagElement(el: HTMLElement): string {
  let id = el.getAttribute('data-anya-ctx');
  if (!id) { id = `ctx-${++ctxIdCounter}-${Date.now()}`; el.setAttribute('data-anya-ctx', id); }
  return id;
}

function captureContext(): AttachmentPayload {
  // 1. Selected text takes priority
  const sel = window.getSelection()?.toString()?.trim();
  if (sel && sel.length > 0) {
    const { capped, full } = cap(sel);
    return {
      kind: 'selection',
      icon: '✂️',
      label: `"${sel.length > 50 ? sel.slice(0, 47) + '…' : sel}"`,
      preview: sel.length > 80 ? sel.slice(0, 77) + '…' : sel,
      content: capped,
      fullLength: full,
      pageUrl: location.href,
    };
  }

  // 2. Right-clicked on an editable field
  if (lastContextTarget && isTextField(lastContextTarget)) {
    const meta = buildFieldMeta(lastContextTarget);
    const name = meta.label || meta.placeholder || meta.ariaLabel || meta.tagName;
    const fieldContent = [
      `[Field on ${location.href}]`,
      meta.label ? `Label: ${meta.label}` : '',
      meta.placeholder ? `Placeholder: ${meta.placeholder}` : '',
      `Element: <${meta.tagName}${meta.inputType ? ` type="${meta.inputType}"` : ''}>`,
      meta.maxLength ? `Max length: ${meta.maxLength}` : '',
      meta.currentValue ? `Current value: ${meta.currentValue}` : '(empty)',
    ].filter(Boolean).join('\n');
    return {
      kind: 'field',
      icon: '✏️',
      label: `${name} · ${hostname()}`,
      preview: meta.currentValue ? `"${meta.currentValue.slice(0, 60)}"` : '(empty)',
      content: fieldContent,
      ref: { fieldId: meta.fieldId },
      pageUrl: location.href,
    };
  }

  // 3. Right-clicked on a link — by value (always small)
  {
    const target = lastContextTarget as HTMLElement | null;
    const linkEl = target?.closest('a') as HTMLAnchorElement | null;
    if (linkEl && linkEl.href) {
      const linkText = (linkEl.innerText || '').trim();
      const linkUrl = linkEl.href;
      const display = linkText || linkUrl;
      return {
        kind: 'link',
        icon: '🔗',
        label: `${display.length > 50 ? display.slice(0, 47) + '…' : display}`,
        preview: `${linkText ? linkText + ' → ' : ''}${linkUrl}`,
        content: `[Link: ${linkText || '(no text)'}](${linkUrl})`,
        pageUrl: location.href,
      };
    }
  }

  // 4. Right-clicked on a non-editable element — tag + ref
  {
    const target = lastContextTarget as HTMLElement | null;
    if (target) {
      const container = findMeaningfulContainer(target);
      if (container !== document.body) {
        const text = (container.innerText || '').trim();
        const ctxId = tagElement(container);
        const label = getElementLabel(container);
        const { capped, full } = cap(text);
        return {
          kind: 'element',
          icon: '📄',
          label: `${label} · ${hostname()}`,
          preview: text.length > 80 ? text.slice(0, 77) + '…' : text,
          content: capped,
          fullLength: full,
          ref: { ctxId },
          pageUrl: location.href,
        };
      }
    }
  }

  // 5. Fallback — whole page (ref = tabId, added by background/sidebar)
  const pageText = (document.body.innerText || '').trim();
  const { capped, full } = cap(pageText);
  return {
    kind: 'page',
    icon: '🌐',
    label: `${document.title || hostname()}`,
    preview: `Full page · ${hostname()}`,
    content: capped,
    fullLength: full,
    pageUrl: location.href,
  };
}

// ---------------------------------------------------------------------------
// Focus / blur handlers — silent tracking for Insert/Append buttons.
// ---------------------------------------------------------------------------

function handleFocusIn(e: FocusEvent): void {
  const target = e.target;
  if (!isTextField(target)) return;
  if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
  activeField = target;
  const meta = buildFieldMeta(target);
  activeFieldId = meta.fieldId;
  chrome.runtime.sendMessage({ type: 'anya-field-focus', field: meta }).catch(() => {});
}

function handleFocusOut(_e: FocusEvent): void {
  if (blurTimer) clearTimeout(blurTimer);
  blurTimer = setTimeout(() => {
    activeField = null;
    activeFieldId = null;
    chrome.runtime.sendMessage({ type: 'anya-field-blur' }).catch(() => {});
  }, 600);
}

// ---------------------------------------------------------------------------
// Context menu target — capture BEFORE the menu shows.
// ---------------------------------------------------------------------------

function handleContextMenu(e: MouseEvent): void {
  lastContextTarget = e.target instanceof HTMLElement ? e.target : null;
}

// ---------------------------------------------------------------------------
// Alt+A — captures context and sends to sidebar (same as right-click).
// ---------------------------------------------------------------------------

function handleKeyDown(e: KeyboardEvent): void {
  if (e.altKey && (e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();

    // Set lastContextTarget to the focused element so captureContext works.
    lastContextTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;

    const attachment = captureContext();
    chrome.runtime.sendMessage({ type: 'anya-attach', attachment }).catch(() => {});
    // Also send field-focus so Insert/Append buttons work.
    if (activeField && isTextField(activeField)) {
      const meta = buildFieldMeta(activeField);
      chrome.runtime.sendMessage({ type: 'anya-field-focus', field: meta }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Fill handler — sidebar sends text to insert into a field.
// ---------------------------------------------------------------------------

function insertText(el: HTMLElement, text: string, mode: 'replace' | 'append'): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (mode === 'replace') {
      el.value = text;
    } else {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      const pos = start + text.length;
      el.selectionStart = pos;
      el.selectionEnd = pos;
    }
  } else if (el.isContentEditable) {
    if (mode === 'replace') {
      el.innerText = text;
    } else {
      const s = window.getSelection();
      if (s && s.rangeCount > 0) {
        const r = s.getRangeAt(0);
        r.deleteContents();
        r.insertNode(document.createTextNode(text));
        r.collapse(false);
      } else {
        el.innerText += text;
      }
    }
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.focus();
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // "Add to Anya" context menu click → capture and send attachment.
  if (msg.type === 'anya-capture-context') {
    const attachment = captureContext();
    chrome.runtime.sendMessage({ type: 'anya-attach', attachment }).catch(() => {});
    // If this was a field, also send field-focus for Insert/Append.
    if (attachment.kind === 'field' && lastContextTarget && isTextField(lastContextTarget)) {
      const meta = buildFieldMeta(lastContextTarget);
      chrome.runtime.sendMessage({ type: 'anya-field-focus', field: meta }).catch(() => {});
    }
    return false;
  }

  // Fill request from sidebar.
  if (msg.type === 'anya-field-fill') {
    const { fieldId, text, mode = 'replace' } = msg;
    const el = document.querySelector<HTMLElement>(`[data-anya-field-id="${CSS.escape(fieldId)}"]`);
    if (!el) { sendResponse({ ok: false, error: 'Field no longer found on page' }); return true; }
    try { insertText(el, text, mode); sendResponse({ ok: true }); }
    catch (err) { sendResponse({ ok: false, error: String(err) }); }
    return true;
  }

  // Read field value.
  if (msg.type === 'anya-field-read') {
    const el = document.querySelector<HTMLElement>(`[data-anya-field-id="${CSS.escape(msg.fieldId)}"]`);
    if (!el) { sendResponse({ ok: false, error: 'Field not found' }); return true; }
    sendResponse({ ok: true, value: getFieldValue(el) });
    return true;
  }

  // Read context element — fetch fresh content by ctxId reference.
  if (msg.type === 'anya-read-context') {
    const el = document.querySelector<HTMLElement>(`[data-anya-ctx="${CSS.escape(msg.ctxId)}"]`);
    if (!el) { sendResponse({ ok: false, error: 'Element no longer found on page' }); return true; }
    sendResponse({ ok: true, content: (el.innerText || '').trim() });
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('focusin', handleFocusIn, true);
document.addEventListener('focusout', handleFocusOut, true);
document.addEventListener('contextmenu', handleContextMenu, true);
document.addEventListener('keydown', handleKeyDown, true);
