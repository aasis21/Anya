/**
 * Offscreen document for Web Speech API access.
 * Extension pages (side panel, popup) cannot use SpeechRecognition directly.
 * This document runs in a normal DOM context where the API is available.
 * Communication happens via chrome.runtime messaging.
 */

const SpeechRecognitionCtor: any =
  (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;

let recognition: any = null;
let stoppedManually = false;
let continuous = true;

async function startRecognition(opts: { lang: string; interimResults: boolean; continuous: boolean }) {
  if (!SpeechRecognitionCtor) {
    chrome.runtime.sendMessage({ type: 'anya-voice-error', error: 'not-supported' });
    return;
  }

  // Activate mic permission in this context — the popup window granted it at
  // the extension origin, but the offscreen doc must still call getUserMedia
  // once so the browser associates the grant with this context.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    chrome.runtime.sendMessage({ type: 'anya-voice-error', error: 'not-allowed' });
    return;
  }

  stopRecognition();

  recognition = new SpeechRecognitionCtor();
  recognition.lang = opts.lang;
  recognition.interimResults = opts.interimResults;
  continuous = opts.continuous;
  recognition.continuous = opts.continuous;
  recognition.maxAlternatives = 1;
  stoppedManually = false;

  recognition.onresult = (event: any) => {
    const last = event.results[event.results.length - 1];
    if (last) {
      chrome.runtime.sendMessage({
        type: 'anya-voice-result',
        transcript: last[0].transcript,
        isFinal: last.isFinal,
      });
    }
  };

  recognition.onerror = (event: any) => {
    if (event.error === 'aborted') return;
    chrome.runtime.sendMessage({ type: 'anya-voice-error', error: event.error });
  };

  recognition.onend = () => {
    if (!stoppedManually && continuous) {
      // Auto-restart for continuous mode
      try { recognition.start(); } catch { /* ignore */ }
      return;
    }
    recognition = null;
    chrome.runtime.sendMessage({ type: 'anya-voice-end' });
  };

  try {
    recognition.start();
    chrome.runtime.sendMessage({ type: 'anya-voice-started' });
  } catch {
    recognition = null;
    chrome.runtime.sendMessage({ type: 'anya-voice-error', error: 'start-failed' });
  }
}

function stopRecognition() {
  if (recognition) {
    stoppedManually = true;
    try { recognition.stop(); } catch { /* ignore */ }
    recognition = null;
  }
}

// Listen for commands from the sidebar/background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'anya-voice-start') {
    startRecognition(msg);
  } else if (msg.type === 'anya-voice-stop') {
    stopRecognition();
  }
});

// Signal that offscreen doc is ready
chrome.runtime.sendMessage({ type: 'anya-voice-ready' });
