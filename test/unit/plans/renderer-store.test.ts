// Unit tests of the plans in the renderer (store/plans.ts): the open, archived and trashed rows are read together, once
// for the whole app and again at each plans:changed; a change that comes while it reads makes it read once more; a
// failed reading keeps the rows it had; a chat's map is read fresh.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Store from '../../../src/renderer/store/plans';
import type { PlanInfo } from '../../../src/shared/plan';

const row = (id: string, p: Partial<PlanInfo> = {}) => ({ id, title: id, state: 'running', touches: [], can: [], ...p }) as PlanInfo;
let open: PlanInfo[], put: PlanInfo[], bin: PlanInfo[], changed: () => void, gate: Promise<void> | null;
const invoke = vi.fn(async (_c: string, q: { archived?: boolean; trash?: boolean }) => { const r = q.trash ? bin : q.archived ? put : open; if (gate) await gate; return r; });
const on = vi.fn((_c: string, fn: () => void) => { changed = fn; return () => {}; });
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let store: typeof Store;

beforeEach(async () => {
  vi.resetModules(); invoke.mockClear(); on.mockClear();
  open = [row('pl_open')]; put = [row('pl_put', { state: 'archived' })]; bin = [row('pl_bin', { deleted: true })]; gate = null;
  vi.stubGlobal('window', { sb: { invoke, on } });
  store = await import('../../../src/renderer/store/plans');
});

describe('the rows', () => {
  it('are nothing until somebody reads them, then the open, the archived and the trashed ones, with one subscription', async () => {
    expect(store.plans()).toBeNull();
    store.watchPlans(); store.watchPlans();
    await settle();
    expect(store.plans()!.map(r => r.id)).toEqual(['pl_open', 'pl_put', 'pl_bin']);
    expect(invoke.mock.calls.map(c => c[0])).toEqual(['plans:list', 'plans:list', 'plans:list']);
    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0]![0]).toBe('plans:changed');
  });
  it('are read again at a change, once more when it comes during a reading', async () => {
    store.watchPlans(); await settle();
    let free = () => {}; gate = new Promise<void>(r => { free = r; });
    changed(); changed(); changed();
    open = [row('pl_open'), row('pl_new')];
    free(); gate = null; await settle();
    expect(store.plans()!.map(r => r.id)).toEqual(['pl_open', 'pl_new', 'pl_put', 'pl_bin']);
    expect(invoke).toHaveBeenCalledTimes(9); // the first, the one under way, one more for the changes that came meanwhile
  });
  it('stay when a reading fails', async () => {
    store.watchPlans(); await settle();
    invoke.mockRejectedValueOnce(new Error('giù'));
    changed(); await settle();
    expect(store.plans()!.map(r => r.id)).toEqual(['pl_open', 'pl_put', 'pl_bin']);
  });
  it('a chat\'s map is read now, not from the rows on screen', async () => {
    store.watchPlans(); await settle();
    open = [row('pl_open', { ownerChatId: 'c1' })];
    expect((await store.planOfChat('c1'))?.id).toBe('pl_open');
    expect(await store.planOfChat('c2')).toBeNull();
  });
});
