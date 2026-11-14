// Unit tests of the texts behind a project map's boxes and arrows (ADR 0307; the owner 2026-11-14: «il contenuto
// testuale non è molto dettagliato»): shared/project-map.ts keeps `details` on elements and links (paragraphs kept,
// length capped, kept across a redraw that leaves them out, removed by an empty string), an edit adds and changes
// them, elementText tells one piece in full, an arrow of a level knows every link it stands for; main/projectmap
// passes each step's detail, agents and times to the view, and the read tools tell one element on request.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => String(e) }));
import type { ChatSummary } from '../../src/shared/contract';
import type { CallCtx } from '../../src/main/mcp/server';
import { applyEdit, checkMap, elementText, levelOf, MAP_LIMITS, type ProjectMap } from '../../src/shared/project-map';
import type { StrategyPlan } from '../../src/shared/strategy';
import { ProjectMaps } from '../../src/main/projectmap/service';
import { ProjectMapStore } from '../../src/main/projectmap/store';
import { appProjectMapTool, chatMapTools } from '../../src/main/projectmap/tools';

const T = 1_000_000_000;
const drawing = {
  elements: [
    { id: 'web', kind: 'system', name: 'Web', status: 'ok', description: 'Il sito', details: 'Riceve   gli ordini.\n\n\nLi salva e  avvisa il cliente.', evidence: ['src/'] },
    { id: 'cart', kind: 'part', name: 'Carrello', parent: 'web', status: 'work', note: 'sconti' },
    { id: 'orders', kind: 'part', name: 'Ordini', parent: 'web' },
    { id: 'pay', kind: 'external', name: 'Pagamenti', status: 'ok' },
  ],
  links: [
    { from: 'cart', to: 'pay', label: 'addebita', details: 'Manda il totale e aspetta «pagato».' },
    { from: 'orders', to: 'pay', label: 'storna' },
    { from: 'cart', to: 'orders', label: 'crea' },
  ],
};
const base = (): ProjectMap => ({ project: 'shop', title: 'Shop', version: 1, updatedAt: T, by: 'x', summary: 'x', corrections: [], ...checkMap(drawing, T) });

describe('details on the map', () => {
  it('keeps the paragraphs, folds the spaces, caps the length', () => {
    const m = checkMap(drawing, T);
    expect(m.elements[0]!.details).toBe('Riceve gli ordini.\nLi salva e avvisa il cliente.');
    expect(m.links[0]!.details).toBe('Manda il totale e aspetta «pagato».');
    expect(m.elements[1]).not.toHaveProperty('details');
    expect(() => checkMap({ elements: [{ id: 'a', kind: 'system', name: 'A', details: 'x'.repeat(MAP_LIMITS.details + 1) }] }, T)).toThrow(`at most ${MAP_LIMITS.details}`);
    expect(() => checkMap({ elements: [{ id: 'a', kind: 'system', name: 'A' }, { id: 'b', kind: 'system', name: 'B' }], links: [{ from: 'a', to: 'b', label: 'l', details: 'x'.repeat(MAP_LIMITS.linkDetails + 1) }] }, T)).toThrow(`at most ${MAP_LIMITS.linkDetails}`);
    expect(() => checkMap({ elements: [{ id: 'a', kind: 'system', name: 'A', details: 7 }] }, T)).toThrow('details: text');
  });
  it('a redraw that leaves them out keeps them; an empty string removes them; a new text replaces them', () => {
    const prev = base();
    const bare = { elements: drawing.elements.map(({ details: _d, ...e }) => e), links: drawing.links.map(({ details: _d, ...l }) => l) };
    const kept = checkMap(bare, T + 1, prev);
    expect(kept.elements[0]!.details).toBe(prev.elements[0]!.details);
    expect(kept.links[0]!.details).toBe(prev.links[0]!.details);
    const gone = checkMap({ elements: bare.elements.map(e => (e.id === 'web' ? { ...e, details: '' } : e)), links: bare.links.map(l => (l.from === 'cart' && l.to === 'pay' ? { ...l, details: '' } : l)) }, T + 1, prev);
    expect(gone.elements[0]).not.toHaveProperty('details');
    expect(gone.links[0]).not.toHaveProperty('details');
    const fresh = checkMap({ elements: bare.elements.map(e => (e.id === 'cart' ? { ...e, details: 'Tiene i prodotti scelti.' } : e)), links: bare.links }, T + 1, prev);
    expect(fresh.elements[1]!.details).toBe('Tiene i prodotti scelti.');
  });
  it('an edit adds a piece and a link with their details, sets and clears them', () => {
    const a = applyEdit(base(), [{ op: 'add', name: 'Resi', parent: 'web', details: 'Apre un reso su un ordine pagato.' }, { op: 'link', from: 'resi', to: 'pay', label: 'rimborsa', details: 'Storno sul metodo usato.' }, { op: 'set', id: 'orders', details: 'Somma le righe.' }], T + 1);
    expect(a.elements.find(e => e.id === 'resi')!.details).toBe('Apre un reso su un ordine pagato.');
    expect(a.links.find(l => l.id === 'resi--pay')!.details).toBe('Storno sul metodo usato.');
    expect(a.elements.find(e => e.id === 'orders')!.details).toBe('Somma le righe.');
    const b = applyEdit({ ...base(), elements: a.elements, links: a.links }, [{ op: 'set', id: 'orders', details: '' }, { op: 'set', id: 'web', name: 'Sito' }], T + 2);
    expect(b.elements.find(e => e.id === 'orders')).not.toHaveProperty('details');
    expect(b.elements.find(e => e.id === 'web')!.details).toContain('Riceve gli ordini.'); // an edit of something else keeps them
  });
  it('tells one piece in full: how it works, its files, its parts, every link in and out with what passes', () => {
    const m = base();
    expect(elementText(m, 'web', T)).toBe(['«Web» (web, system) — funziona', 'Il sito', 'Come funziona:', 'Riceve gli ordini.\nLi salva e avvisa il cliente.', 'Letto da: src/',
      'Parti:', '- cart · Carrello', '- orders · Ordini'].join('\n'));
    const cart = elementText(m, 'cart', T);
    expect(cart).toContain('«Carrello» (cart, part, in Web) — in lavorazione: sconti');
    expect(cart).toContain('Nessun dettaglio scritto');
    expect(cart).toContain('- → Pagamenti (pay) «addebita» — da capire\n  Manda il totale e aspetta «pagato».');
    expect(elementText(m, 'pay', T)).toContain('- ← Ordini (orders) «storna»');
    expect(() => elementText(m, 'nope', T)).toThrow('no «nope»');
  });
  it('an arrow of a level names every link it stands for', () => {
    const top = levelOf(base(), null, T).edges.find(e => e.from === 'web' && e.to === 'pay')!;
    expect(top.ids).toEqual(['cart--pay', 'orders--pay']); // two links of the parts, one arrow from their system
    expect(top.count).toBe(2);
    const inside = levelOf(base(), 'web', T).edges.find(e => e.from === 'cart' && e.to === 'orders')!;
    expect(inside.ids).toEqual(['cart--orders']);
  });
});

