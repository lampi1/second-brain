// The main process's long hangs, named from outside it (owner, 2026-11-02: the window froze for 3 minutes as soon as an
// agent started, the log stayed silent, the app had to be killed). The stall watch (perf.ts) and the CPU profile on a
// freeze (perf-profile.ts) run on the main thread, so a hang that never ends leaves nothing. Here a worker thread reads
// a heartbeat the main thread writes into shared memory; when it is HANG_MS old, the worker attaches the inspector to
// the main thread (Session.connectToMainThread), pauses it (V8 handles the pause as an interrupt, inside running JS)
// and writes the main thread's JS stack into the app log itself (`perf` «main process hung», scope perf). Again every
// REPEAT_MS while the hang lasts, at most MAX_SAMPLES per hang. A hang inside native code (a sync spawn or file call)
// pauses only once that call returns: then «no JS stack yet» is logged. Never throws; SB_HANG_WATCH=0 turns it off.
import { Worker } from 'node:worker_threads';
import { log } from './log';

const HANG_MS = 5_000;
const REPEAT_MS = 10_000;
const MAX_SAMPLES = 6;

const WORKER = `
const { workerData } = require('node:worker_threads');
const { Session } = require('node:inspector');
const fs = require('node:fs'), path = require('node:path');
const beat = new Float64Array(workerData.sab);
const { dir, hangMs, repeatMs, max } = workerData;
let hangStart = 0, lastSample = 0, samples = 0, busy = false;
const write = (lvl, msg, data, cause) => {
  const t = new Date().toISOString();
  const line = JSON.stringify({ t, lvl, scope: 'perf', msg, data, ...(cause ? { cause, hint: 'the stack names the code that holds the main thread; npm run logs -- --scope perf --grep hung' } : {}) });
  try { fs.appendFileSync(path.join(dir, 'app-' + t.slice(0, 10) + '.jsonl'), line + '\\n'); } catch {}
};
const urls = new Map();
const frame = f => (f.functionName || '(anonymous)') + ' ' + String(f.url || urls.get(f.location.scriptId) || '').replace(/^.*[\\\\/](out|node_modules|src)[\\\\/]/, '$1/') + ':' + (f.location.lineNumber + 1) + ':' + (f.location.columnNumber + 1);
function sample(gap) {
  busy = true; samples++; lastSample = Date.now();
  let s;
  try { s = new Session(); s.connectToMainThread(); } catch (e) { busy = false; write('warn', 'main process hung', { ms: gap, error: String(e) }, 'hung ' + gap + ' ms, stack not taken'); return; }
  let done = false;
  s.on('Debugger.scriptParsed', ({ params }) => { if (params.url) urls.set(params.scriptId, params.url); });
  const end = () => { if (done) return; done = true; try { s.post('Debugger.disable'); } catch {} try { s.disconnect(); } catch {} busy = false; };
  s.on('Debugger.paused', ({ params }) => {
    const stack = params.callFrames.slice(0, 25).map(frame);
    write('warn', 'main process hung', { ms: Date.now() - beat[0], sample: samples, stack }, 'main thread busy for ' + Math.round((Date.now() - beat[0]) / 1000) + ' s in ' + (stack[0] || '?'));
    try { s.post('Debugger.resume', end); } catch { end(); }
  });
  try { s.post('Debugger.enable', () => s.post('Debugger.pause')); } catch { end(); return; }
  // still no pause: the main thread is in native code (a sync spawn, a file call, a lock), not in JS
  setTimeout(() => { if (!done) write('warn', 'main process hung', { ms: Date.now() - beat[0], sample: samples, stack: null }, 'main thread blocked in native code (no JS stack yet)'); }, 3000).unref();
}
setInterval(() => {
  const gap = Date.now() - beat[0];
  if (gap < hangMs) { if (hangStart) { write('info', 'main process hang over', { ms: Date.now() - hangStart }); hangStart = 0; samples = 0; } return; }
  if (!hangStart) hangStart = beat[0];
  if (busy || samples >= max || Date.now() - lastSample < repeatMs) return;
  sample(gap);
}, 1000);
`;

/** Starts the watch (index.ts, after log.init). The heartbeat is written every second by a main-thread timer. */
export function startHangWatch(): () => void {
  const dir = log.folder;
  if (!dir || process.env.SB_HANG_WATCH === '0') return () => {};
  try {
    const sab = new SharedArrayBuffer(8), beat = new Float64Array(sab);
    beat[0] = Date.now();
    const timer = setInterval(() => { beat[0] = Date.now(); }, 500);
    timer.unref?.();
    const w = new Worker(WORKER, { eval: true, workerData: { sab, dir, hangMs: HANG_MS, repeatMs: REPEAT_MS, max: MAX_SAMPLES } });
    w.unref();
    w.on('error', e => log.warn('perf', 'hang watch stopped', { cause: String(e) }));
    return () => { clearInterval(timer); void w.terminate(); };
  } catch (e) { log.warn('perf', 'hang watch not started', { cause: String(e) }); return () => {}; }
}
