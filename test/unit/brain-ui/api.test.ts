// The brain pages' data client (src/renderer/brain/api.ts) with a fake 'brain:api' invoke, and the API normalizers
// (src/renderer/brain/types.ts): unwrapping the server's cached answers, errors keeping the last value, in-flight
// dedupe, retries while the server recomputes, invalidation; shapes filled when the server is older or newer.
import { describe, expect, it, vi } from 'vitest';
import type { BrainApiResult } from '../../../src/shared/contract';
import { BrainClient, unwrap, withFresh } from '../../../src/renderer/brain/api';
import { normCost, normMap, normTables } from '../../../src/renderer/brain/types';

describe('unwrap', () => {
  it('cached sources come as {value, at, refreshing}; the rest as they are', () => {
    expect(unwrap('/api/cost?days=7', { ok: true, data: { value: { total: 1 }, at: 5, refreshing: true, error: null } }, 9)).toMatchObject({ data: { total: 1 }, at: 5, refreshing: true, error: null });
    expect(unwrap('/api/tables', { ok: true, data: { today: 'x' } }, 9)).toMatchObject({ data: { today: 'x' }, at: 9, error: null });
    expect(unwrap('/api/map', { ok: true, data: { value: null, error: 'boom' } }, 9)).toMatchObject({ data: null, error: 'boom' });
    expect(unwrap('/api/now', { ok: false, error: 'non parte' }, 9)).toMatchObject({ data: null, error: 'non parte' });
  });
  it('fresh=1 is appended to the query', () => {
    expect(withFresh('/api/cost?days=7')).toBe('/api/cost?days=7&fresh=1');
    expect(withFresh('/api/now')).toBe('/api/now?fresh=1');
  });
});

describe('BrainClient', () => {
  it('dedupes requests in flight and notifies subscribers', async () => {
    const invoke = vi.fn(async (_p: string): Promise<BrainApiResult> => ({ ok: true, data: { n: 1 } }));
    const c = new BrainClient(invoke);
    const seen = vi.fn();
    c.subscribe('/api/tables', seen);
    const [a, b] = await Promise.all([c.get('/api/tables'), c.get('/api/tables')]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c.peek('/api/tables')?.data).toEqual({ n: 1 });
    expect(seen).toHaveBeenCalled();
  });
  it('a failed refresh keeps the last good value on screen, with the error', async () => {
    let fail = false;
    const c = new BrainClient(async () => (fail ? { ok: false, error: 'giù' } : { ok: true, data: [1] }));
    await c.get('/api/files');
    fail = true;
    const e = await c.get('/api/files');
    expect(e).toMatchObject({ data: [1], error: 'giù', loading: false });
  });
  it('asks again while the server says it is recomputing, then stops', async () => {
    vi.useFakeTimers();
    let n = 0;
    const c = new BrainClient(async () => ({ ok: true, data: { value: { n: ++n }, at: n, refreshing: n < 3 } }), Date.now, 1000, 8);
    c.subscribe('/api/map', () => {});
    await c.get('/api/map');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(n).toBe(3);
    expect(c.peek('/api/map')).toMatchObject({ data: { n: 3 }, refreshing: false });
    vi.useRealTimers();
  });
  it('invalidate refetches what is on screen; ensure respects the max age', async () => {
    let t = 0;
    const invoke = vi.fn(async (): Promise<BrainApiResult> => ({ ok: true, data: { t } }));
    const c = new BrainClient(invoke, () => t);
    c.subscribe('/api/tables', () => {});
    await c.get('/api/tables');
    c.ensure('/api/tables', 1000);
    expect(invoke).toHaveBeenCalledTimes(1);
    t = 5000;
    c.ensure('/api/tables', 1000);
    expect(invoke).toHaveBeenCalledTimes(2);
    await c.get('/api/tables'); // the same request, still in flight
    c.invalidate('/api/tables');
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});

describe('normalizers', () => {
  it('tables: every list present even when the server sends little', () => {
    const t = normTables({ today: '2026-10-11', ideas: [{ titolo: 'x', data: '2026-10-01' }] });
    expect(t.errors).toEqual([]);
    expect(t.recurrence).toEqual({ totals: [], rules: [] });
    expect(t.ideas[0]).toMatchObject({ titolo: 'x', stato: '', chi: '' });
  });
  it('cost: chats as an object become a list; map fills its lists', () => {
    expect(normCost({ total: 3, chats: { a: { title: 'x', usd: 2 } } }).chats).toEqual([expect.objectContaining({ title: 'x', usd: 2 })]);
    const m = normMap({ nodes: [{ id: 'a' }], flows: [{ id: 'f', steps: [{ from: 'a', to: 'b' }] }] });
    expect(m.nodes[0]).toMatchObject({ id: 'a', label: 'a', members: [] });
    expect(m.flows[0]!.steps[0]).toMatchObject({ verified: true, source: { file: '', text: '' } });
    expect(m.simple).toBeNull();
  });
});
