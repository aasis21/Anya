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
 * failure it reports the concrete reason back to the side panel and stays open
 * when retrying still makes sense (e.g. after switching the permission from
 * "block" to "allow").
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

function reportFailure(reason: string, message: string): void {
  try {
    chrome.runtime.sendMessage({ type: 'anya-mic-permission', granted: false, reason, message });
  } catch {
    /* side panel may have closed; ignore */
  }
}

function describeMicFailure(err: unknown): { reason: string; message: string } {
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      reason: 'unsupported',
      message: 'This browser build does not support microphone capture for the Anya extension.',
    };
  }
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        reason: 'not-allowed',
        message: 'Microphone access was denied. Allow it for the Anya extension in browser settings, then try again.',
      };
    case 'NotFoundError':
      return {
        reason: 'not-found',
        message: 'No microphone was found. Connect or enable a microphone, then try again.',
      };
    case 'NotReadableError':
    case 'AbortError':
      return {
        reason: 'not-readable',
        message: 'The microphone is already in use or unavailable. Close other apps using it, then try again.',
      };
    case 'OverconstrainedError':
      return {
        reason: 'overconstrained',
        message: 'The browser could not find a microphone matching the requested settings.',
      };
    default:
      return {
        reason: 'unknown',
        message: err instanceof Error ? err.message : 'Microphone access failed for an unknown reason.',
      };
  }
}

async function requestMic(): Promise<void> {
  btn.disabled = true;
  statusEl.className = '';
  statusEl.textContent = 'Waiting for your choice…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture is not supported in this browser context.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // We only needed the grant — release the device immediately.
    stream.getTracks().forEach((t) => t.stop());
    statusEl.className = 'ok';
    statusEl.textContent = 'Microphone enabled. Closing…';
    reportGranted();
    setTimeout(() => window.close(), 700);
  } catch (err) {
    const failure = describeMicFailure(err);
    statusEl.className = 'err';
    statusEl.textContent = failure.message;
    reportFailure(failure.reason, failure.message);
    btn.disabled = failure.reason === 'unsupported' ? true : false;
  }
}

btn.addEventListener('click', requestMic);
