// The hybrid search's worker thread (built to out/main/search-worker.js): owns the SQLite index and the embedding model
// so indexing, embedding and the model's download never hold the main process. Requests from main ({ id, op, ... }) are
// answered in order ({ id, ok, result | error }); model and index changes are pushed as { event: 'status' }. After a
// sync or once the model is loaded, the chunks without a vector are embedded in small batches, yielding between them so
// a query never waits more than one batch. Started by hybrid/service.ts.
import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { downloadModel, loadEmbedder, MODEL_BYTES, modelPresent, type Mode } from './embedder';
import { BRAIN, Engine } from './engine';
import { openStore, vecExtension } from './store';
import type { HybridStatus, WorkerReq } from './protocol';

const { dir } = workerData as { dir: string };
const modelDir = path.join(dir, 'model');
const store = openStore(path.join(dir, 'index.db'), vecExtension());
const engine = new Engine(store);
let model: HybridStatus['model'] = { state: 'missing' };
let pumping = false;

const status = (): HybridStatus => ({ model, ...engine.status() });
const push = () => parentPort!.postMessage({ event: 'status', status: status() });

async function load(): Promise<void> {
  model = { state: 'loading' }; push();
  try { engine.setEmbedder(await loadEmbedder(modelDir)); model = { state: 'ready' }; }
  catch (e) { model = { state: 'failed', error: `model not loaded: ${String((e as Error)?.message ?? e).slice(0, 300)}` }; }
  push();
  void pump();
}

async function download(): Promise<void> {
  if (model.state === 'downloading' || model.state === 'ready' || model.state === 'loading') return;
  let last = 0;
  model = { state: 'downloading', done: 0, total: MODEL_BYTES }; push();
  try {
    await downloadModel(modelDir, done => {
      model = { state: 'downloading', done, total: MODEL_BYTES };
      if (done - last > MODEL_BYTES / 100) { last = done; push(); } // about one status per percent
    });
  } catch (e) { model = { state: 'failed', error: String((e as Error)?.message ?? e).slice(0, 300) }; push(); return; }
  await load();
}

/** Embeds what is missing, one batch at a time. */
async function pump(): Promise<void> {
  if (pumping || !engine.model) return;
  pumping = true;
  try {
    let n = 0;
    for (let done; (done = await engine.embedPending(8)) > 0;) {
      n += done;
      if (n % 200 < 8) push();
      await new Promise(r => setImmediate(r));
    }
  } catch (e) { model = { state: 'failed', error: `embedding stopped: ${String((e as Error)?.message ?? e).slice(0, 300)}` }; engine.setEmbedder(null); }
  finally { pumping = false; push(); }
}

async function handle(m: WorkerReq): Promise<unknown> {
  switch (m.op) {
    case 'init': if (modelPresent(modelDir)) await load(); else if (m.download) void download(); else push(); return status();
    case 'download': void download(); return status();
    case 'sync': { const n = await engine.sync(m.root); if (n) { push(); void pump(); } return n; }
    case 'query': return engine.query(m.q, { ...(m.limit ? { limit: m.limit } : {}), prefix: m.prefix ?? BRAIN });
    case 'embed': return engine.embed(m.texts, m.mode as Mode);
    case 'vectors': return engine.vectors(m.prefix);
    case 'status': return status();
  }
}

// one request at a time: SQLite and the model are used by one caller
let queue: Promise<unknown> = Promise.resolve();
parentPort!.on('message', (m: WorkerReq & { id: number }) => {
  queue = queue.then(() => handle(m).then(result => parentPort!.postMessage({ id: m.id, ok: true, result }), (e: unknown) => parentPort!.postMessage({ id: m.id, ok: false, error: String((e as Error)?.message ?? e) })));
});
