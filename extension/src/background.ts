// MV3 service worker for Anya.
// Handles: side panel, "Add to Anya" context menu, message relay.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[Anya] setPanelBehavior failed:', err));

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

  // Open the side panel.
  try { await chrome.sidePanel.open({ tabId: tab.id }); } catch {}
});

// ---------------------------------------------------------------------------
// Relay: content script messages pass through to the sidebar (same origin).
// Open side panel for attach and Alt+A messages.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'anya-attach' && sender.tab?.id) {
    msg.attachment.tabId = sender.tab.id;
    // Buffer in session storage so a not-yet-open sidebar picks it up on load.
    chrome.storage.session.get('anya-pending-attach').then((result) => {
      const pending: unknown[] = Array.isArray(result?.['anya-pending-attach'])
        ? result['anya-pending-attach'] : [];
      pending.push(msg.attachment);
      chrome.storage.session.set({ 'anya-pending-attach': pending });
    }).catch(() => {});
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  }
  if (msg.type === 'anya-field-activate' && sender.tab?.id) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  }
});
