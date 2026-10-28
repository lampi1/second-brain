// One lazy worker for requested Memoria views and task estimates. No startup work, filesystem watches or polling;
// idle threads receive no jobs. A failure rejects the read, never falls back to blocking the main thread.
import { Worker } from 'node:worker_threads';
import type { AgentRun } from '../shared/agents';
import type { BrainModelState } from '../shared/brain-model';
import type { RunEstimates } from '../shared/task-estimate';
import type { BrainViewInput } from './brainmodel/view';
export type ReadRequest = { op: 'brain'; input: BrainViewInput } | { op: 'estimates'; runs: AgentRun[]; runIds: string[]; now: number };
export interface ReadResults { brain: BrainModelState; estimates: RunEstimates }
export class ReadWorker {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(private readonly file: URL | string = new URL('./read-worker.js', import.meta.url)) {}
  call<K extends ReadRequest['op']>(request: Extract<ReadRequest, { op: K }>): Promise<ReadResults[K]> {
    if (!this.worker) {
      const w = new Worker(this.file); this.worker = w;
      w.on('message', (m: { id: number; value?: unknown; error?: string }) => {
        const pending = this.waiting.get(m.id); if (!pending) return;
        clearTimeout(pending.timer); this.waiting.delete(m.id);
        if (m.error) pending.reject(new Error(m.error)); else pending.resolve(m.value);
      });
      w.on('error', e => { if (this.worker === w) this.stop(e); });
      w.on('exit', code => { if (this.worker === w) this.stop(new Error(`Read worker exited (${code})`)); });
      w.unref();
    }
    const w = this.worker, id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.stop(new Error('Read worker timed out')); }, 60_000); timer.unref();
      this.waiting.set(id, { resolve: value => resolve(value as ReadResults[K]), reject, timer });
      try { w.postMessage({ id, request }); }
      catch (e) { clearTimeout(timer); this.waiting.delete(id); reject(e); }
    });
  }
  stop(error = new Error('Read worker stopped')): void {
    const w = this.worker; this.worker = null;
    for (const p of this.waiting.values()) { clearTimeout(p.timer); p.reject(error); }
    this.waiting.clear(); if (w) void w.terminate();
  }
}
export const readWorker = new ReadWorker();
