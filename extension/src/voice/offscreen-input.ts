/**
 * VoiceInput implementation that delegates to an offscreen document.
 * The Web Speech API is NOT available in extension side panels / popups,
 * so we create an offscreen document that has access to it and relay
 * results via chrome.runtime messaging.
 */
import type { VoiceInput } from './types.js';

const OFFSCREEN_URL = 'offscreen.html';
const OFFSCREEN_REASON = 'USER_MEDIA' as chrome.offscreen.Reason;

export class OffscreenSpeechInput implements VoiceInput {
  readonly supported: boolean;
  private _listening = false;
  private _offscreenReady = false;
  private _messageHandler: ((msg: any) => void) | null = null;

  lang = navigator.language;
  interimResults = true;
  continuous = true;

  onResult: VoiceInput['onResult'] = null;
  onError: VoiceInput['onError'] = null;
  onEnd: VoiceInput['onEnd'] = null;

  constructor() {
    // Offscreen API available in MV3 Chrome 109+ / Edge 109+
    this.supported = !!(chrome.offscreen);
    if (this.supported) {
      this._setupListener();
    }
  }

  private _setupListener(): void {
    this._messageHandler = (msg: any) => {
      switch (msg.type) {
        case 'anya-voice-ready':
          this._offscreenReady = true;
          break;
        case 'anya-voice-started':
          this._listening = true;
          break;
        case 'anya-voice-result':
          this.onResult?.(msg.transcript, msg.isFinal);
          break;
        case 'anya-voice-error':
          this._listening = false;
          this.onError?.(msg.error);
          break;
        case 'anya-voice-end':
          this._listening = false;
          this.onEnd?.();
          break;
      }
    };
    chrome.runtime.onMessage.addListener(this._messageHandler);
  }

  get listening(): boolean {
    return this._listening;
  }

  async start(): Promise<void> {
    if (!this.supported || this._listening) return;

    // Ensure mic permission is granted at the extension origin level.
    // Offscreen documents can't show permission prompts, but the side panel can.
    // Once granted here, the offscreen doc inherits it (same origin).
    await this._ensureMicPermission();

    await this._ensureOffscreen();

    chrome.runtime.sendMessage({
      type: 'anya-voice-start',
      lang: this.lang,
      interimResults: this.interimResults,
      continuous: this.continuous,
    });
    // Optimistically set listening — corrected by offscreen messages
    this._listening = true;
  }

  private _micPermissionGranted = false;

  private async _ensureMicPermission(): Promise<void> {
    // If we've already successfully obtained permission this session, skip.
    if (this._micPermissionGranted) return;

    // Side panels can't show the mic permission prompt directly.
    // Check if we already have permission via Permissions API.
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (result.state === 'granted') {
        this._micPermissionGranted = true;
        return;
      }
    } catch { /* Permissions API not available — fall through */ }

    // Open a popup window that CAN show the permission prompt.
    // The grant applies to the whole extension origin, so the offscreen doc inherits it.
    return new Promise<void>((resolve, reject) => {
      const handler = (msg: any) => {
        if (msg.type !== 'anya-mic-permission') return;
        chrome.runtime.onMessage.removeListener(handler);
        if (msg.granted) {
          this._micPermissionGranted = true;
          resolve();
        } else {
          this.onError?.('not-allowed');
          reject(new Error('Microphone permission denied'));
        }
      };
      chrome.runtime.onMessage.addListener(handler);

      chrome.windows.create({
        url: chrome.runtime.getURL('mic-permission.html'),
        type: 'popup',
        width: 360,
        height: 200,
        focused: true,
      });

      // Timeout if user ignores the popup
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(handler);
        this.onError?.('not-allowed');
        reject(new Error('Microphone permission request timed out'));
      }, 30_000);
    });
  }

  stop(): void {
    if (!this._listening) return;
    chrome.runtime.sendMessage({ type: 'anya-voice-stop' });
    this._listening = false;
  }

  private async _ensureOffscreen(): Promise<void> {
    // Check if offscreen doc already exists
    const contexts = await (chrome.runtime as any).getContexts?.({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    }).catch(() => []);

    if (contexts && contexts.length > 0) return;

    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: [OFFSCREEN_REASON],
        justification: 'Speech recognition requires a normal DOM context',
      });
    } catch (e: any) {
      // Already exists (race condition)
      if (!e?.message?.includes('already exists')) throw e;
    }
  }
}
