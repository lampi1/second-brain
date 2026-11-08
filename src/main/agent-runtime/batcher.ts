// Bounded semantic-item coalescing for the utility host. First output is immediate; subsequent adjacent snapshots
// of one item coalesce for 16 ms. Ordering boundaries flush synchronously and never share a queue between sessions.
import type { ChatItem } from '../../shared/contract';

export interface RuntimeItem { item: ChatItem; replace: boolean }
export class RuntimeBatchOverflow extends Error {
  constructor() { super('Runtime semantic batch limit exceeded'); this.name = 'RuntimeBatchOverflow'; }
}

export class RuntimeBatcher {
  private queue: { value: RuntimeItem; bytes: number }[] = [];
  private bytes = 1; // opening/closing brackets plus one comma per entry (the last comma accounts for ']')
  private timer: ReturnType<typeof setTimeout> | undefined;
  private first = true;
  private firstText = true;
  private closed = false;

  constructor(private readonly emit: (items: readonly RuntimeItem[]) => void,
    private readonly bounds = { intervalMs: 16, maxItems: 64, maxBytes: 256 * 1024 }) {
    if (!Number.isFinite(bounds.intervalMs) || bounds.intervalMs < 0 || !Number.isSafeInteger(bounds.maxItems) || bounds.maxItems < 1
      || !Number.isSafeInteger(bounds.maxBytes) || bounds.maxBytes < 1) throw new Error('Invalid runtime batch bounds');
  }

  item(item: ChatItem, replace: boolean): void {
    if (this.closed) throw new Error('Runtime batcher closed');
    // Snapshot now: adapters may mutate their item before the scheduled flush.
    const value: RuntimeItem = { item: structuredClone(item), replace };
    const bytes = Buffer.byteLength(JSON.stringify(value)) + 1;
    if (bytes + 1 > this.bounds.maxBytes) throw new RuntimeBatchOverflow();
    if (item.kind === 'result') { this.boundary(); this.emit([value]); this.first = true; this.firstText = true; return; }
    const firstText = this.firstText && item.kind === 'assistant' && !!item.text;
    if (this.first || firstText) {
      this.flush(); this.first = false;
      if (firstText) this.firstText = false;
      this.emit([value]); this.schedule(); return;
    }
    const last = this.queue.at(-1);
    // Only adjacent snapshots coalesce: never move A past an intervening B, or convert a first insert to replacement.
    if (replace && last?.value.item.id === item.id && last.value.item.kind === item.kind) {
      const merged = { ...value, replace: last.value.replace };
      const mergedBytes = Buffer.byteLength(JSON.stringify(merged)) + 1;
      if (this.bytes - last.bytes + mergedBytes > this.bounds.maxBytes) this.flush();
      else {
        this.bytes += mergedBytes - last.bytes;
        this.queue[this.queue.length - 1] = { value: merged, bytes: mergedBytes };
        this.schedule(); return;
      }
    }
    if (this.queue.length >= this.bounds.maxItems || this.bytes + bytes > this.bounds.maxBytes) this.flush();
    this.queue.push({ value, bytes }); this.bytes += bytes; this.schedule();
  }

  /** Call before pending/resolved/state/error/cancel/exit events, before their own transport send. */
  boundary(): void { this.flush(); }

  close(): void { if (!this.closed) { this.flush(); this.closed = true; } }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, this.bounds.intervalMs);
    this.timer.unref?.();
  }

  private flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (!this.queue.length) return;
    const items = this.queue.map(x => x.value);
    this.queue = []; this.bytes = 1;
    this.emit(items);
  }
}
