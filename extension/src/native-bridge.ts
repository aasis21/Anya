// Native messaging bridge to com.anya.bridge with auto-reconnect.

export type Frame =
  | { type: 'prompt'; text: string }
  | { type: 'echo-reply'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: string; [k: string]: unknown };

type MessageHandler = (frame: Frame) => void;
type DisconnectHandler = (err?: string) => void;

const HOST_NAME = 'com.anya.bridge';
const RECONNECT_DELAY_MS = 2000;

class NativeBridge {
  private port: chrome.runtime.Port | null = null;
  private messageHandlers = new Set<MessageHandler>();
  private disconnectHandlers = new Set<DisconnectHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  connect(): void {
    if (this.port) return;
    try {
      this.port = chrome.runtime.connectNative(HOST_NAME);
    } catch (err) {
      console.error('[Anya] connectNative threw:', err);
      this.scheduleReconnect();
      return;
    }

    this.port.onMessage.addListener((msg: Frame) => {
      for (const h of this.messageHandlers) {
        try { h(msg); } catch (e) { console.error('[Anya] handler error:', e); }
      }
    });

    this.port.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError?.message;
      if (lastError) console.warn('[Anya] native port disconnected:', lastError);
      this.port = null;
      for (const h of this.disconnectHandlers) {
        try { h(lastError); } catch (e) { console.error('[Anya] disconnect handler error:', e); }
      }
      if (this.shouldReconnect) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  send(frame: Frame): boolean {
    if (!this.port) return false;
    try {
      this.port.postMessage(frame);
      return true;
    } catch (err) {
      console.error('[Anya] postMessage failed:', err);
      return false;
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onDisconnect(handler: DisconnectHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  isConnected(): boolean {
    return this.port !== null;
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.port?.disconnect();
    this.port = null;
  }
}

export const nativeBridge = new NativeBridge();
