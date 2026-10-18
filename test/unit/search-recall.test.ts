// Unit tests of the error recall (SPEC 23 c/d, src/main/search/hybrid/recall.ts): the similarity cut and order, the
// /mcp/recall/<token> endpoint over real HTTP (one tools/call without initialize, as the brain's hook sends it; a wrong
// token looks like a missing route), and HybridSearch.recall (never waits: ready:false while the errors' vectors are
// built in the background, the previous vectors while new lines are embedded).
import { afterEach, describe, expect, it } from 'vitest';
import { McpServer } from '../../src/main/mcp/server';
import { mountRecallTool, RECALL_MIN, RECALL_MIN_ERRORS, recallIndex, similarErrors, type Recall } from '../../src/main/search/hybrid/recall';
import { HybridSearch } from '../../src/main/search/hybrid/service';

const DIM = 64;
/** A unit vector between axis `a` and axis `b` (cosine with axis a = cos θ). */
function vec(a: number, b = (a + 1) % DIM, theta = 0): Float32Array {
  const v = new Float32Array(DIM);
  v[a] = Math.cos(theta); v[b] = v[b]! + Math.sin(theta);
  return v;
}
const entry = (line: number, text = `error ${line}`) => ({ line, text, day: '2026-10-17' });
/** Enough unrelated errors (one axis each from 8 up) for recall to run at all. */
const fillers = (v = (a: number) => vec(a)) => Array.from({ length: RECALL_MIN_ERRORS }, (_, i) => ({ entry: entry(100 + i), v: v(8 + i) }));

describe('similarErrors', () => {
  it('keeps the k most similar entries at or above the cut, best first, scores rounded', () => {
    const q = vec(0);
    const items = [
      { entry: entry(1), v: vec(0, 1, 0.2) },   // cos 0.980
      { entry: entry(2), v: vec(0, 1, 0.05) },  // cos 0.999
      { entry: entry(3), v: vec(0, 1, Math.acos(RECALL_MIN) + 0.01) }, // just under the cut
      { entry: entry(4), v: vec(0, 1, 0.4) },   // cos 0.921
      { entry: entry(5), v: vec(0, 1, 0.3) },   // cos 0.955
      ...fillers(),
    ];
    const index = { mean: new Float32Array(DIM), items }; // a zero mean: the plain cosine
    const hits = similarErrors(q, index, 3);
    expect(hits.map(h => h.line)).toEqual([2, 1, 5]);
    expect(hits[0]).toEqual({ line: 2, text: 'error 2', day: '2026-10-17', score: 0.999 });
    expect(similarErrors(q, index, 5).map(h => h.line)).toEqual([2, 1, 5, 4]);
    expect(similarErrors(vec(3), index)).toEqual([]);
    expect(similarErrors(q, { ...index, items: items.slice(0, RECALL_MIN_ERRORS - 1) })).toEqual([]); // too few errors to tell
  });

  it("centres on the errors' mean, so what every error shares does not make a prompt look similar", () => {
    // every error leans on axis 7 (the file's shared template); they differ on axes 0 and 2
    const lean = (a: number) => vec(a, 7, 1.2);
    const index = recallIndex([{ entry: entry(1), v: lean(0) }, { entry: entry(2), v: lean(2) }, ...fillers(lean)]);
    expect(similarErrors(vec(7), index)).toEqual([]); // the shared part only: raw cosine 0.93 with both
    expect(similarErrors(vec(0, 7, 1.2), index).map(h => h.line)).toEqual([1]);
  });
});

describe('the recall endpoint', () => {
  let mcp: McpServer | null = null;
  afterEach(async () => { await mcp?.close(); mcp = null; });

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: res.status === 200 ? await res.json() as { result?: { content: { text: string }[] } } : null };
  };
  const call = (args: Record<string, unknown>) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recall', arguments: args } });

  it('answers one tools/call (no initialize) on its token URL, and 404 on any other token', async () => {
    mcp = new McpServer({ name: 'test', version: '0' });
    const asked: [string, number][] = [];
    const answer: Recall = { ready: true, errors: [{ ...entry(7), score: 0.91 }] };
    const tool = mountRecallTool(mcp, (text, k) => { asked.push([text, k]); return Promise.resolve(answer); });
    await mcp.listen(0);
    const url = tool.url();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/recall\/[\w-]{32}$/);

    const ok = await post(url, call({ text: '  no, ti ho detto di usare le chat  ', k: 9 }));
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body!.result!.content[0]!.text)).toEqual(answer);
    expect(asked).toEqual([['no, ti ho detto di usare le chat', 5]]); // trimmed, k clamped

    expect(JSON.parse((await post(url, call({ text: '   ' }))).body!.result!.content[0]!.text)).toEqual({ ready: true, errors: [] });
    expect(asked).toHaveLength(1);
    expect((await post(url.replace(/[\w-]{32}$/, 'x'.repeat(32)), call({ text: 'a' }))).status).toBe(404);
  });
});

