// MV3 service worker for Anya.
// Handles: popup window, voice sidebar, "Add to Anya" context menu, message relay.

// Sidebar is NOT opened on action click — we open a popup window instead.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((err) => console.error('[Anya] setPanelBehavior failed:', err));

// ---------------------------------------------------------------------------
// Popup window: opens on extension icon click.
// ---------------------------------------------------------------------------

const POPUP_URL = chrome.runtime.getURL('popup.html');
const POPUP_WIDTH = 420;
const POPUP_HEIGHT = 700;

/** Track the popup window ID so we don't open duplicates. */
let popupWindowId: number | undefined;

async function openPopupWindow(): Promise<void> {
  // If popup window already exists, focus it.
  if (popupWindowId !== undefined) {
    try {
      const win = await chrome.windows.get(popupWindowId);
      if (win) {
        await chrome.windows.update(popupWindowId, { focused: true });
        return;
      }
    } catch {
      popupWindowId = undefined;
    }
  }

  const win = await chrome.windows.create({
    url: POPUP_URL,
    type: 'popup',
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
  });
  popupWindowId = win.id;
}

// Clean up tracked ID when the popup window closes.
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) popupWindowId = undefined;
});

// Extension icon click → open popup window.
chrome.action.onClicked.addListener(() => {
  openPopupWindow();
});

// ---------------------------------------------------------------------------
// Context menu: single "Add to Anya" item — visible everywhere.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'anya-add',
    title: 'Add to Anya',
    contexts: ['page', 'selection', 'editable', 'link', 'image', 'video'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'anya-add' || !tab?.id) return;

  // Tell the content script to capture context at the right-click point.
  chrome.tabs.sendMessage(tab.id, { type: 'anya-capture-context' }).catch(() => {});

  // Open the popup window (main UI).
  await openPopupWindow();
});

// ---------------------------------------------------------------------------
// Relay: content script messages pass through to the popup (same origin).
// Open popup window for attach and Alt+A messages.
// Open sidebar for voice activation.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'anya-attach' && sender.tab?.id) {
    msg.attachment.tabId = sender.tab.id;
    // Buffer in session storage so a not-yet-open popup picks it up on load.
    chrome.storage.session.get('anya-pending-attach').then((result) => {
      const pending: unknown[] = Array.isArray(result?.['anya-pending-attach'])
        ? result['anya-pending-attach'] : [];
      pending.push(msg.attachment);
      chrome.storage.session.set({ 'anya-pending-attach': pending });
    }).catch(() => {});
    openPopupWindow();
  }
  if (msg.type === 'anya-field-activate' && sender.tab?.id) {
    openPopupWindow();
  }
  // Voice sidebar: popup requests to open the sidebar for voice mode.
  if (msg.type === 'anya-open-voice-sidebar') {
    const tabId = msg.tabId as number | undefined;
    if (tabId) {
      chrome.sidePanel.open({ tabId }).catch(() => {});
    } else {
      // Try opening for the currently active tab.
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]?.id) chrome.sidePanel.open({ tabId: tabs[0].id }).catch(() => {});
      }).catch(() => {});
    }
  }
  // Voice transcript from sidebar → forward to popup.
  if (msg.type === 'anya-voice-transcript') {
    // The popup listens for this via chrome.runtime.onMessage too.
    // Just re-broadcast (the popup will pick it up since it's in extension context).
  }
});
