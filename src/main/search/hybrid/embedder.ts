// The local embedding model of the hybrid search (Brother, 2026-10-17: multilingual IT+EN, quantized, CPU, offline, zero
// API cost): multilingual-e5-small int8 (384 dimensions, ~135 MB with its tokenizer) from a pinned Hugging Face
// revision, downloaded once into userData/search/model with every file's sha256 checked, then loaded with
// onnxruntime-node (CPU, two threads) and @huggingface/tokenizers. e5 wants "query: " / "passage: " prefixes; vectors
// are mean-pooled and L2-normalised, so cosine = dot product. Runs only in the worker thread (hybrid/worker.ts).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const MODEL_ID = 'multilingual-e5-small-int8';
const REPO = 'Xenova/multilingual-e5-small';
const REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const FILES: { name: string; src: string; sha256: string; size: number }[] = [
  { name: 'tokenizer_config.json', src: 'tokenizer_config.json', sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b', size: 443 },
  { name: 'tokenizer.json', src: 'tokenizer.json', sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39', size: 17_082_730 },
  { name: 'model.onnx', src: 'onnx/model_quantized.onnx', sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193', size: 118_308_185 },
];
export const MODEL_BYTES = FILES.reduce((s, f) => s + f.size, 0);
const MAX_TOKENS = 512;
const STALL_MS = 30_000; // a download that receives nothing for this long is aborted (then «Riprova»)

export type Mode = 'query' | 'passage';
export interface Embedder { id: string; embed(texts: string[], mode: Mode): Promise<Float32Array[]> }

/** Are all model files on disk (sizes only: the hashes were checked when they were downloaded)? */
export function modelPresent(dir: string): boolean {
  return FILES.every(f => { try { return fs.statSync(path.join(dir, f.name)).size === f.size; } catch { return false; } });
}

/** Downloads the missing model files into `dir` (a .part file renamed once its sha256 matches). `progress` gets the
 *  bytes done of MODEL_BYTES. Throws on a network error or a hash mismatch (the .part is deleted). */
export async function downloadModel(dir: string, progress: (done: number) => void, fetchFn: typeof fetch = fetch): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  let done = 0;
  for (const f of FILES) {
    const dest = path.join(dir, f.name);
    if (fs.existsSync(dest) && fs.statSync(dest).size === f.size) { done += f.size; progress(done); continue; }
    const ac = new AbortController();
    let stall = setTimeout(() => ac.abort(new Error(`download of ${f.name} stalled`)), STALL_MS);
    const alive = () => { clearTimeout(stall); stall = setTimeout(() => ac.abort(new Error(`download of ${f.name} stalled`)), STALL_MS); };
    let res: Response;
    try { res = await fetchFn(`https://huggingface.co/${REPO}/resolve/${REVISION}/${f.src}`, { signal: ac.signal }); }
    catch (e) { clearTimeout(stall); throw e; }
    if (!res.ok || !res.body) { clearTimeout(stall); throw new Error(`download of ${f.name} failed: HTTP ${res.status}`); }
    const part = `${dest}.part`;
    const out = fs.createWriteStream(part);
    const hash = crypto.createHash('sha256');
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        alive();
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise<void>(r => out.once('drain', () => r()));
        done += chunk.length; progress(done);
      }
      await new Promise<void>((res2, rej) => out.end((e?: Error | null) => (e ? rej(e) : res2())));
      const got = hash.digest('hex');
      if (got !== f.sha256) throw new Error(`${f.name}: sha256 mismatch (got ${got.slice(0, 12)}…)`);
      fs.renameSync(part, dest);
    } catch (e) {
      out.destroy();
      try { fs.rmSync(part, { force: true }); } catch { /* best effort */ }
      throw ac.signal.aborted && ac.signal.reason instanceof Error ? ac.signal.reason : e;
    } finally { clearTimeout(stall); }
  }
}

interface Ort {
  InferenceSession: { create(file: string, o: object): Promise<{ inputNames: readonly string[]; outputNames: readonly string[]; run(f: object): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>> }> };
  Tensor: new (type: string, data: BigInt64Array, dims: number[]) => object;
}
interface Tok { encode(t: string): { ids: number[] } }

/** Loads the model from `dir` (all files present). `requireFrom` = where onnxruntime-node is resolved (the build's out/). */
export async function loadEmbedder(dir: string, requireFrom: string = import.meta.url): Promise<Embedder> {
  const req = createRequire(requireFrom);
  const ort = req('onnxruntime-node') as Ort;
  const { Tokenizer } = req('@huggingface/tokenizers') as { Tokenizer: new (j: object, c: object) => Tok };
  const json = (n: string) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) as object;
  const tok = new Tokenizer(json('tokenizer.json'), json('tokenizer_config.json'));
  const sess = await ort.InferenceSession.create(path.join(dir, 'model.onnx'), { intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: 'all' });
  const typeIds = sess.inputNames.includes('token_type_ids');
  return {
    id: MODEL_ID,
    async embed(texts, mode) {
      if (!texts.length) return [];
      const encs = texts.map(t => tok.encode(`${mode}: ${t}`).ids.slice(0, MAX_TOKENS));
      const n = texts.length, len = Math.max(...encs.map(e => e.length));
      const ids = new BigInt64Array(n * len), mask = new BigInt64Array(n * len);
      encs.forEach((e, i) => e.forEach((id, j) => { ids[i * len + j] = BigInt(id); mask[i * len + j] = 1n; }));
      const feeds: Record<string, object> = { input_ids: new ort.Tensor('int64', ids, [n, len]), attention_mask: new ort.Tensor('int64', mask, [n, len]) };
      if (typeIds) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(n * len), [n, len]);
      const out = await sess.run(feeds);
      const h = out[sess.outputNames[0]!]!;
      const dim = h.dims[2]!;
      return encs.map((e, i) => meanNorm(h.data, i * len * dim, e.length, dim));
    },
  };
}

/** Mean of the first `count` token vectors starting at `off`, L2-normalised. */
export function meanNorm(data: Float32Array, off: number, count: number, dim: number): Float32Array {
  const v = new Float32Array(dim);
  for (let t = 0; t < count; t++) for (let d = 0; d < dim; d++) v[d] = v[d]! + data[off + t * dim + d]!;
  let norm = 0;
  for (let d = 0; d < dim; d++) { const x = v[d]! / Math.max(1, count); v[d] = x; norm += x * x; }
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < dim; d++) v[d] = v[d]! / norm;
  return v;
}
