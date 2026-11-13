// Unit tests of planning on the project maps (ADR 0276): the shared edit (applyEdit: a new piece is planned, parts and
// links leave with their system, untouched statuses keep their confirmation, a wrong op refuses the whole edit), a map
// saved before this change still reads (no works, no plans), and the service: a plan drawn on a map (planDraw: new
// pieces dashed and owned by the plan, a second proposal takes the first one's back, a project without a map gets one
// of the touched pieces only), its steps shown as works, statuses and bindings following the steps without a tool
// call (syncPlan), unstarted pieces leaving with a dropped plan, the Orchestrator's edit and undo, and a change sent
// to an agent at work shown until its turn ends.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => String(e) }));
import type { ChatItem, ChatSummary } from '../../src/shared/contract';
import { applyEdit, checkMap, mapText, shownStatus, type ProjectMap } from '../../src/shared/project-map';
import type { StrategyPlan } from '../../src/shared/strategy';
import { ProjectMaps } from '../../src/main/projectmap/service';
import { ProjectMapStore } from '../../src/main/projectmap/store';

const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: p.id, cwd: '/repo/shop', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'running', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});
const drawing = {
  elements: [
    { id: 'web', kind: 'system', name: 'Web', status: 'ok', evidence: ['src/'] },
    { id: 'cart', kind: 'part', name: 'Carrello', parent: 'web', status: 'ok', evidence: ['src/cart/'] },
    { id: 'pay', kind: 'external', name: 'Pagamenti', status: 'ok' },
  ],
  links: [{ from: 'cart', to: 'pay', label: 'addebita' }],
};
const base = (): ProjectMap => ({ project: 'shop', title: 'Shop', version: 1, updatedAt: 1, by: 'x', summary: 'x', corrections: [], ...checkMap(drawing, 100) });
const plan = (p: Partial<StrategyPlan>): StrategyPlan => ({ phase: 'running', clarified: [], steps: [], at: 1, ...p });

describe('applyEdit', () => {
  it('adds a planned piece with a link, keeps the others confirmed as they were', () => {
    const r = applyEdit(base(), [{ op: 'add', name: 'Produzione', kind: 'env' }, { op: 'link', from: 'web', to: 'produzione', label: 'deploy' }], 500, 's1');
    const prod = r.elements.find(e => e.id === 'produzione')!;
    expect(prod).toMatchObject({ status: 'planned', plan: 's1', addedAt: 500, kind: 'env' });
    expect(r.elements.find(e => e.id === 'web')).toMatchObject({ status: 'ok', confirmedAt: 100 });
    expect(r.links.map(l => l.id)).toEqual(['cart--pay', 'web--produzione']);
    expect(r.did).toEqual(['+ Produzione', '+ Web → Produzione']);
    expect(shownStatus(prod, 10 ** 12)).toEqual({ status: 'planned', stale: false });
  });
  it('gives a second piece of the same name its own id, and a part its system', () => {
    const r = applyEdit(base(), [{ op: 'add', name: 'Web' }, { op: 'add', name: 'Resi', parent: 'web' }], 500);
    expect(r.added).toEqual(['web-2', 'resi']);
    expect(r.elements.find(e => e.id === 'resi')).toMatchObject({ kind: 'part', parent: 'web' });
  });
  it('removes a system with its parts and their links; set renames and confirms a new status', () => {
    const r = applyEdit(base(), [{ op: 'set', id: 'pay', name: 'Gateway', status: 'blocked', note: 'manca la chiave' }, { op: 'remove', id: 'web' }], 500);
    expect(r.elements.map(e => e.id)).toEqual(['pay']);
    expect(r.links).toEqual([]);
    expect(r.elements[0]).toMatchObject({ name: 'Gateway', status: 'blocked', note: 'manca la chiave', confirmedAt: 500 });
  });
  it('refuses the whole edit on a wrong op', () => {
    expect(() => applyEdit(base(), [{ op: 'add', name: 'Ok' }, { op: 'remove', id: 'nope' }], 500)).toThrow(/no element "nope"/);
    expect(() => applyEdit(base(), [{ op: 'link', from: 'web', to: 'ghost', label: 'x' }], 500)).toThrow(/links\[1\]\.to/);
    expect(() => applyEdit(base(), [], 500)).toThrow(/1 to 40/);
  });
  it('a piece that started loses its plan mark', () => {
    const one = applyEdit(base(), [{ op: 'add', name: 'Log' }], 500, 's1');
    const two = applyEdit({ ...base(), ...one }, [{ op: 'set', id: 'log', status: 'work' }], 600);
    expect(two.elements.find(e => e.id === 'log')).not.toHaveProperty('plan');
  });
});