describe('HybridSearch.recall', () => {
  // one chunk: the PowerShell error first (line 10), then enough other errors for recall to run
  const errorText = (others = RECALL_MIN_ERRORS) => [
    '- 2026-10-16 18:00 · Regia · brain · altro · detto: test node -e con virgolette · vero: PowerShell le rimuove',
    ...Array.from({ length: others }, (_, n) => `- 2026-10-17 09:00 · ui · app · bug · detto: chat ${n} avviate come sottoagenti · vero: chat visibili`),
  ].join('\n');
  class Fake extends HybridSearch {
    embedded: string[] = []; root: string | null = 'C:/brain'; syncs = 0;
    rows = [{ id: 1, doc: 'brain:ai-errors.md', line: 10, text: errorText(), v: vec(5) }];
    constructor(ready: boolean) {
      super({ dir: '', brainRoot: () => this.root, workerFile: '', download: false });
      (this as unknown as { last: { model: { state: string } } }).last.model.state = ready ? 'ready' : 'missing';
      this.synced('C:/brain');
    }
    synced(root: string) { (this as unknown as { syncedRoot: string | null }).syncedRoot = root; }
    override sync() { this.syncs++; return Promise.resolve(false); }
    override vectors() { return Promise.resolve(this.rows); }
    // passages: the PowerShell error on axis 0, the others on axis 2; the query lands next to the PowerShell one
    override embed(texts: string[], mode: 'query' | 'passage') {
      if (mode === 'passage') this.embedded.push(...texts);
      return Promise.resolve(texts.map(t => mode === 'query' ? vec(0, 1, 0.1) : /PowerShell/.test(t) ? vec(0) : vec(2)));
    }
    settled() { return (this as unknown as { warming: Promise<void> | null }).warming ?? Promise.resolve(); }
  }
  const ask = (h: Fake) => h.recall('virgolette in powershell');

  it('is not ready without the model, or while the brain folder is not the synced one (and starts a sync)', async () => {
    expect(await new Fake(false).recall('x')).toEqual({ ready: false, errors: [] });
    const h = new Fake(true);
    h.root = 'D:/other';
    expect(await h.recall('x')).toEqual({ ready: false, errors: [] });
    expect(h.syncs).toBe(1);
  });

  it('answers ready:false while it embeds the errors, then the similar ones; a changed file keeps the old vectors meanwhile', async () => {
    const h = new Fake(true);
    expect(await ask(h)).toEqual({ ready: false, errors: [] });
    await h.settled();
    expect(h.embedded).toHaveLength(RECALL_MIN_ERRORS + 1);
    const r = await ask(h);
    expect(r.ready).toBe(true);
    expect(r.errors.map(e => e.line)).toEqual([10]);
    expect(r.errors[0]!.text).toMatch(/^Regia · brain · altro · detto: test node -e/);

    h.rows[0]!.text += '\n- 2026-10-18 08:00 · ui · app · bug · detto: x · vero: y';
    expect((await ask(h)).ready).toBe(true); // the previous vectors
    await h.settled();
    expect(h.embedded).toHaveLength(RECALL_MIN_ERRORS + 2); // only the new line

    h.rows[0]!.text = h.rows[0]!.text.replace('detto: x', 'detto: z'); // same length, new text
    await ask(h);
    await h.settled();
    expect(h.embedded.at(-1)).toMatch(/detto: z/);
  });

  it("never answers with another brain's errors, even when their vectors finish after the switch", async () => {
    const h = new Fake(true);
    await ask(h); // starts embedding C:/brain's errors
    h.root = 'D:/other'; h.synced('D:/other');
    await h.settled();
    expect(await ask(h)).toEqual({ ready: false, errors: [] }); // D:/other's are being built now
    await h.settled();
    expect((await ask(h)).errors.map(e => e.line)).toEqual([10]);
  });

  it('finds nothing in a file with too few errors to centre on', async () => {
    const h = new Fake(true);
    h.rows[0]!.text = errorText(3);
    await ask(h);
    await h.settled();
    expect(await ask(h)).toEqual({ ready: true, errors: [] });
  });
});
