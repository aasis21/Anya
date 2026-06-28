/**
 * Mic-permission helper page.
 *
 * The MV3 side panel cannot surface the browser's microphone permission prompt
 * (no top-level frame to anchor it to), so a first-time or revoked user gets a
 * silent `not-allowed`. This standalone page runs in a real popup window where
 * `getUserMedia` CAN show the prompt. The grant applies to the whole extension
 * origin, so once allowed here the side panel's `webkitSpeechRecognition` works.
 *
 * It reports the outcome back to the side panel via `chrome.runtime.sendMessage`
 * ({ type: 'anya-mic-permission', granted }) and closes itself.
 */
const btn = document.getElementById('grant') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;

function report(granted: boolean, error?: string): void {
  try {
    chrome.runtime.sendMessage({ type: 'anya-mic-permission', granted, error });
  } catch {
    /* side panel may have closed; ignore */
  }
}

async function requestMic(): Promise<void> {
  btn.disabled = true;
  statusEl.className = '';
  statusEl.textContent = 'Waiting for your choice…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // We only needed the grant — release the device immediately.
    stream.getTracks().forEach((t) => t.stop());
    statusEl.className = 'ok';
    statusEl.textContent = 'Microphone enabled. Closing…';
    report(true);
    setTimeout(() => window.close(), 700);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    statusEl.className = 'err';
    statusEl.textContent =
      'Access blocked. If you previously denied it, enable the microphone for ' +
      'this extension in your browser settings, then retry.';
    btn.disabled = false;
    report(false, msg);
  }
}

btn.addEventListener('click', requestMic);
