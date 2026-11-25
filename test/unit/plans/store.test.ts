// Unit tests of main/plans/store.ts (ADR 0342): a map is read back whole, every version stays in its history, a broken
// file falls back to its last version and never hides the others, and an id never leaves the folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => String(e) }));
import { HISTORY_MAX, PlanStore } from '../../../src/main/plans/store';
import type { Plan } from '../../../src/shared/plan';

let dir: string, store: PlanStore;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-plans-')); store = new PlanStore(dir); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const map = (version: number, extra: Partial<Plan> = {}): Plan => ({ id: 'pl_abc123', version, title: `Sconti ${version}`, constraints: [], links: [], state: 'idea', createdAt: 10, updatedAt: 10 + version, by: 'user', summary: `v${version}`, ...extra });

describe('PlanStore', () => {
  it('a new store on the same folder reads the maps and their versions', () => {
    store.save(map(1));
    store.save(map(2, { plan: { phase: 'approved', at: 5, clarified: [], steps: [{ id: 's1', title: 'Uno', state: 'todo', role: 'scout' }] }, state: 'planned', owner: { chatId: 'c', task: 't' } }));
    store.save(map(1, { id: 'pl_def456' }));
    const again = new PlanStore(dir);
    expect(again.load().map(m => [m.id, m.version, m.state]).sort()).toEqual([['pl_abc123', 2, 'planned'], ['pl_def456', 1, 'idea']]);
    expect(again.load().find(m => m.id === 'pl_abc123')!.plan!.steps).toEqual([{ id: 's1', title: 'Uno', state: 'todo', role: 'scout' }]);
    expect(again.history('pl_abc123')).toEqual([{ version: 1, at: 11, by: 'user', summary: 'v1' }, { version: 2, at: 12, by: 'user', summary: 'v2' }]);
    expect(again.version('pl_abc123', 1)).toMatchObject({ title: 'Sconti 1' });
    expect(again.version('pl_abc123', 9)).toBeNull();
  });

  it('what the live status remembers is kept beside the maps, and one that does not read is nothing', () => {
    expect(store.loadLive()).toBeNull();
    store.saveLive({ seen: { a: 5 } });
    store.save(map(1));
    const again = new PlanStore(dir);
    expect(again.loadLive()).toEqual({ seen: { a: 5 } });
    expect(again.load().map(m => m.id)).toEqual(['pl_abc123']);
    fs.writeFileSync(path.join(dir, 'live.json'), '{broken');
    expect(again.loadLive()).toBeNull();
  });

  it('a broken map.json falls back to its last version, and the others are read', () => {
    store.save(map(1));
    store.save(map(2));
    store.save(map(1, { id: 'pl_def456' }));
    fs.writeFileSync(path.join(dir, 'pl_abc123', 'map.json'), '{ broken');
    fs.mkdirSync(path.join(dir, 'pl_bad999'));
    fs.writeFileSync(path.join(dir, 'pl_bad999', 'map.json'), '{ broken');
    expect(store.load().map(m => [m.id, m.version]).sort()).toEqual([['pl_abc123', 2], ['pl_def456', 1]]);
    expect(fs.existsSync(path.join(dir, 'pl_bad999', 'map.json'))).toBe(true);
  });

  it('the history keeps its first line and the last ones', () => {
    for (let v = 1; v <= HISTORY_MAX + 5; v++) store.save(map(v));
    const h = store.history('pl_abc123');
    expect(h).toHaveLength(HISTORY_MAX);
    expect([h[0]!.version, h[1]!.version, h.at(-1)!.version]).toEqual([1, 7, HISTORY_MAX + 5]);
  });

  it('no folder is no map, and an id that is not one is refused', () => {
    expect(new PlanStore(path.join(dir, 'none')).load()).toEqual([]);
    expect(store.history('pl_none00')).toEqual([]);
    expect(() => store.save(map(1, { id: '../x' }))).toThrow(/non valido/);
  });
});
