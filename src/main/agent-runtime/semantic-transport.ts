// Bounded semantic transport for the host/proxy: large values cross as acknowledged chunks, never partial UI items.
// One in-flight frame per session preserves boundaries and gives other sessions a turn between chunks.
export type SemanticFrame<T> = { kind: 'value'; value: T }
  | { kind: 'fragment'; id: number; offset: number; total: number; data: string };
const MAX_VALUE_BYTES = 16 * 1024 * 1024;
const CHUNK_BYTES = 128 * 1024;

export class SemanticSender<T> {
  private queue: Buffer[] = [];
  private bytes = 0;
  private sequence = 0;
  private closed = false;
  private pumping: Promise<void> | null = null;

  constructor(private readonly post: (frame: SemanticFrame<T>) => Promise<void>, private readonly failed: () => void,
    private readonly maxBytes = 64 * 1024 * 1024) {}

  send(value: T): void {
    if (this.closed) return;
    const data = Buffer.from(JSON.stringify(value));
    if (data.length > MAX_VALUE_BYTES || this.bytes + data.length > this.maxBytes || this.queue.length >= 256) {
      this.close(); this.failed(); return;
    }
    this.queue.push(data); this.bytes += data.length;
    this.pumping ??= this.pump();
  }

  async drain(): Promise<void> { await this.pumping; }
  close(): void { this.closed = true; this.queue = []; this.bytes = 0; }

  private async pump(): Promise<void> {
    try {
      while (!this.closed && this.queue.length) {
        const data = this.queue[0]!;
        if (data.length <= CHUNK_BYTES) await this.post({ kind: 'value', value: JSON.parse(data.toString('utf8')) as T });
        else {
          const id = ++this.sequence;
          for (let offset = 0; offset < data.length && !this.closed; offset += CHUNK_BYTES)
            await this.post({ kind: 'fragment', id, offset, total: data.length, data: data.subarray(offset, offset + CHUNK_BYTES).toString('base64') });
        }
        if (!this.closed) { this.queue.shift(); this.bytes -= data.length; }
      }
    } catch { if (!this.closed) { this.close(); this.failed(); } }
    finally { this.pumping = null; }
  }
}

export class SemanticReceiver<T> {
  private pending: { id: number; total: number; offset: number; data: Buffer } | null = null;
  constructor(private readonly deliver: (value: T) => void) {}
  close(): void { this.pending = null; }

  receive(frame: SemanticFrame<T>): void {
    if (frame.kind === 'value') {
      if (this.pending) throw new Error('Semantic boundary interrupted a fragmented value');
      this.deliver(frame.value); return;
    }
    if (!Number.isSafeInteger(frame.total) || frame.total < 1 || frame.total > MAX_VALUE_BYTES
      || !Number.isSafeInteger(frame.id) || !Number.isSafeInteger(frame.offset) || frame.offset < 0
      || typeof frame.data !== 'string' || frame.data.length > Math.ceil(CHUNK_BYTES / 3) * 4)
      throw new Error('Invalid semantic fragment bounds');
    const data = Buffer.from(frame.data, 'base64');
    if (!data.length || data.length > CHUNK_BYTES || frame.offset + data.length > frame.total) throw new Error('Invalid semantic fragment length');
    if (!this.pending) {
      if (frame.offset !== 0) throw new Error('Missing first semantic fragment');
      this.pending = { id: frame.id, total: frame.total, offset: 0, data: Buffer.allocUnsafe(frame.total) };
    }
    const p = this.pending;
    if (p.id !== frame.id || p.total !== frame.total || p.offset !== frame.offset) throw new Error('Out of order semantic fragment');
    data.copy(p.data, p.offset); p.offset += data.length;
    if (p.offset === p.total) {
      this.pending = null;
      this.deliver(JSON.parse(p.data.toString('utf8')) as T);
    }
  }
}
