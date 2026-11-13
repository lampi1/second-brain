// Unit tests of shared/project-map.ts (ADR 0271): the drawing an agent sends is checked field by field (ids, kinds,
// parents only on parts, no loops, links between known elements), keeps the statuses it leaves out, a status update
// confirms what it names, a status nobody confirmed lately or whose files changed reads «da verificare», a file finds
// its element by the longest evidence, and one level lays out people on top, environments at the bottom and, inside a
// system, the outside elements its parts talk to.
import { describe, expect, it } from 'vitest';
import { applyChanges, checkMap, elementOfFile, levelOf, mapText, pathTo, projectSlug, ROW_MAX, shownStatus, STALE_MS, type ProjectMap } from '../../src/shared/project-map';

const T = 1_000_000_000;
const drawing = {
  elements: [
    { id: 'utente', kind: 'person', name: 'Utente' },
    { id: 'server', kind: 'system', name: 'Server MCP', status: 'work', evidence: ['src/'] },
    { id: 'tools', kind: 'part', name: 'Strumenti', parent: 'server', status: 'ok', evidence: ['src/tools/'] },
    { id: 'auth', kind: 'part', name: 'Login', parent: 'server', evidence: ['src/tools/auth.ts'] },
    { id: 'erp', kind: 'external', name: 'Gestionale', status: 'blocked', actor: 'user', note: 'servono i permessi' },
    { id: 'host', kind: 'env', name: 'Host di test', evidence: ['deploy\\test\\'] },
  ],
  links: [
    { from: 'utente', to: 'server', label: 'chiede' },
    { from: 'tools', to: 'erp', label: 'legge gli ordini', status: 'blocked', actor: 'user' },
    { from: 'host', to: 'server', label: 'ospita' },
    { from: 'tools', to: 'auth', label: 'controlla' },
  ],
};
const full = (now = T): ProjectMap => ({ project: 'p', title: 'P', version: 1, updatedAt: now, by: 'x', summary: 's', corrections: [], ...checkMap(drawing, now) });

describe('checkMap', () => {
  it('reads a drawing: defaults, normalized evidence, link ids', () => {
    const m = checkMap(drawing, T);
    expect(m.elements.find(e => e.id === 'auth')).toMatchObject({ status: 'unknown', confirmedAt: T, parent: 'server' });
    expect(m.elements.find(e => e.id === 'host')!.evidence).toEqual(['deploy/test/']);
    expect(m.links.map(l => l.id)).toEqual(['utente--server', 'tools--erp', 'host--server', 'tools--auth']);
  });
  it('keeps the previous status and its time when the redraw leaves it out', () => {
    const prev = full(T);
    const m = checkMap({ elements: drawing.elements.map(e => ({ ...e, status: undefined })), links: drawing.links }, T + 5000, prev);
    expect(m.elements.find(e => e.id === 'server')).toMatchObject({ status: 'work', confirmedAt: T });
  });
  it.each([
    [{ elements: [] }, 'at least one'],
    [{ elements: [{ id: 'A b', kind: 'system', name: 'x' }] }, '.id'],
    [{ elements: [{ id: 'a', kind: 'planet', name: 'x' }] }, '.kind'],
    [{ elements: [{ id: 'a', kind: 'system', name: 'x' }, { id: 'a', kind: 'system', name: 'y' }] }, 'twice'],
    [{ elements: [{ id: 'a', kind: 'system', name: 'x' }, { id: 'b', kind: 'system', name: 'y', parent: 'a' }] }, 'only a part'],
    [{ elements: [{ id: 'a', kind: 'part', name: 'x', parent: 'b' }, { id: 'b', kind: 'part', name: 'y', parent: 'a' }] }, 'parent is a system'],
    [{ elements: [{ id: 's', kind: 'system', name: 's' }, { id: 'p', kind: 'part', name: 'p', parent: 's' }, { id: 'q', kind: 'part', name: 'q', parent: 'p' }] }, 'parent is a system'],
    [{ elements: [{ id: 'a', kind: 'system', name: 'x' }, { id: 'b', kind: 'system', name: 'y' }], links: [{ id: 'a', from: 'a', to: 'b', label: 'x' }] }, 'an element\'s id'],
    [{ elements: [{ id: 'a', kind: 'system', name: 'x', evidence: ['../etc'] }] }, 'relative'],
    [{ elements: [{ id: 'a', kind: 'system', name: 'x' }], links: [{ from: 'a', to: 'z', label: 'x' }] }, '.to'],
    [{ elements: [{ id: 'a', kind: 'system', name: 'x' }], links: [{ from: 'a', to: 'a', label: 'x' }] }, 'same element'],
  ])('refuses a broken drawing (%#)', (input, msg) => { expect(() => checkMap(input, T)).toThrow(msg); });
});

