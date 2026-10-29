// Brain themes cache (regression of PR #18): an in-place edit of ai-errors.md that keeps the chunk's length (a date
// fixed) refreshes the themes, even when the store reuses the same chunk ids after re-indexing (delete + insert without
// AUTOINCREMENT).
import { describe, expect, it } from 'vitest';
import { HybridSearch } from '../../../src/main/search/hybrid/service';
import { Store } from '../../../src/main/search/hybrid/store';

const DIM = 8;
const unit = (axis: number) => { const v = new Float32Array(DIM); v[axis] = 1; return v; };

describe('HybridSearch.themes cache', () => {
  it('reflects a same-length correction of an error line (date fixed in place)', async () => {
    // the real store: re-putting the last indexed document gives its chunks the same ids
    const store = new Store(':memory:', null);
    const doc = 'brain:ai-errors.md';
    const lineA = '- 2026-10-16 10:00 · claude · costi · stale-data · detto: costi giornalieri zero · vero: costi corretti';
    const lineB = '- 2026-10-15 10:00 · claude · costi · stale-data · detto: costi cursor mancanti · vero: costi corretti';
    const fixed = lineA.replace('2026-10-16', '2026-10-17'); // same length
    store.put({ key: 'brain:other.md', size: 1, mtimeMs: 1 }, [{ line: 1, text: 'altro file' }]);
    store.put({ key: doc, size: 1, mtimeMs: 1 }, [{ line: 1, text: lineA }, { line: 3, text: lineB }]);
    const before = store.chunks([1, 2, 3]).filter(r => r.doc === doc).map(r => r.id);
    store.put({ key: doc, size: 1, mtimeMs: 2 }, [{ line: 1, text: fixed }, { line: 3, text: lineB }]);
    const after = store.chunks([1, 2, 3]).filter(r => r.doc === doc).map(r => r.id);
    expect(after).toEqual(before); // ids reused: the cache key cannot tell the two versions apart

    let rows = [{ id: before[0]!, doc, line: 1, text: lineA, v: unit(0) }, { id: before[1]!, doc, line: 3, text: lineB, v: unit(0) }];
    class Fake extends HybridSearch {
      constructor() {
        super({ dir: '', brainRoot: () => 'C:/brain', workerFile: '', download: false });
        (this as unknown as { last: { model: { state: string } } }).last.model.state = 'ready';
        (this as unknown as { syncedRoot: string }).syncedRoot = 'C:/brain';
      }
      override vectors() { return Promise.resolve(rows); }
    }
    const h = new Fake();
    const now = Date.parse('2026-10-17T10:00:00Z');
    const first = await h.themes('errors', now);
    expect(first.themes[0]!.entries.map(e => e.day)).toEqual(['2026-10-16', '2026-10-15']);
    // the file is corrected and re-indexed (and re-embedded): same ids, lines and lengths, new text
    rows = [{ id: after[0]!, doc, line: 1, text: fixed, v: unit(0) }, { id: after[1]!, doc, line: 3, text: lineB, v: unit(0) }];
    const second = await h.themes('errors', now + 60_000);
    expect(second.themes.flatMap(t => t.entries.map(e => e.day)), 'themes still show the date before the correction').toContain('2026-10-17');
  });
});