describe('a map saved before planning', () => {
  it('reads as text without works or plans', () => {
    const text = mapText({ map: base(), agents: [], changed: {} }, 200);
    expect(text).toContain('web · system · Web — funziona');
    expect(text).not.toContain('lavori');
  });
});

let dir: string, now: number, chats: ChatSummary[], emitted: string[];
const make = () => new ProjectMaps({ store: new ProjectMapStore(() => dir), chats: () => chats, items: () => [], pending: () => [],
  emit: p => emitted.push(p), stateFile: path.join(dir, 'state.json'), now: () => now, debounceMs: 10 });

beforeEach(() => {
  vi.useFakeTimers();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pplan-'));
  now = 1_000_000; chats = [chat({ id: 's1', title: 'Strategist · Resi' })]; emitted = [];
});
afterEach(() => { vi.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('ProjectMaps planning', () => {
  it('draws a plan on an existing map and takes an earlier proposal back', () => {
    const m = make();
    m.save({ title: 'Shop', root: '/repo/shop', map: drawing, by: 'Scout', summary: 'prima' });
    const a = m.planDraw('s1', { project: 'Shop', add: [{ name: 'Resi', parent: 'web' }], links: [{ from: 'resi', to: 'pay', label: 'storna' }] });
    expect(a).toMatchObject({ project: 'shop', added: ['resi'] });
    expect(m.view('shop')!.map.elements.find(e => e.id === 'resi')).toMatchObject({ status: 'planned', plan: 's1' });
    const b = m.planDraw('s1', { project: 'shop', add: [{ name: 'Rimborsi', parent: 'web' }] });
    expect(b.elements).toEqual(['web', 'cart', 'pay', 'rimborsi']);
    expect(m.view('shop')!.map.links.map(l => l.id)).toEqual(['cart--pay']);
  });
  it('makes a map of the touched pieces for a project that has none', () => {
    const m = make();
    expect(() => m.planDraw('s1', { title: 'Nuovo' })).toThrow(/no map/);
    const r = m.planDraw('s1', { title: 'Server MCP', add: [{ name: 'Server', kind: 'system' }, { name: 'Host di test', kind: 'env' }] });
    expect(r).toMatchObject({ project: 'server-mcp', elements: ['server', 'host-di-test'] });
    const map = m.view('server-mcp')!.map;
    expect(map.root).toBe('/repo/shop');
    expect(map.elements.every(e => e.status === 'planned' && e.plan === 's1')).toBe(true);
  });
  it('tells which steps go one after the other and which together (ADR 0302)', () => {
    const m = make();
    m.save({ title: 'Shop', root: '/repo/shop', map: drawing, by: 'Scout', summary: 'prima' });
    // the plan says steps 2 and 3 go together; step 4 waits for them
    const steps: StrategyPlan['steps'] = [{ title: 'Leggo', state: 'done', on: 'web' }, { title: 'Carrello', state: 'todo', on: 'cart' }, { title: 'Pagamenti', state: 'todo', on: 'pay', par: true }, { title: 'Provo', state: 'todo' }];
    chats[0] = chat({ id: 's1', title: 'S', plan: plan({ map: 'shop', steps }) });
    let v = m.view('shop')!;
    expect(v.plans[0]!.flow.map(f => [f.step, f.wave, !!f.par])).toEqual([[1, 1, false], [2, 2, true], [3, 2, true], [4, 3, false]]);
    expect(v.plans[0]!.flow[3]).toEqual({ step: 4, title: 'Provo', state: 'todo', wave: 3 }); // a step on no box is still in the order
    expect(v.works.cart).toMatchObject([{ step: 2, wave: 2, par: true }]);
    expect(v.works.web![0]!.par).toBeUndefined();
    // two steps under way at the same moment go together, whatever the plan said
    steps[1] = { ...steps[1]!, state: 'done' }; steps[2] = { title: 'Pagamenti', state: 'now', on: 'pay' }; steps[3] = { title: 'Provo', state: 'now', on: 'web' };
    chats[0] = chat({ id: 's1', title: 'S', plan: plan({ map: 'shop', steps }) });
    v = m.view('shop')!;
    expect(v.plans[0]!.flow.map(f => [f.wave, !!f.par])).toEqual([[1, false], [2, false], [3, true], [4, true]]);
  });
  it('shows the steps as works and moves statuses and agents with them, without a tool call', () => {
    const m = make();
    m.save({ title: 'Shop', root: '/repo/shop', map: drawing, by: 'Scout', summary: 'prima' });
    m.planDraw('s1', { project: 'shop', add: [{ name: 'Resi', parent: 'web' }] });
    const steps: StrategyPlan['steps'] = [{ title: 'Scrivo i resi', role: 'artisan', state: 'todo', on: 'resi' }, { title: 'Provo i resi', role: 'sentinel', state: 'todo', on: 'resi' }, { title: 'Ritocco il carrello', role: 'artisan', state: 'todo', on: 'cart' }];
    chats[0] = chat({ id: 's1', title: 'Strategist · Resi', plan: plan({ phase: 'proposed', map: 'shop', steps }) });
    m.observe('chat:updated', chats[0]);
    let v = m.view('shop')!;
    expect(v.plans).toEqual([{ chatId: 's1', title: 'Strategist · Resi', phase: 'proposed', at: 1, steps: 3, done: 0, flow: [
      { step: 1, title: 'Scrivo i resi', state: 'todo', wave: 1, on: 'resi', role: 'artisan' }, { step: 2, title: 'Provo i resi', state: 'todo', wave: 2, on: 'resi', role: 'sentinel' },
      { step: 3, title: 'Ritocco il carrello', state: 'todo', wave: 3, on: 'cart', role: 'artisan' }] }]);
    expect(v.works.resi!.map(w => [w.step, w.title, w.state])).toEqual([[1, 'Scrivo i resi', 'todo'], [2, 'Provo i resi', 'todo']]);
    expect(v.map.elements.find(e => e.id === 'resi')!.status).toBe('planned'); // nothing moves before the user's ok
    // approved, step 1 delegated
    chats.push(chat({ id: 'a1', title: 'Artisan · Resi', parentId: 's1' }));
    steps[0] = { ...steps[0]!, state: 'now', chatIds: ['a1'] };
    chats[0] = chat({ id: 's1', title: 'Strategist · Resi', plan: plan({ map: 'shop', steps }) });
    m.observe('chat:updated', chats[0]);
    v = m.view('shop')!;
    expect(v.map.elements.find(e => e.id === 'resi')).toMatchObject({ status: 'work' });
    expect(v.map.elements.find(e => e.id === 'cart')!.status).toBe('ok'); // its step has not started
    expect(v.agents.find(a => a.chatId === 'a1')!.elements).toEqual(['resi']);
    expect(v.map.summary).toBe('Resi: in lavorazione');
    const version = v.map.version;
    m.observe('chat:updated', chats[0]); // the same plan again: no new version
    expect(m.view('shop')!.map.version).toBe(version);
    // a step under way vouches for its element: never «da verificare» while the app sees it work
    now += 5 * 3600_000;
    const resi = m.view('shop')!.map.elements.find(e => e.id === 'resi')!;
    expect(shownStatus(resi, now)).toEqual({ status: 'work', stale: false });
    // both steps done → funziona; a blocked one → bloccato
    steps[0] = { ...steps[0]!, state: 'done' }; steps[1] = { ...steps[1]!, state: 'done' }; steps[2] = { ...steps[2]!, state: 'blocked' };
    chats[0] = chat({ id: 's1', title: 'Strategist · Resi', plan: plan({ map: 'shop', steps }) });
    m.observe('chat:updated', chats[0]);
    v = m.view('shop')!;
    expect(v.map.elements.find(e => e.id === 'resi')!.status).toBe('ok');
    expect(v.map.elements.find(e => e.id === 'cart')!.status).toBe('blocked');
    expect(mapText(v, now)).toContain('lavori: ✓ Scrivo i resi; ✓ Provo i resi');
  });
  it('takes the unstarted pieces of a plan that never ran off the map', () => {
    const m = make();
    m.save({ title: 'Shop', root: '/repo/shop', map: drawing, by: 'Scout', summary: 'prima' });
    m.planDraw('s1', { project: 'shop', add: [{ name: 'Resi', parent: 'web' }] });
    m.observe('chat:removed', { chatId: 's1' });
    expect(m.view('shop')!.map.elements.map(e => e.id)).toEqual(['web', 'cart', 'pay']);
  });
  it('keeps a planned system whose part already started, and a status set after the mirror', () => {
    const m = make();
    m.save({ title: 'Shop', root: '/repo/shop', map: drawing, by: 'Scout', summary: 'prima' });
    m.planDraw('s1', { project: 'shop', add: [{ name: 'Resi', kind: 'system' }] });
    m.planDraw('s1', { project: 'shop', add: [{ name: 'Storni', parent: 'resi' }], keep: true });
    const steps: StrategyPlan['steps'] = [{ title: 'Scrivo gli storni', role: 'artisan', state: 'done', on: 'storni' }];
    chats[0] = chat({ id: 's1', title: 'Strategist · Resi', plan: plan({ phase: 'done', map: 'shop', steps }) });
    m.observe('chat:updated', chats[0]);
    expect(m.view('shop')!.map.elements.find(e => e.id === 'storni')!.status).toBe('ok');
    // an agent finds it broken later: the finished plan does not paint it green again
    m.update('shop', { changes: [{ id: 'storni', status: 'blocked', note: 'test rossi' }], by: 'Sentinel', summary: 'storni rotti' });
    m.observe('chat:updated', chats[0]);
    expect(m.view('shop')!.map.elements.find(e => e.id === 'storni')!.status).toBe('blocked');
    // the plan's chat goes: the system it drew holds a piece that started, so both stay
    m.observe('chat:removed', { chatId: 's1' });
    expect(m.view('shop')!.map.elements.map(e => e.id)).toEqual(['web', 'cart', 'pay', 'resi', 'storni']);
  });
  it('undoes the last edit somebody made, past the statuses the app mirrored since', () => {
    const m = make();
    m.save({ title: 'Shop', root: '/repo/shop', map: drawing, by: 'Scout', summary: 'prima' });
    m.edit('shop', [{ op: 'add', name: 'Produzione', kind: 'env' }], 'Orchestrator');
    m.update('shop', { changes: [{ id: 'cart', status: 'work' }], by: 'app', summary: 'Carrello: in lavorazione' });
    const back = m.undo('shop', 'Orchestrator');
    expect(back.elements.map(e => e.id)).toEqual(['web', 'cart', 'pay']);
    expect(back.elements.find(e => e.id === 'cart')!.status).toBe('work');
    expect(back.summary).toBe('annullato: + Produzione');
  });
  it('lets the Orchestrator edit piece by piece and undo', () => {
    const m = make();
    m.save({ title: 'Shop', root: '/repo/shop', map: drawing, by: 'Scout', summary: 'prima' });
    const r = m.edit('shop', [{ op: 'add', name: 'Produzione', kind: 'env' }], 'Orchestrator');
    expect(r.map).toMatchObject({ version: 2, by: 'Orchestrator', summary: '+ Produzione' });
    const back = m.undo('shop', 'Orchestrator');
    expect(back.version).toBe(3);
    expect(back.elements.map(e => e.id)).toEqual(['web', 'cart', 'pay']);
    expect(back.summary).toBe('annullato: + Produzione');
  });
  it('shows a change sent to an agent at work until its turn ends', () => {
    const m = make();
    m.save({ title: 'Shop', root: '/repo/shop', map: drawing, by: 'Scout', summary: 'prima' });
    chats.push(chat({ id: 'a1', title: 'Artisan · Carrello' }));
    m.update('shop', { workingOn: ['cart'], chatId: 'a1', by: 'a1' });
    m.sent('a1', 'aggiungi  anche il rimborso parziale', true);
    expect(m.view('shop')!.agents[0]!.change).toEqual({ text: 'aggiungi anche il rimborso parziale', at: now });
    now += 60_000;
    m.observe('chat:item', { chatId: 'a1', item: { kind: 'result', id: 'r', at: now, costUsd: 0, durationMs: 1, turns: 1, isError: false } satisfies ChatItem });
    expect(m.view('shop')!.agents[0]!.change).toMatchObject({ seenAt: now });
    m.sent('zz', 'x', true); // a chat that is on no map: nothing kept
    m.sent('a1', 'fermati', false);
    expect(m.view('shop')!.agents[0]!.change).toMatchObject({ text: 'fermati', seenAt: now });
  });
});
