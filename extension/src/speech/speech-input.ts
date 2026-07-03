/**
 * Web Speech API implementation of SpeechInput (STT).
 * Uses webkitSpeechRecognition / SpeechRecognition available in Chromium.
 */
import type { SpeechInput } from './types.js';

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

/**
 * Errors after which recognition must NOT auto-restart. Restarting on these
 * would silently re-open the mic while the UI shows "stopped". `no-speech` is
 * deliberately excluded: in continuous dictation a pause fires it and we want
 * the session to resume.
 */
const FATAL_SPEECH_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network']);

export class WebSpeechInput implements SpeechInput {
  readonly supported: boolean;
  private _listening = false;
  private _recognition: SpeechRecognitionInstance | null = null;
  private _stoppedManually = false;

  lang = navigator.language;
  interimResults = true;
  continuous = true;

  onResult: SpeechInput['onResult'] = null;
  onError: SpeechInput['onError'] = null;
  onEnd: SpeechInput['onEnd'] = null;

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
      // Fatal errors must stop for good: mark a manual stop so onend tears the
      // session down (and fires onEnd) instead of auto-restarting the mic.
      if (FATAL_SPEECH_ERRORS.has(event.error)) {
        this._stoppedManually = true;
      }
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
    } catch (err) {
      this._listening = false;
      this._recognition = null;
      const msg = err instanceof Error ? err.message : String(err);
      this.onError?.(`start-failed: ${msg}`);
      throw err;
    }
  }

  stop(): void {
    if (!this._listening || !this._recognition) return;
    this._stoppedManually = true;
    this._recognition.stop();
    this._listening = false;
  }
}
