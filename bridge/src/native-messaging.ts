import { error, warn } from './log.js';

const MAX_MESSAGE_SIZE = 1024 * 1024; // 1 MB — Native Messaging limit

type FrameHandler = (frame: unknown) => void;
type CloseHandler = () => void;

export class NativeMessagingTransport {
  private buffer: Buffer = Buffer.alloc(0);
  private frameHandler: FrameHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private closed = false;

  constructor() {
    process.stdin.on('data', (chunk: Buffer) => this.onData(chunk));
    process.stdin.on('end', () => this.handleClose('end'));
    process.stdin.on('close', () => this.handleClose('close'));
    process.stdin.on('error', (err) => {
      error('stdin error:', err);
      this.handleClose('error');
    });
  }

  onFrame(handler: FrameHandler): void {
    this.frameHandler = handler;
  }

  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  send(frame: unknown): void {
    let json: string;
    try {
      json = JSON.stringify(frame);
    } catch (err) {
      error('failed to stringify outgoing frame:', err);
      return;
    }
    const body = Buffer.from(json, 'utf8');
    if (body.length > MAX_MESSAGE_SIZE) {
      error(`outgoing frame exceeds max size (${body.length} > ${MAX_MESSAGE_SIZE})`);
      return;
    }
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    process.stdout.write(header);
    process.stdout.write(body);
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  private drain(): void {
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > MAX_MESSAGE_SIZE) {
        error(`incoming frame too large (${length}); closing transport`);
        this.handleClose('oversize');
        return;
      }
      if (this.buffer.length < 4 + length) {
        // wait for more data
        return;
      }
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      let frame: unknown;
      try {
        frame = JSON.parse(body.toString('utf8'));
      } catch (err) {
        warn('dropping malformed JSON frame:', err);
        continue;
      }
      if (this.frameHandler) {
        try {
          this.frameHandler(frame);
        } catch (err) {
          error('frame handler threw:', err);
        }
      }
    }
  }

  private handleClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    warn(`transport closed (${reason})`);
    if (this.closeHandler) {
      try {
        this.closeHandler();
      } catch (err) {
        error('close handler threw:', err);
      }
    }
  }
}
