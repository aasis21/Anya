/**
 * Voice I/O module — barrel export.
 * Import from here to get types + default implementations.
 */
export type { SpeechInput, SpeechOutput, VoiceInfo, SpeechInputEvents, SpeechSettings } from './types.js';
export { DEFAULT_SPEECH_SETTINGS } from './types.js';
export { WebSpeechInput } from './speech-input.js';
export { WebSpeechOutput } from './speech-output.js';
