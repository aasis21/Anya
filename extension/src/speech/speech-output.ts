/**
 * Web Speech API implementation of SpeechOutput (TTS).
 * Uses window.speechSynthesis available in all modern browsers.
 */
import type { SpeechOutput, VoiceInfo } from './types.js';

/** Strip markdown formatting for cleaner speech. */
function stripMarkdown(text: string): string {
  return text
    // Code blocks
    .replace(/```[\s\S]*?```/g, ' code block omitted ')
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Headers
    .replace(/^#{1,6}\s+/gm, '')
    // Bold/italic
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    // Links [text](url)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // HTML tags
    .replace(/<[^>]+>/g, '')
    // Bullet points
    .replace(/^[\s]*[-*+]\s+/gm, '')
    // Numbered lists
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Horizontal rules
    .replace(/^---+$/gm, '')
    // Multiple newlines → single pause
    .replace(/\n{2,}/g, '. ')
    // Single newlines
    .replace(/\n/g, ' ')
    // Multiple spaces
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export class WebSpeechOutput implements SpeechOutput {
  readonly supported: boolean;
  private _synth: SpeechSynthesis | null;
  private _voiceId = '';
  private _voices: SpeechSynthesisVoice[] = [];

  rate = 1;
  pitch = 1;

  onEnd: SpeechOutput['onEnd'] = null;
  onError: SpeechOutput['onError'] = null;

  constructor() {
    this._synth = globalThis.speechSynthesis ?? null;
    this.supported = !!this._synth;

    if (this._synth) {
      // Voices load async in some browsers
      this._voices = this._synth.getVoices();
      if (this._voices.length === 0) {
        this._synth.addEventListener('voiceschanged', () => {
          this._voices = this._synth!.getVoices();
        }, { once: true });
      }
    }
  }

  get speaking(): boolean {
    return this._synth?.speaking ?? false;
  }

  speak(text: string): void {
    if (!this.supported || !this._synth) return;

    const cleaned = stripMarkdown(text);
    if (!cleaned) return;

    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;

    // Set voice if specified
    if (this._voiceId) {
      const voice = this._voices.find((v) => v.voiceURI === this._voiceId);
      if (voice) utterance.voice = voice;
    }

    utterance.onend = () => this.onEnd?.();
    utterance.onerror = (e) => {
      if (e.error !== 'canceled') {
        this.onError?.(e.error);
      }
    };

    this._synth.speak(utterance);
  }

  stop(): void {
    this._synth?.cancel();
  }

  getVoices(): VoiceInfo[] {
    return this._voices.map((v) => ({
      id: v.voiceURI,
      name: v.name,
      lang: v.lang,
      local: v.localService,
    }));
  }

  setVoice(id: string): void {
    this._voiceId = id;
  }
}
