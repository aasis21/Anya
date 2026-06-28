/**
 * Web Speech API implementation of VoiceInput (STT).
 * Uses webkitSpeechRecognition / SpeechRecognition available in Chromium.
 */
import type { VoiceInput } from './types.js';

// Web Speech API type shims (not all TS DOM libs include these)
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SpeechRecognitionConstructor {
  new(): SpeechRecognitionInstance;
}

const SpeechRecognitionCtor: SpeechRecognitionConstructor | undefined =
  (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;

export class WebSpeechInput implements VoiceInput {
  readonly supported: boolean;
  private _listening = false;
  private _recognition: SpeechRecognitionInstance | null = null;
  private _stoppedManually = false;

  lang = navigator.language;
  interimResults = true;
  continuous = true;

  onResult: VoiceInput['onResult'] = null;
  onError: VoiceInput['onError'] = null;
  onEnd: VoiceInput['onEnd'] = null;

  constructor() {
    this.supported = !!SpeechRecognitionCtor;
  }

  get listening(): boolean {
    return this._listening;
  }

  start(): void {
    if (!this.supported || this._listening) return;

    const recognition = new SpeechRecognitionCtor!();
    recognition.lang = this.lang;
    recognition.interimResults = this.interimResults;
    recognition.continuous = this.continuous;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last) {
        this.onResult?.(last[0].transcript, last.isFinal);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      this.onError?.(event.error);
    };

    recognition.onend = () => {
      this._listening = false;
      if (!this._stoppedManually && this.continuous) {
        try { this.start(); } catch { /* ignore */ }
        return;
      }
      this._recognition = null;
      this.onEnd?.();
    };

    this._stoppedManually = false;
    this._recognition = recognition;
    this._listening = true;

    try {
      recognition.start();
    } catch {
      this._listening = false;
      this._recognition = null;
    }
  }

  stop(): void {
    if (!this._listening || !this._recognition) return;
    this._stoppedManually = true;
    this._recognition.stop();
    this._listening = false;
  }
}
