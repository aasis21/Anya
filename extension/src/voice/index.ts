/**
 * Voice I/O module — barrel export.
 * Import from here to get types + default implementations.
 */
export type { VoiceInput, VoiceOutput, VoiceInfo, VoiceInputEvents, VoiceSettings } from './types.js';
export { DEFAULT_VOICE_SETTINGS } from './types.js';
export { WebSpeechInput } from './voice-input.js';
export { WebSpeechOutput } from './voice-output.js';
