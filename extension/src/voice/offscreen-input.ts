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

  private async _ensureMicPermission(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately release the mic — we just needed the permission grant
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      this.onError?.('not-allowed');
      throw new Error('Microphone permission denied');
    }
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
