/**
 * Voice I/O abstraction layer.
 *
 * These interfaces define the contract for speech-to-text (VoiceInput)
 * and text-to-speech (VoiceOutput). Implementations can be swapped
 * without touching UI code — e.g. WebSpeech today, Whisper/ElevenLabs later.
 */

// ─── Voice Input (STT) ───────────────────────────────────────────────

export interface VoiceInputEvents {
  /** Fired with transcription results. `isFinal` = no more changes to this segment. */
  onResult(text: string, isFinal: boolean): void;
  /** Fired on recognition error (e.g. no-speech, network, not-allowed). */
  onError(error: string): void;
  /** Fired when recognition ends (intentionally or not). */
  onEnd(): void;
}

export interface VoiceInput {
  /** Whether this STT engine is available in the current environment. */
  readonly supported: boolean;
  /** Whether the engine is actively listening right now. */
  readonly listening: boolean;
  /** Start listening. No-op if already listening or unsupported. */
  start(): void | Promise<void>;
  /** Stop listening. No-op if not listening. */
  stop(): void;
  /** Language hint (BCP-47). Default: navigator.language. */
  lang: string;
  /** Whether to stream interim (non-final) results. Default: true. */
  interimResults: boolean;
  /** Whether to auto-restart on unintentional end. Default: true. */
  continuous: boolean;

  // Event handlers — set these before calling start().
  onResult: VoiceInputEvents['onResult'] | null;
  onError: VoiceInputEvents['onError'] | null;
  onEnd: VoiceInputEvents['onEnd'] | null;
}

// ─── Voice Output (TTS) ──────────────────────────────────────────────

export interface VoiceInfo {
  id: string;
  name: string;
  lang: string;
  local: boolean;
}

export interface VoiceOutput {
  /** Whether this TTS engine is available in the current environment. */
  readonly supported: boolean;
  /** Whether audio is currently being spoken. */
  readonly speaking: boolean;
  /** Speak the given text. Queues if already speaking. */
  speak(text: string): void;
  /** Immediately stop all speech. */
  stop(): void;
  /** List available voices. May be empty until voices load asynchronously. */
  getVoices(): VoiceInfo[];
  /** Set the preferred voice by ID. Empty string = browser default. */
  setVoice(id: string): void;
  /** Speech rate (0.1–10, default 1). */
  rate: number;
  /** Speech pitch (0–2, default 1). */
  pitch: number;

  /** Fired when speech finishes naturally. */
  onEnd: (() => void) | null;
  /** Fired on TTS error. */
  onError: ((error: string) => void) | null;
}

// ─── Voice Settings (persisted) ──────────────────────────────────────

export interface VoiceSettings {
  inputEnabled: boolean;
  outputEnabled: boolean;
  autoSubmit: boolean;
  autoSpeak: boolean;
  streamSpeak: boolean;
  voiceId: string;
  rate: number;
  pitch: number;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  inputEnabled: false,
  outputEnabled: false,
  autoSubmit: true,
  autoSpeak: true,
  streamSpeak: true,
  voiceId: '',
  rate: 1,
  pitch: 1,
};
