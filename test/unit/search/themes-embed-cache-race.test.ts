// Brain themes embedding cache (regression of PR #18): two overlapping ideas calls never get an entry without a vector,
// even when the second one clears the text-vector cache (TEXT_VECS_MAX overflow) while the first awaits a batch.
import { describe, expect, it } from 'vitest';
import { HybridSearch } from '../../../src/main/search/hybrid/service';

const DIM = 8;
const unit = (axis: number) => { const v = new Float32Array(DIM); v[axis % DIM] = 1; return v; };
const ideaRows = (tag: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, doc: 'brain:ideas.md', line: i * 3 + 1,
  text: `## 2026-10-1${i % 10} · Idea ${tag} ${i} · \`aperta\`\n- **Idea:** cosa ${tag} ${i}`, v: unit(0) }));

describe('HybridSearch.themes (ideas) concurrent embedding', () => {
  it('two overlapping calls never yield an entry without a vector', async () => {
    let rows = ideaRows('a', 10);
    const gates: (() => void)[] = [];
    class Fake extends HybridSearch {
      constructor() {
        super({ dir: '', brainRoot: () => 'C:/brain', workerFile: '', download: false });
        (this as unknown as { last: { model: { state: string } } }).last.model.state = 'ready';
        (this as unknown as { syncedRoot: string }).syncedRoot = 'C:/brain';
      }
      override vectors() { return Promise.resolve(rows); }
      override embed(texts: string[]) { return new Promise<Float32Array[]>(r => gates.push(() => r(texts.map((_, i) => unit(i))))); }
    }
    const h = new Fake();
    const cache = (h as unknown as { textVecs: Map<string, Float32Array> }).textVecs;
    // a long session: 4990 idea texts embedded earlier; the first 9 ideas of call A among them
    for (let i = 0; i < 4981; i++) cache.set(`old ${i}`, unit(0));
    for (const r of rows.slice(0, 9)) cache.set(`${r.text.split('\n')[0]!.replace(/^## \S+ · /, '').replace(/ · `.*$/, '')}. ${r.text.split('**Idea:** ')[1]}`, unit(1));
    expect(cache.size).toBe(4990);
    const a = h.themes('ideas', Date.parse('2026-10-17T10:00:00Z')).then(() => 'ok', (e: unknown) => String(e)); // 1 missing: no clear, awaits its batch
    await new Promise(r => setTimeout(r, 0));
    expect(gates).toHaveLength(1);
    rows = ideaRows('b', 11); // the file changed: call B has 11 new texts, 4990 + 11 > 5000 → clear()
    const b = h.themes('ideas', Date.parse('2026-10-17T10:00:00Z')).then(() => 'ok', (e: unknown) => String(e));
    await new Promise(r => setTimeout(r, 0));
    gates.splice(0).forEach(g => g());
    await new Promise(r => setTimeout(r, 0));
    gates.splice(0).forEach(g => g());
    const [ra, rb] = await Promise.all([a, b]);
    expect(rb).toBe('ok');
    expect(ra, 'call A crashed on a vector cleared under it').toBe('ok');
  });
});
