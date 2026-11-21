// Runs run_code's file reads (code-mode/fs-ops.ts) in their worker thread (code-mode/fs-worker.ts), with a time limit
// per request: one that takes longer (a regex that backtracks, a huge folder) ends the worker, and the next request
// starts a new one. An aborted run (its script ended) rejects its pending requests. Never falls back to the main
// thread. Used by code-mode/natives.ts; tests pass their own runner (no thread).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { FsRequest, FsResult } from './fs-ops';

export type FsRunner = (req: FsRequest, opts: { timeoutMs: number; signal?: AbortSignal }) => Promise<FsResult>;

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve(v: FsResult): void; reject(e: Error): void }>();

function stop(error: Error): void {
  const w = worker; worker = null;
  for (const p of waiting.values()) p.reject(error);
  waiting.clear();
  if (w) void w.terminate();
}

function ensure(): Worker {
  if (worker) return worker;
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'code-mode-fs-worker.js');
  if (!fs.existsSync(file)) throw new Error('the file worker of run_code is missing (out/main/code-mode-fs-worker.js): rebuild the app');
  const w = new Worker(file);
  worker = w;
  w.on('message', (m: { id: number; value?: FsResult; error?: string }) => {
    const p = waiting.get(m.id); if (!p) return;
    waiting.delete(m.id);
    if (m.error !== undefined) p.reject(new Error(m.error)); else p.resolve(m.value!);
  });
  w.on('error', e => { if (worker === w) stop(e); });
  w.on('exit', code => { if (worker === w) stop(new Error(`the file worker exited (${code})`)); });
  w.unref();
  return w;
}

/** The default runner: the worker thread, its time limit, the run's abort. */
export const workerRunner: FsRunner = (req, opts) => new Promise<FsResult>((resolve, reject) => {
  if (opts.signal?.aborted) { reject(new Error('The call was cancelled.')); return; }
  let w: Worker;
  try { w = ensure(); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); return; }
  const id = ++seq;
  const done = (): void => { clearTimeout(timer); opts.signal?.removeEventListener('abort', cancel); };
  const cancel = (): void => { if (!waiting.delete(id)) return; done(); reject(new Error('The call was cancelled.')); };
  const timer = setTimeout(() => {
    if (!waiting.has(id)) return;
    // the thread may be stuck in a regex: only ending it frees it (the other requests fail too, and may run again)
    stop(new Error(`${req.op === 'grep' ? 'Grep' : req.op === 'read' ? 'Read' : 'The folder walk'} took over ${Math.round(opts.timeoutMs / 1000)} s and was stopped: narrow the path or the pattern`));
  }, opts.timeoutMs);
  timer.unref?.();
  opts.signal?.addEventListener('abort', cancel);
  waiting.set(id, { resolve: v => { done(); resolve(v); }, reject: e => { done(); reject(e); } });
  w.postMessage({ id, req });
});
