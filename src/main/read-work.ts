// One lazy worker for requested Memoria views and task estimates. No startup work, filesystem watches or polling;
// idle threads receive no jobs. A failure rejects the read, never falls back to blocking the main thread.
// The agent runs (up to 5000) are copied to the worker only when they changed: a caller that passes the store's revision
// gets them sent once per revision, the worker keeps that copy (posting them every time froze the window, #276, #277).
// Each kind of read (brain view, estimates) keeps its own copy: their keys differ, and one slot made them evict each
// other so every read copied all runs again (#293-#297). The copy is sent as JSON text built in slices
// (chunked-json.ts): posting the run objects was one structured clone of several MB on the main thread.
import { Worker } from 'node:worker_threads';
import { jsonArray, stringifyEach } from './chunked-json';
import { runsOf, withRuns, type ReadMessage, type ReadRequest, type ReadResults } from './read-protocol';
export type { ReadRequest, ReadResults } from './read-protocol';
type Op = ReadRequest['op'];
export class ReadWorker {
  private worker: Worker | null = null;
  private seq = 0;
  /** per kind of read, the key of the runs the current worker holds (absent: none, or a new worker) */
  private sent = new Map<Op, string>();
  /** per kind of read, the runs' JSON being built for a key: two reads of one new key build it once */
  private building = new Map<Op, { key: string; json: Promise<string> }>();
  private waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(private readonly file: URL | string = new URL('./read-worker.js', import.meta.url)) {}
  /** runsKey: what identifies the request's runs (the store's revision); same key as the last sent = not copied again. */
  async call<K extends Op>(request: Extract<ReadRequest, { op: K }>, runsKey?: string): Promise<ReadResults[K]> {
    const op: Op = request.op;
    let runsJson: string | undefined;
    if (runsKey !== undefined && this.sent.get(op) !== runsKey) {
      let b = this.building.get(op);
      if (!b || b.key !== runsKey) {
        const entry = { key: runsKey, json: stringifyEach(runsOf(request)).then(jsonArray) };
        this.building.set(op, entry); b = entry;
        void entry.json.finally(() => { if (this.building.get(op) === entry) this.building.delete(op); }).catch(() => {});
      }
      const json = await b.json;
      // another read of this key may have sent them meanwhile
      if (this.sent.get(op) !== runsKey) runsJson = json;
    }
    const w = this.ensure(), id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.stop(new Error('Read worker timed out')); }, 60_000); timer.unref();
      this.waiting.set(id, { resolve: value => resolve(value as ReadResults[K]), reject, timer });
      const message: ReadMessage = runsKey === undefined ? { id, request }
        : runsJson === undefined ? { id, request: withRuns(request, []), runsKey, cached: true }
        : { id, request: withRuns(request, []), runsKey, runsJson };
      try { w.postMessage(message); if (runsJson !== undefined) this.sent.set(op, runsKey!); }
      catch (e) { clearTimeout(timer); this.waiting.delete(id); reject(e); }
    });
  }
  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(this.file); this.worker = w;
    w.on('message', (m: { id: number; op?: Op; value?: unknown; error?: string }) => {
      const pending = this.waiting.get(m.id); if (!pending) return;
      clearTimeout(pending.timer); this.waiting.delete(m.id);
      // a failed read may have left the worker without the runs it was sent: they go again with the next read
      if (m.error) { if (m.op) this.sent.delete(m.op); else this.sent.clear(); pending.reject(new Error(m.error)); } else pending.resolve(m.value);
    });
    w.on('error', e => { if (this.worker === w) this.stop(e); });
    w.on('messageerror', e => { if (this.worker === w) this.stop(e); });
    w.on('exit', code => { if (this.worker === w) this.stop(new Error(`Read worker exited (${code})`)); });
    w.unref();
    return w;
  }
  stop(error = new Error('Read worker stopped')): void {
    const w = this.worker; this.worker = null; this.sent.clear();
    for (const p of this.waiting.values()) { clearTimeout(p.timer); p.reject(error); }
    this.waiting.clear(); if (w) void w.terminate();
  }
}
export const readWorker = new ReadWorker();
