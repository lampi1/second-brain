// One lazy worker for requested Memoria views and task estimates. No startup work, filesystem watches or polling;
// idle threads receive no jobs. A failure rejects the read, never falls back to blocking the main thread.
// The agent runs (up to 5000) are copied to the worker only when they changed: a caller that passes the store's revision
// gets them sent once per revision, the worker keeps that copy (posting them every time froze the window, #276, #277).
import { Worker } from 'node:worker_threads';
import { withRuns, type ReadMessage, type ReadRequest, type ReadResults } from './read-protocol';
export type { ReadRequest, ReadResults } from './read-protocol';
export class ReadWorker {
  private worker: Worker | null = null;
  private seq = 0;
  /** the key of the runs the current worker holds (null: none, or a new worker) */
  private sent: string | null = null;
  private waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(private readonly file: URL | string = new URL('./read-worker.js', import.meta.url)) {}
  /** runsKey: what identifies the request's runs (the store's revision); same key as the last sent = not copied again. */
  call<K extends ReadRequest['op']>(request: Extract<ReadRequest, { op: K }>, runsKey?: string): Promise<ReadResults[K]> {
    if (!this.worker) {
      const w = new Worker(this.file); this.worker = w;
      w.on('message', (m: { id: number; value?: unknown; error?: string }) => {
        const pending = this.waiting.get(m.id); if (!pending) return;
        clearTimeout(pending.timer); this.waiting.delete(m.id);
        // a failed read may have left the worker without the runs it was sent: they go again with the next read
        if (m.error) { this.sent = null; pending.reject(new Error(m.error)); } else pending.resolve(m.value);
      });
      w.on('error', e => { if (this.worker === w) this.stop(e); });
      w.on('messageerror', e => { if (this.worker === w) this.stop(e); });
      w.on('exit', code => { if (this.worker === w) this.stop(new Error(`Read worker exited (${code})`)); });
      w.unref();
    }
    const w = this.worker, id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.stop(new Error('Read worker timed out')); }, 60_000); timer.unref();
      this.waiting.set(id, { resolve: value => resolve(value as ReadResults[K]), reject, timer });
      const message: ReadMessage = runsKey === undefined ? { id, request }
        : runsKey === this.sent ? { id, request: withRuns(request, []), runsKey, cached: true } : { id, request, runsKey };
      try { w.postMessage(message); if (!message.cached && message.runsKey !== undefined) this.sent = message.runsKey; }
      catch (e) { clearTimeout(timer); this.waiting.delete(id); reject(e); }
    });
  }
  stop(error = new Error('Read worker stopped')): void {
    const w = this.worker; this.worker = null; this.sent = null;
    for (const p of this.waiting.values()) { clearTimeout(p.timer); p.reject(error); }
    this.waiting.clear(); if (w) void w.terminate();
  }
}
export const readWorker = new ReadWorker();
