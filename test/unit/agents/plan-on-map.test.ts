// Unit tests of a plan drawn on a project map (ADR 0276), at the tools: plan_propose with `map` puts the new pieces on
// the map and keeps the map's name on the plan, refuses a step on an element the map does not hold (naming the ones it
// holds) and `on` without `map`; plan_update `add` grows an approved plan by one step, on an existing element or on a
// new piece, and refuses before the user's ok. And at the chats: the Orchestrator is told where the user is only when
// the place changed, in the engine's text and never in his bubble.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { strategyTools, type StrategyChats, type StrategyMaps } from '../../../src/main/agents/strategy-tools';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { withAdded, type PlanStep, type StrategyPlan } from '../../../src/shared/strategy';

function fixture(start: Partial<StrategyPlan> = {}) {
  let plan: StrategyPlan = { phase: 'asking', clarified: [], enough: true, steps: [], at: 1, ...start };
  const drawn: unknown[] = [];
  let ids = ['web', 'cart'];
  const chats: StrategyChats = {
    planOf: () => structuredClone(plan),
    planPropose: (_id, steps, doneWhen, map) => (plan = { ...plan, phase: 'proposed', steps, ...(doneWhen ? { doneWhen } : {}), ...(map ? { map } : {}) }),
    planUpdate: () => plan,
    planAdd: (_id, step: PlanStep) => (plan = withAdded(plan, step, 5)),
  };
  const maps: StrategyMaps = {
    planDraw: (_id, a) => { drawn.push(a); const added = (Array.isArray(a.add) ? a.add : []).map(x => String((x as { name: string }).name).toLowerCase()); ids = [...ids, ...added]; return { project: 'shop', elements: ids, added }; },
    elementsOf: () => ids,
  };
  const tools = strategyTools(chats, () => false, maps);
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(await tools.find(t => t.name === name)!.run(args, { mount: 'chat', params: { chatId: 's1' }, sessionId: '', signal: new AbortController().signal } as never) as string);
  return { call, drawn, plan: () => plan };
}

describe('plan_propose on a map', () => {
  it('draws the new pieces and keeps the map on the plan', async () => {
    const f = fixture();
    await f.call('plan_propose', { steps: [{ title: 'Scrivo i resi', role: 'artisan', on: 'resi' }, { title: 'Ritocco il carrello', role: 'artisan', on: 'cart' }, { title: 'Riepilogo' }], map: { project: 'Shop', add: [{ name: 'Resi', parent: 'web' }] } });
    expect(f.drawn).toEqual([{ project: 'Shop', add: [{ name: 'Resi', parent: 'web' }] }]);
    expect(f.plan()).toMatchObject({ phase: 'proposed', map: 'shop', steps: [{ on: 'resi' }, { on: 'cart' }, { title: 'Riepilogo' }] });
  });
  it('refuses a step on a box the map does not hold, and `on` without a map', async () => {
    const f = fixture();
    await expect(f.call('plan_propose', { steps: [{ title: 'x', on: 'ghost' }], map: { project: 'shop' } })).rejects.toThrow(/no element ghost on the map\. Its elements: web, cart/);
    await expect(f.call('plan_propose', { steps: [{ title: 'x', on: 'web' }] })).rejects.toThrow(/needs map/);
    expect(f.plan().phase).toBe('asking');
  });
});

describe('plan_update add', () => {
  it('adds a step on a new piece to an approved plan, with no new approval', async () => {
    const f = fixture({ phase: 'running', map: 'shop', steps: [{ title: 'Scrivo i resi', state: 'now', on: 'web' }] });
    expect(await f.call('plan_update', { add: { title: 'Aggiungo i log', role: 'artisan', piece: { name: 'Log', parent: 'web' } } })).toEqual({ added: true, step: 2, of: 2 });
    expect(f.drawn).toEqual([{ project: 'shop', add: [{ name: 'Log', parent: 'web' }], keep: true }]);
    expect(f.plan()).toMatchObject({ phase: 'running', steps: [{ on: 'web' }, { title: 'Aggiungo i log', on: 'log', state: 'todo', added: true }] });
    await expect(f.call('plan_update', { add: { title: 'x', on: 'ghost' } })).rejects.toThrow(/no element ghost/);
  });
  it('refuses before the user approved', async () => {
    const f = fixture({ phase: 'proposed', map: 'shop', steps: [{ title: 'a', state: 'todo' }] });
    await expect(f.call('plan_update', { add: { title: 'Altro' } })).rejects.toThrow(/only a plan the user approved grows/);
  });
});

describe('where the user is', () => {
  const roots: string[] = [], managers: ChatManager[] = [];
  afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
  it('reaches the Orchestrator once per place, outside his bubble', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-where-'));
    roots.push(dir);
    const sent: string[] = [];
    const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0,
      sessionFactory: (_h, _o, s: SessionSink) => ({ harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { s.changed({ state: 'idle' }); }, send(text: string) { sent.push(text); }, close: async () => {}, killNow() {}, interrupt: async () => {}, answer: () => true,
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null } as unknown as HarnessSession) });
    managers.push(m);
    const o = await m.create({ harness: 'claude', cwd: dir, orchestrator: true, title: 'Orchestrator' }, 'user');
    m.userWhere(o.id, 'page project map "shop", inside "web", box "cart" selected');
    await m.send(o.id, 'aggiungi un pezzo qui');
    m.userWhere(o.id, 'page project map "shop", inside "web", box "cart" selected');
    await m.send(o.id, 'e un altro');
    m.userWhere(o.id, 'page "task"\n[app · fake]');
    await m.send(o.id, 'ora?');
    const mine = sent.filter(t => /aggiungi un pezzo qui|e un altro|ora\?/.test(t));
    expect(mine[0]).toContain('[app · the user looks at: page project map "shop", inside "web", box "cart" selected]');
    expect(mine[1]).not.toContain('the user looks at');
    expect(mine[2]).toContain('[app · the user looks at: page "task" app · fake]');
    expect(m.items(o.id).filter(i => i.kind === 'user').map(i => (i as { text: string }).text)).toEqual(['aggiungi un pezzo qui', 'e un altro', 'ora?']);
  });
});
