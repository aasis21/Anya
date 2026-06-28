/**
 * Popup window that requests microphone permission.
 * Extension side panels cannot trigger the permission prompt, but popup
 * windows (opened via chrome.windows.create) can. Once granted here,
 * the permission applies to the entire extension origin — so the offscreen
 * document inherits it automatically.
 *
 * Communicates result back via chrome.runtime messaging, then auto-closes.
 */

const statusEl = document.getElementById('status')!;

async function requestMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission granted — release the mic immediately
    stream.getTracks().forEach((t) => t.stop());
    statusEl.textContent = '✓ Permission granted';
    statusEl.classList.add('granted');
    chrome.runtime.sendMessage({ type: 'anya-mic-permission', granted: true });
  } catch (err: any) {
    statusEl.textContent = '✗ Permission denied';
    statusEl.classList.add('denied');
    chrome.runtime.sendMessage({ type: 'anya-mic-permission', granted: false, error: err?.message });
  }

  // Auto-close after a brief delay so the user sees the status
  setTimeout(() => window.close(), 600);
}

requestMic();
