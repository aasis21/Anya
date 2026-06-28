/**
 * Popup window that requests microphone permission.
 * Extension side panels cannot trigger the permission prompt, but popup
 * windows (opened via chrome.windows.create) can. Once granted here,
 * the permission applies to the entire extension origin — so the offscreen
 * document inherits it automatically.
 *
 * Approach B+C:
 *   B — Request the extension-level `audioCapture` permission via
 *       chrome.permissions.request() (handles first-time grants).
 *   C — If getUserMedia still fails (e.g. previously denied at the OS/browser
 *       level), show clear reset instructions instead of auto-closing.
 */

const statusEl = document.getElementById('status')!;

async function requestMic() {
  // B: Request extension-level audioCapture permission.
  // This triggers the browser permission dialog if not yet granted.
  try {
    const granted = await chrome.permissions.request({ permissions: ['audioCapture'] });
    if (!granted) {
      showResetInstructions('Extension permission was denied.');
      chrome.runtime.sendMessage({ type: 'anya-mic-permission', granted: false, error: 'extension-permission-denied' });
      return;
    }
  } catch {
    // chrome.permissions.request may not be available in all contexts — proceed to getUserMedia
  }

  // Now attempt getUserMedia to activate the grant in this context.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    statusEl.textContent = '✓ Permission granted';
    statusEl.classList.add('granted');
    chrome.runtime.sendMessage({ type: 'anya-mic-permission', granted: true });
    // Auto-close on success
    setTimeout(() => window.close(), 600);
  } catch (err: any) {
    // C: Show reset instructions instead of auto-closing
    showResetInstructions(err?.message ?? 'Unknown error');
    chrome.runtime.sendMessage({ type: 'anya-mic-permission', granted: false, error: err?.message });
  }
}

function showResetInstructions(reason: string) {
  statusEl.innerHTML = '';
  statusEl.classList.add('denied');

  const container = statusEl.parentElement ?? statusEl;
  container.innerHTML = `
    <p style="color:#f44336;font-weight:bold;">✗ Microphone access failed</p>
    <p style="font-size:0.85rem;opacity:0.8;">${escapeHtml(reason)}</p>
    <div style="text-align:left;margin-top:1rem;font-size:0.82rem;line-height:1.6;">
      <p><strong>To reset microphone permission:</strong></p>
      <ol style="padding-left:1.2rem;">
        <li>Open <code>edge://settings/content/microphone</code><br>
            (or <code>chrome://settings/content/microphone</code>)</li>
        <li>Find this extension in the Block list</li>
        <li>Remove it or change to Allow</li>
        <li>Come back and try again</li>
      </ol>
    </div>
    <button id="retry-btn" style="margin-top:0.8rem;padding:0.4rem 1rem;cursor:pointer;">Retry</button>
    <button id="close-btn" style="margin-top:0.8rem;margin-left:0.5rem;padding:0.4rem 1rem;cursor:pointer;">Close</button>
  `;

  document.getElementById('retry-btn')?.addEventListener('click', () => {
    container.innerHTML = '<p>🎤 Requesting microphone access…</p><p class="status" id="status"></p>';
    requestMic();
  });
  document.getElementById('close-btn')?.addEventListener('click', () => window.close());
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

requestMic();