describe('applyChanges', () => {
  it('sets status, note and actor, confirmed now, on elements and links', () => {
    const r = applyChanges(full(), [{ id: 'erp', status: 'ok', note: '', actor: null }, { id: 'tools--erp', status: 'work' }], T + 10);
    expect(r.touched).toEqual(['erp', 'tools--erp']);
    const erp = r.elements.find(e => e.id === 'erp')!;
    expect(erp).toMatchObject({ status: 'ok', confirmedAt: T + 10 });
    expect(erp.note).toBeUndefined();
    expect(erp.actor).toBeUndefined();
    expect(r.links.find(l => l.id === 'tools--erp')).toMatchObject({ status: 'work', confirmedAt: T + 10 });
  });
  it('refuses an unknown id or status', () => {
    expect(() => applyChanges(full(), [{ id: 'nope' }], T)).toThrow('no element or link');
    expect(() => applyChanges(full(), [{ id: 'erp', status: 'great' }], T)).toThrow('.status');
    expect(() => applyChanges(full(), [], T)).toThrow('1 to 100');
  });
});

describe('shownStatus', () => {
  it('reads «da verificare» when work or blocked went unconfirmed, or the files changed after', () => {
    expect(shownStatus({ status: 'work', confirmedAt: T }, T + STALE_MS - 1)).toEqual({ status: 'work', stale: false });
    expect(shownStatus({ status: 'work', confirmedAt: T }, T + STALE_MS + 1)).toEqual({ status: 'unknown', stale: true });
    expect(shownStatus({ status: 'ok', confirmedAt: T }, T + 10 * STALE_MS)).toEqual({ status: 'ok', stale: false });
    expect(shownStatus({ status: 'ok', confirmedAt: T }, T + 5, T + 1)).toEqual({ status: 'unknown', stale: true });
    expect(shownStatus({ status: 'unknown', confirmedAt: T }, T)).toEqual({ status: 'unknown', stale: false });
  });
});

describe('elementOfFile', () => {
  it('takes the longest evidence that covers the file', () => {
    const els = full().elements;
    expect(elementOfFile(els, 'src/tools/auth.ts')).toBe('auth');
    expect(elementOfFile(els, 'src\\tools\\list.ts')).toBe('tools');
    expect(elementOfFile(els, 'src/index.ts')).toBe('server');
    expect(elementOfFile(els, 'README.md')).toBeNull();
  });
});

describe('levelOf', () => {
  it('top level: people first, environments last, part links lifted to their system', () => {
    const lv = levelOf(full(), null, T);
    const y = (id: string) => lv.nodes.find(n => n.id === id)!.y;
    expect(lv.nodes.map(n => n.id).sort()).toEqual(['erp', 'host', 'server', 'utente']);
    expect(y('utente')).toBeLessThan(y('server'));
    expect(y('server')).toBeLessThan(y('erp'));
    expect(y('host')).toBeGreaterThan(y('erp'));
    expect(lv.edges.find(e => e.from === 'server' && e.to === 'erp')).toMatchObject({ label: 'legge gli ordini', status: 'blocked' });
  });
  it('inside a system: its parts, and the outside elements they talk to as context', () => {
    const lv = levelOf(full(), 'server', T);
    expect(lv.nodes.filter(n => !n.ctx).map(n => n.id).sort()).toEqual(['auth', 'tools']);
    expect(lv.nodes.filter(n => n.ctx).map(n => n.id)).toEqual(['erp']);
    expect(lv.edges.map(e => `${e.from}>${e.to}`).sort()).toEqual(['tools>auth', 'tools>erp']);
  });
  it('wraps a row wider than ROW_MAX', () => {
    const many = { elements: Array.from({ length: ROW_MAX + 2 }, (_, i) => ({ id: `s${i}`, kind: 'system', name: `S${i}` })) };
    const lv = levelOf(checkMap(many, T), null, T);
    expect(new Set(lv.nodes.map(n => n.y)).size).toBe(2);
  });
});

describe('the rest', () => {
  it('slugs a name, walks the path to a part, writes the map as text', () => {
    expect(projectSlug('Server MCP per il «gestionale»')).toBe('server-mcp-per-il-gestionale');
    expect(projectSlug('!!!')).toBe('progetto');
    expect(pathTo(full(), 'auth').map(e => e.id)).toEqual(['server', 'auth']);
    const text = mapText({ map: { ...full(), corrections: ['il login è di un altro team'] }, agents: [{ chatId: 'c', title: 'Artisan', mark: 'run', done: 1, total: 3, elements: ['tools'] }], changed: {} }, T);
    expect(text).toContain('- erp · external · Gestionale — bloccato: servono i permessi [tocca all\'utente]');
    expect(text).toContain('  - tools · part · Strumenti — funziona · agenti: Artisan (run)');
    expect(text).toContain('- il login è di un altro team');
  });
});
