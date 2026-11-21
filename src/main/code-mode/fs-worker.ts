// Worker entry of run_code's file reads (Code Mode, ADR 0331), bundled beside main as out/main/code-mode-fs-worker.js
// (scripts/build.mjs): it runs code-mode/fs-ops.ts off the Electron main process. Started and ended by
// code-mode/fs-run.ts, which terminates it when a request takes too long.
import { parentPort } from 'node:worker_threads';
import { fsOp, type FsRequest } from './fs-ops';

parentPort!.on('message', ({ id, req }: { id: number; req: FsRequest }) => {
  try { parentPort!.postMessage({ id, value: fsOp(req) }); }
  catch (e) { parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) }); }
});
