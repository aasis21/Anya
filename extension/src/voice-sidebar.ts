/**
 * Voice-only sidebar panel.
 * Opens when the user clicks the mic button in the popup window.
 * Captures voice, sends transcribed text to the popup via chrome.runtime messaging.
 * Stays open for hands-free interaction while the user works in tabs.
 */
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  OffscreenSpeechInput,
  WebSpeechOutput,
  DEFAULT_VOICE_SETTINGS,
  type VoiceInput,
  type VoiceOutput,
  type VoiceSettings,
} from './voice/index.js';

@customElement('anya-voice')
class AnyaVoice extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: var(--bg, #1a1a2e);
      color: var(--fg, #e0e0e0);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      gap: 16px;
      padding: 16px;
      box-sizing: border-box;
    }
    .status {
      font-size: 13px;
      opacity: 0.7;
      text-align: center;
      min-height: 20px;
    }
    .mic-ring {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.05);
      border: 2px solid rgba(255, 255, 255, 0.15);
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 32px;
      user-select: none;
    }
    .mic-ring:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.3);
    }
    .mic-ring.listening {
      border-color: #ef4444;
      background: rgba(239, 68, 68, 0.15);
      animation: pulse 1.5s ease-in-out infinite;
    }
    .mic-ring.speaking {
      border-color: #3b82f6;
      background: rgba(59, 130, 246, 0.15);
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }
    .transcript {
      font-size: 14px;
      text-align: center;
      max-width: 100%;
      overflow-wrap: break-word;
      opacity: 0.9;
      min-height: 40px;
      max-height: 120px;
      overflow-y: auto;
    }
    .hint {
      font-size: 11px;
      opacity: 0.5;
      text-align: center;
    }
  `;

  @state() private isListening = false;
  @state() private isSpeaking = false;
  @state() private statusText = 'Tap to speak';
  @state() private transcript = '';

  private voiceInput: VoiceInput = new OffscreenSpeechInput();
  private voiceOutput: VoiceOutput = new WebSpeechOutput();
  private voiceSettings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };

  connectedCallback(): void {
    super.connectedCallback();
    this.loadSettings();
    this.setupVoiceHandlers();
    this.listenForMessages();
    // Auto-start listening when sidebar opens
    setTimeout(() => this.startListening(), 300);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.voiceInput.stop();
    this.voiceOutput.stop();
  }

  private async loadSettings(): Promise<void> {
    try {
      const result = await chrome.storage.local.get('anya-voice-settings');
      const s = result['anya-voice-settings'] as VoiceSettings | undefined;
      if (s) this.voiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...s };
      this.voiceOutput.rate = this.voiceSettings.rate;
      this.voiceOutput.pitch = this.voiceSettings.pitch;
      if (this.voiceSettings.voiceId) this.voiceOutput.setVoice(this.voiceSettings.voiceId);
    } catch { /* ignore */ }
  }

  private setupVoiceHandlers(): void {
    this.voiceInput.onResult = (text, isFinal) => {
      if (isFinal) {
        this.transcript = text;
        this.statusText = 'Sending…';
        // Send transcribed text to the popup window
        chrome.runtime.sendMessage({ type: 'anya-voice-transcript', text });
        // Brief pause then resume listening
        setTimeout(() => {
          if (!this.isSpeaking) {
            this.statusText = 'Listening…';
          }
        }, 500);
      } else {
        this.transcript = text;
        this.statusText = 'Listening…';
      }
    };

    this.voiceInput.onError = (error) => {
      this.isListening = false;
      this.statusText = error === 'not-allowed'
        ? 'Mic access denied'
        : 'Error — tap to retry';
    };

    this.voiceInput.onEnd = () => {
      this.isListening = false;
      if (!this.isSpeaking) {
        this.statusText = 'Tap to speak';
      }
    };
  }

  /** Listen for messages from the popup (e.g. speak response, stop). */
  private listenForMessages(): void {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'anya-voice-speak') {
        this.speak(msg.text);
      } else if (msg.type === 'anya-voice-stop') {
        this.voiceInput.stop();
        this.voiceOutput.stop();
        this.isListening = false;
        this.isSpeaking = false;
        this.statusText = 'Tap to speak';
      }
    });
  }

  private async startListening(): Promise<void> {
    this.voiceInput.continuous = !this.voiceSettings.autoSubmit;
    try {
      await this.voiceInput.start();
      this.isListening = this.voiceInput.listening;
      this.statusText = this.isListening ? 'Listening…' : 'Tap to speak';
    } catch {
      this.statusText = 'Mic unavailable — tap to retry';
    }
  }

  private async toggleListening(): Promise<void> {
    if (this.isListening) {
      this.voiceInput.stop();
      this.isListening = false;
      this.statusText = 'Tap to speak';
    } else {
      await this.startListening();
    }
  }

  private speak(text: string): void {
    this.isSpeaking = true;
    this.statusText = 'Speaking…';
    this.voiceOutput.onEnd = () => {
      this.isSpeaking = false;
      this.statusText = 'Tap to speak';
      // Resume listening after speaking (hands-free loop)
      if (this.voiceSettings.autoSubmit) {
        this.startListening();
      }
    };
    this.voiceOutput.onError = () => {
      this.isSpeaking = false;
      this.statusText = 'Tap to speak';
    };
    this.voiceOutput.speak(text);
  }

  render() {
    const ringClass = this.isListening ? 'listening' : this.isSpeaking ? 'speaking' : '';
    const icon = this.isListening ? '⏹' : this.isSpeaking ? '🔊' : '🎤';
    return html`
      <div class="status">${this.statusText}</div>
      <div
        class="mic-ring ${ringClass}"
        @click=${() => this.toggleListening()}
        title=${this.isListening ? 'Stop listening' : 'Start voice input'}
      >${icon}</div>
      <div class="transcript">${this.transcript}</div>
      <div class="hint">Voice sidebar — responses appear in main window</div>
    `;
  }
}