describe('the service and the tools', () => {
  let dir: string, maps: ProjectMaps, chats: ChatSummary[];
  const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({ harness: 'claude', origin: 'app', title: p.id, cwd: '/repo/shop', sessionId: null, model: null, effort: null, permissionMode: null,
    state: 'running', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p });
  const ctx = (chatId: string) => ({ mount: 'chat', params: { chatId }, sessionId: '', signal: new AbortController().signal }) as unknown as CallCtx;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pmdetails-'));
    chats = [chat({ id: 's1', title: 'Strategist' })];
    maps = new ProjectMaps({ store: new ProjectMapStore(() => dir), chats: () => chats, items: () => [], pending: () => [], emit: () => {}, stateFile: path.join(dir, 's.json') });
    maps.save({ title: 'Shop', root: '/repo/shop', map: drawing, by: 'Scout', summary: 'prima' });
  });
  afterEach(() => { maps.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('a plan step reaches the view with its detail, its agents, its times and its «added» mark', () => {
    const plan: StrategyPlan = { phase: 'running', clarified: [], at: 1, map: 'shop', steps: [
      { title: 'Leggo', detail: 'Dove nasce il totale', role: 'scout', state: 'done', on: 'web', chatIds: ['a1'], startedAt: 10, endedAt: 70 },
      { title: 'Correggo', state: 'now', on: 'cart', startedAt: 80, added: true },
      { title: 'Provo', state: 'todo' }] };
    chats[0] = chat({ id: 's1', title: 'Strategist', plan });
    const flow = maps.view('shop')!.plans[0]!.flow;
    expect(flow[0]).toEqual({ step: 1, title: 'Leggo', state: 'done', role: 'scout', on: 'web', wave: 1, detail: 'Dove nasce il totale', chatIds: ['a1'], startedAt: 10, endedAt: 70 });
    expect(flow[1]).toMatchObject({ step: 2, state: 'now', startedAt: 80, added: true });
    expect(flow[2]).toEqual({ step: 3, title: 'Provo', state: 'todo', wave: 3 }); // nothing more than the plan says
  });
  it('an agent and the Orchestrator read one element in full; a redraw through the tool keeps the details', async () => {
    const t = Object.fromEntries(chatMapTools({ maps, titleOf: () => 'Scout', cwdOf: () => '/repo/shop' }).map(x => [x.name, x]));
    expect(String(await t.project_map_read!.run({ project: 'shop', element: 'web' }, ctx('s1')))).toContain('Come funziona:\nRiceve gli ordini.');
    await expect(async () => t.project_map_read!.run({ project: 'shop', element: 'nope' }, ctx('s1'))).rejects.toThrow('no «nope»');
    const tool = appProjectMapTool(maps, () => {});
    expect(tool.run({ action: 'read', project: 'shop', element: 'cart' })).toContain('«addebita»');
    expect(String(tool.run({ action: 'read', project: 'shop' }))).toContain('Mappa «Shop»');
    await t.project_map_save!.run({ project: 'shop', summary: 'ridisegno', elements: drawing.elements.map(({ details: _d, ...e }) => e), links: drawing.links.map(({ details: _d, ...l }) => l) }, ctx('s1'));
    expect(maps.view('shop')!.map.elements[0]!.details).toContain('Riceve gli ordini.');
    expect((tool.run({ action: 'brief', project: 'shop' }) as { prompt: string }).prompt).toContain('details');
  });
});
