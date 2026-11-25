// Unit tests of the work maps in the renderer (store/plans.ts): the open and the archived rows are read together, once
// for the whole app and again at each plans:changed; a change that comes while it reads makes it read once more; a
// failed reading keeps the rows it had; a chat's map is read fresh.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Store from '../../../src/renderer/store/plans';
import type { PlanInfo } from '../../../src/shared/plan';

const row = (id: string, p: Partial<PlanInfo> = {}) => ({ id, title: id, state: 'running', touches: [], can: [], ...p }) as PlanInfo;
let open: PlanInfo[], put: PlanInfo[], changed: () => void, gate: Promise<void> | null;
const invoke = vi.fn(async (_c: string, q: { archived?: boolean }) => { const r = q.archived ? put : open; if (gate) await gate; return r; });
const on = vi.fn((_c: string, fn: () => void) => { changed = fn; return () => {}; });
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let store: typeof Store;

beforeEach(async () => {
  vi.resetModules(); invoke.mockClear(); on.mockClear();
  open = [row('wm_open')]; put = [row('wm_put', { state: 'archived' })]; gate = null;
  vi.stubGlobal('window', { sb: { invoke, on } });
  store = await import('../../../src/renderer/store/plans');
});

describe('the rows', () => {
  it('are nothing until somebody reads them, then the open and the archived ones, with one subscription', async () => {
    expect(store.plans()).toBeNull();
    store.watchPlans(); store.watchPlans();
    await settle();
    expect(store.plans()!.map(r => r.id)).toEqual(['wm_open', 'wm_put']);
    expect(invoke.mock.calls.map(c => c[0])).toEqual(['plans:list', 'plans:list']);
    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0]![0]).toBe('plans:changed');
  });
  it('are read again at a change, once more when it comes during a reading', async () => {
    store.watchPlans(); await settle();
    let free = () => {}; gate = new Promise<void>(r => { free = r; });
    changed(); changed(); changed();
    open = [row('wm_open'), row('wm_new')];
    free(); gate = null; await settle();
    expect(store.plans()!.map(r => r.id)).toEqual(['wm_open', 'wm_new', 'wm_put']);
    expect(invoke).toHaveBeenCalledTimes(6); // the first, the one under way, one more for the changes that came meanwhile
  });
  it('stay when a reading fails', async () => {
    store.watchPlans(); await settle();
    invoke.mockRejectedValueOnce(new Error('giù'));
    changed(); await settle();
    expect(store.plans()!.map(r => r.id)).toEqual(['wm_open', 'wm_put']);
  });
  it('a chat\'s map is read now, not from the rows on screen', async () => {
    store.watchPlans(); await settle();
    open = [row('wm_open', { ownerChatId: 'c1' })];
    expect((await store.planOfChat('c1'))?.id).toBe('wm_open');
    expect(await store.planOfChat('c2')).toBeNull();
  });
});
