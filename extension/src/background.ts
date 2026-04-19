// MV3 service worker for Anya.
// Keep this minimal — most logic lives in the side panel UI.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[Anya] setPanelBehavior failed:', err));
