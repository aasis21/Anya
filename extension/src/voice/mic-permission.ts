/**
 * Mic-permission helper page.
 *
 * The MV3 side panel cannot surface the browser's microphone permission prompt
 * (no top-level frame to anchor it to), so a first-time or revoked user gets a
 * silent `not-allowed`. This standalone page runs in a real popup window where
 * `getUserMedia` CAN show the prompt. The grant applies to the whole extension
 * origin, so once allowed here the side panel's `webkitSpeechRecognition` works.
 *
 * On success it signals the side panel via `chrome.runtime.sendMessage`
 * ({ type: 'anya-mic-permission', granted: true }) and closes itself. On
 * failure it stays open and re-enables the button so the user can retry
 * (e.g. after switching the site permission from "block" to "allow"); the
 * side panel infers the give-up case from this window closing or its timeout.
 */
const btn = document.getElementById('grant') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;

function reportGranted(): void {
  try {
    chrome.runtime.sendMessage({ type: 'anya-mic-permission', granted: true });
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
    reportGranted();
    setTimeout(() => window.close(), 700);
  } catch {
    // Stay open and let the user retry: the side panel only hears about success,
    // so a deny-then-allow retry in this same window still reaches it.
    statusEl.className = 'err';
    statusEl.textContent =
      'Access blocked. If you previously denied it, enable the microphone for ' +
      'this extension in your browser settings, then click “Allow microphone” again.';
    btn.disabled = false;
  }
}

btn.addEventListener('click', requestMic);
