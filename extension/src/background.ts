// MV3 service worker for AgentEdge.
// Keep this minimal — most logic lives in the side panel UI.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[AgentEdge] setPanelBehavior failed:', err));
