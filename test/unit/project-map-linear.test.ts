// Unit tests of the project maps told as a sequence (issue #443, ADR 0322; src/shared/project-map.ts): phases and
// steps checked like any piece, a level made of them drawn in a line in the saved order (numbered, the arrow to the
// following step drawn by the line itself), a split only where a step says `par`, the layout a level asks for, the
// `next` link that has no status of its own, proofs and refs, the edit ops that place a piece in the order, the map
// file read back, and a map drawn before all this laid out as before.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => String(e) }));
import { BOX, LINE_MAX, applyChanges, applyEdit, checkMap, elementText, layoutOf, levelOf, mapText, type ProjectMap } from '../../src/shared/project-map';
import { ProjectMaps } from '../../src/main/projectmap/service';
import { ProjectMapStore, asMap } from '../../src/main/projectmap/store';

const T = 1_000_000_000;
const phased = {
  elements: [
    { id: 'analisi', kind: 'phase', name: 'Analisi', status: 'ok' },
    { id: 'prep', kind: 'phase', name: 'Preparazione', status: 'work' },
    { id: 'migra', kind: 'phase', name: 'Migrazione' },
    { id: 'p1', kind: 'step', name: 'Copia dei dati', parent: 'prep', status: 'ok', proofs: [{ text: '12.400 righe copiate', file: 'logs\\copy.txt' }, 'Conteggi uguali', { text: 'Run verde', href: 'https://ci.example.com/run/7' }], refs: [{ label: 'Issue', href: 'https://tracker.example.com/1' }] },
    { id: 'p2', kind: 'step', name: 'Prova di ripristino', parent: 'prep' },
    { id: 'p3', kind: 'step', name: 'Avviso ai clienti', parent: 'prep', par: true },
    { id: 'p4', kind: 'step', name: 'Via libera', parent: 'prep' },
  ],
  links: [] as unknown[],
};
const mapOf = (drawing: unknown, extra: Partial<ProjectMap> = {}): ProjectMap => ({ project: 'n', title: 'N', version: 1, updatedAt: T, by: 'x', summary: '', corrections: [], ...checkMap(drawing, T), ...extra });
const xs = (lv: ReturnType<typeof levelOf>, ids: string[]) => ids.map(id => lv.nodes.find(n => n.id === id)!);

describe('a level of phases or steps is a line', () => {
  it('phases left to right in the saved order, numbered, one row, with the arrow to the next drawn by the line', () => {
    const lv = levelOf(mapOf(phased), null, T);
    expect(lv.linear).toBe(true);
    const [a, b, c] = xs(lv, ['analisi', 'prep', 'migra']);
    expect([a!.n, b!.n, c!.n]).toEqual([1, 2, 3]);
    expect(a!.x).toBeLessThan(b!.x); expect(b!.x).toBeLessThan(c!.x);
    expect(new Set([a!.y, b!.y, c!.y]).size).toBe(1);
    expect(lv.edges.map(e => [e.from, e.to, e.kind, e.label, e.status, e.ids.length])).toEqual([['analisi', 'prep', 'next', '', 'ok', 0], ['prep', 'migra', 'next', '', 'ok', 0]]);
    // the saved order, not the names nor the links: the same pieces sent the other way round are drawn the other way round
    const back = levelOf(mapOf({ elements: [phased.elements[2], phased.elements[1], phased.elements[0]], links: [{ from: 'analisi', to: 'migra', label: 'x' }] }), null, T);
    expect(xs(back, ['migra', 'prep', 'analisi']).map(n => n.n)).toEqual([1, 2, 3]);
  });

  it('inside a phase the steps are a line too; a split only for a step marked par', () => {
    const lv = levelOf(mapOf(phased), 'prep', T);
    expect(lv.linear).toBe(true);
    const [p1, p2, p3, p4] = xs(lv, ['p1', 'p2', 'p3', 'p4']);
    expect([p1!.n, p2!.n, p3!.n, p4!.n]).toEqual([1, 2, 2, 3]);
    // together = the same place of the line, one above the other; the others never share a column
    expect(p3!.x).toBe(p2!.x); expect(p3!.y).toBeGreaterThanOrEqual(p2!.y + BOX.h);
    expect([p2!.par, p3!.par, p1!.par, p4!.par]).toEqual([true, true, undefined, undefined]);
    expect(new Set([p1!.x, p2!.x, p4!.x]).size).toBe(3);
    expect(lv.edges.map(e => `${e.from}>${e.to}`)).toEqual(['p1>p2', 'p1>p3', 'p2>p4', 'p3>p4']);
    // without the mark the same steps are never side by side in one place
    const plain = levelOf(mapOf({ ...phased, elements: phased.elements.map(e => ({ ...e, par: undefined })) }), 'prep', T);
    expect(new Set(xs(plain, ['p1', 'p2', 'p3', 'p4']).map(n => n.x)).size).toBe(4);
    expect(plain.nodes.every(n => !n.par)).toBe(true);
  });

  it('a long line goes on in the next row, read like text; no box overlaps another', () => {
    const many = Array.from({ length: LINE_MAX + 2 }, (_, i) => ({ id: `f${i}`, kind: 'phase', name: `Fase ${i}`, ...(i === 1 ? { par: true } : {}) }));
    const lv = levelOf(mapOf({ elements: many }), null, T);
    const first = lv.nodes.find(n => n.id === 'f0')!, wrapped = lv.nodes.find(n => n.id === `f${LINE_MAX + 1}`)!;
    expect(wrapped.x).toBe(first.x); expect(wrapped.y).toBeGreaterThan(lv.nodes.find(n => n.id === 'f1')!.y);
    for (const a of lv.nodes) for (const b of lv.nodes) if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    for (const n of lv.nodes) { expect(n.x + n.w).toBeLessThanOrEqual(lv.width); expect(n.y + n.h).toBeLessThanOrEqual(lv.height); }
  });

  it('a level asks for its layout: a line of parts, or the layered drawing for phases; the outside stays under the line', () => {
    const sys = { elements: [{ id: 's', kind: 'system', name: 'S', layout: 'linear' }, { id: 'b', kind: 'part', name: 'B', parent: 's' }, { id: 'a', kind: 'part', name: 'A', parent: 's' }, { id: 'x', kind: 'external', name: 'X' }],
      links: [{ from: 'a', to: 'b', label: 'chiama' }, { from: 'a', to: 'x', label: 'legge' }] };
    const m = mapOf(sys);
    expect(layoutOf(m, 's')).toBe('linear'); expect(layoutOf(m, null)).toBe('auto');
    const lv = levelOf(m, 's', T);
    const [b, a] = xs(lv, ['b', 'a']);
    expect([b!.n, a!.n]).toEqual([1, 2]); // saved order, though the link goes a → b
    // the link that already joins them stands: the line adds no second arrow
    expect(lv.edges.filter(e => [e.from, e.to].sort().join() === 'a,b')).toHaveLength(1);
    const x = lv.nodes.find(n => n.id === 'x')!;
    expect(x.ctx).toBe(true); expect(x.y).toBeGreaterThan(a!.y + a!.h);
    // phases told as a layered drawing when the map says so
    const auto = mapOf(phased, { layout: 'auto' });
    expect(layoutOf(auto, null)).toBe('auto'); expect(levelOf(auto, null, T).linear).toBeUndefined();
    expect(() => checkMap({ elements: [{ id: 's', kind: 'system', name: 'S', layout: 'grid' }] }, T)).toThrow(/layout: linear \| auto/);
    expect(() => checkMap({ elements: [{ id: 's', kind: 'phase', name: 'S', par: 'yes' }] }, T)).toThrow(/par: true or false/);
  });

  it('a map drawn before phases existed is laid out as before', () => {
    const old = { elements: [{ id: 'u', kind: 'person', name: 'U' }, { id: 's', kind: 'system', name: 'S' }, { id: 'a', kind: 'part', name: 'A', parent: 's' }, { id: 'b', kind: 'part', name: 'B', parent: 's' }],
      links: [{ from: 'u', to: 's', label: 'usa' }, { from: 'b', to: 'a', label: 'chiama' }] };
    const m = mapOf(old);
    expect(layoutOf(m, null)).toBe('auto'); expect(layoutOf(m, 's')).toBe('auto');
    const top = levelOf(m, null, T), inner = levelOf(m, 's', T);
    expect(top.linear).toBeUndefined(); expect(top.nodes.every(n => n.n === undefined)).toBe(true);
    // layered: the person above the system, b above a (who calls is on top), not the saved order
    expect(top.nodes.find(n => n.id === 'u')!.y).toBeLessThan(top.nodes.find(n => n.id === 's')!.y);
    expect(inner.nodes.find(n => n.id === 'b')!.y).toBeLessThan(inner.nodes.find(n => n.id === 'a')!.y);
    expect(top.edges.every(e => e.kind === undefined)).toBe(true);
  });
});

describe('phases, steps, the next arrow, proofs and links are checked', () => {
  it('a step sits in a phase or a step; a person or a system never sits inside anything', () => {
    expect(() => checkMap({ elements: [{ id: 'f', kind: 'phase', name: 'F' }, { id: 's', kind: 'step', name: 'S', parent: 'f' }, { id: 't', kind: 'step', name: 'T', parent: 's' }, { id: 'g', kind: 'phase', name: 'G', parent: 'f' }] }, T)).not.toThrow();
    expect(() => checkMap({ elements: [{ id: 'f', kind: 'phase', name: 'F' }, { id: 's', kind: 'system', name: 'S', parent: 'f' }] }, T)).toThrow(/only a part, a phase or a step has a parent/);
    expect(() => checkMap({ elements: [{ id: 'd', kind: 'doc', name: 'D' }, { id: 's', kind: 'step', name: 'S', parent: 'd' }] }, T)).toThrow(/not a doc/);
  });

  it('a next link needs no label, has no status of its own and is never «da capire»', () => {
    const m = mapOf({ elements: phased.elements, links: [{ from: 'p1', to: 'p2', kind: 'next' }, { from: 'p2', to: 'p4', kind: 'next', label: 'dopo il via libera', status: 'unknown' }, { from: 'analisi', to: 'prep', label: 'consegna il piano' }] });
    expect(m.links.map(l => [l.id, l.kind, l.label, l.status])).toEqual([['p1--p2', 'next', '', 'ok'], ['p2--p4', 'next', 'dopo il via libera', 'ok'], ['analisi--prep', undefined, 'consegna il piano', 'unknown']]);
    expect(() => checkMap({ elements: phased.elements, links: [{ from: 'p1', to: 'p2' }] }, T)).toThrow(/label: required/);
    expect(() => checkMap({ elements: phased.elements, links: [{ from: 'p1', to: 'p2', kind: 'then' }] }, T)).toThrow(/kind: "next"/);
    // a status update leaves it alone; long after, it still is not stale
    const after = applyChanges(m, [{ id: 'p1--p2', status: 'blocked' }], T + 1);
    expect(after.links[0]!.status).toBe('ok');
    const lv = levelOf(m, 'prep', T + 100 * 3600_000);
    expect(lv.edges.filter(e => e.kind === 'next').map(e => [e.from, e.to, e.status, e.stale, e.label])).toEqual(expect.arrayContaining([['p1', 'p2', 'ok', false, ''], ['p2', 'p4', 'ok', false, 'dopo il via libera']]));
    const text = mapText({ map: m, agents: [], changed: {} }, T);
    expect(text).toContain('p1--p2: p1 → p2 (passo successivo)');
    expect(text).toContain('(passo successivo: «dopo il via libera»)');
    expect(text.split('\n').filter(l => l.includes('passo successivo')).join()).not.toContain('da capire');
    expect(text).toContain('Elementi: [in fila, in quest\'ordine]');
    expect(text).toContain('p3 · step · Avviso ai clienti (insieme al precedente)');
  });

  it('proofs and refs: a text, a file inside the root, an http(s) address; kept on a redraw that leaves them out', () => {
    const m = mapOf(phased), p1 = m.elements.find(e => e.id === 'p1')!;
    expect(p1.proofs).toEqual([{ text: '12.400 righe copiate', file: 'logs/copy.txt' }, { text: 'Conteggi uguali' }, { text: 'Run verde', href: 'https://ci.example.com/run/7' }]);
    expect(p1.refs).toEqual([{ label: 'Issue', href: 'https://tracker.example.com/1' }]);
    const step = (extra: object) => ({ elements: [{ id: 'f', kind: 'phase', name: 'F' }, { id: 's', kind: 'step', name: 'S', parent: 'f', ...extra }] });
    expect(() => checkMap(step({ proofs: [{ text: 'x', file: '../fuori.txt' }] }), T)).toThrow(/relative to the project's root/);
    expect(() => checkMap(step({ proofs: [{ text: 'x', href: 'javascript:alert(1)' }] }), T)).toThrow(/http\(s\) address/);
    expect(() => checkMap(step({ refs: [{ label: 'x', href: 'file:///etc/passwd' }] }), T)).toThrow(/http\(s\) address/);
    expect(() => checkMap(step({ refs: [{ label: 'x', href: 'https://a.example.com/b c' }] }), T)).toThrow(/http\(s\) address/);
    const again = checkMap({ elements: phased.elements.map(e => (e.id === 'p1' ? { id: 'p1', kind: 'step', name: 'Copia', parent: 'prep' } : e)) }, T + 1, m);
    expect(again.elements.find(e => e.id === 'p1')!.proofs).toHaveLength(3);
    const cleared = checkMap({ elements: phased.elements.map(e => (e.id === 'p1' ? { ...e, proofs: [], refs: [] } : e)) }, T + 1, m).elements.find(e => e.id === 'p1')!;
    expect(cleared.proofs).toBeUndefined(); expect(cleared.refs).toBeUndefined();
    const told = elementText(m, 'p1', T);
    expect(told).toContain('Prove:'); expect(told).toContain('12.400 righe copiate (logs/copy.txt)'); expect(told).toContain('Issue: https://tracker.example.com/1');
    expect(elementText(m, 'prep', T)).toContain('Passi, in ordine:');
  });

  it('edit: a new piece inside a phase is a step, placed before another; set moves it and marks it together', () => {
    const m = mapOf(phased);
    const r = applyEdit(m, [{ op: 'add', name: 'Blocco delle scritture', parent: 'prep', before: 'p2' }, { op: 'set', id: 'p4', par: true }, { op: 'link', from: 'p1', to: 'p4', next: true }], T + 1);
    const inPrep = r.elements.filter(e => e.parent === 'prep');
    expect(inPrep.map(e => e.id)).toEqual(['p1', 'blocco-delle-scritture', 'p2', 'p3', 'p4']);
    expect(inPrep[1]).toMatchObject({ kind: 'step', status: 'planned' });
    expect(inPrep[4]!.par).toBe(true);
    expect(r.links.find(l => l.id === 'p1--p4')).toMatchObject({ kind: 'next', status: 'ok', label: '' });
    // untouched pieces keep what they had
    expect(r.elements.find(e => e.id === 'p1')!.proofs).toHaveLength(3); expect(r.elements.find(e => e.id === 'p3')!.par).toBe(true);
    const moved = applyEdit({ ...m, elements: r.elements, links: r.links }, [{ op: 'set', id: 'p4', before: 'p1', par: false }, { op: 'set', id: 'prep', layout: 'auto' }], T + 2);
    expect(moved.elements.filter(e => e.parent === 'prep').map(e => e.id)[0]).toBe('p4');
    expect(moved.elements.find(e => e.id === 'p4')!.par).toBeUndefined();
    expect(moved.elements.find(e => e.id === 'prep')!.layout).toBe('auto');
    expect(() => applyEdit(m, [{ op: 'set', id: 'p4', before: 'nope' }], T)).toThrow(/before: the id of another piece on the same level/);
    // a piece of another phase is not a place in this one; «together» is true or false, never a word
    expect(() => applyEdit(m, [{ op: 'set', id: 'p4', before: 'migra' }], T)).toThrow(/before: the id of another piece on the same level/);
    expect(() => applyEdit(m, [{ op: 'set', id: 'p3', par: 'true' }], T)).toThrow(/par: true or false/);
  });

  it('a redraw that leaves a piece\'s layout out keeps it; «together» is told only where it is drawn', () => {
    const first = mapOf({ elements: phased.elements.map(e => (e.id === 'prep' ? { ...e, layout: 'auto' } : e.id === 'analisi' ? { ...e, par: true } : e)) });
    expect(checkMap(phased, T + 1, first).elements.find(e => e.id === 'prep')!.layout).toBe('auto');
    const text = mapText({ map: first, agents: [], changed: {} }, T);
    // the first piece of a line has none before it, and the steps of «prep» are drawn in layers here
    expect(text).not.toContain('(insieme al precedente)');
    expect(elementText(first, 'prep', T, {})).not.toContain('(insieme al precedente)');
  });
});

describe('an arrow of a line never runs behind a box', () => {
  type Pt = [number, number];
  /** the boxes a straight stretch a→b goes through (touching a side does not count) */
  const through = (lv: ReturnType<typeof levelOf>, a: Pt, b: Pt) => lv.nodes.filter(n =>
    Math.max(a[0], b[0]) > n.x && Math.min(a[0], b[0]) < n.x + n.w && Math.max(a[1], b[1]) > n.y && Math.min(a[1], b[1]) < n.y + n.h).map(n => n.id);
  const crossed = (lv: ReturnType<typeof levelOf>) => lv.edges.flatMap(e => (e.route ?? []).slice(1).flatMap((c, i) => through(lv, e.route![i]!, c).map(id => `${e.from}>${e.to} behind ${id}`)));
  const steps = (n: number, more: Record<string, object> = {}) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, kind: 'step', name: `S${i + 1}`, ...more[`s${i + 1}`] }));
  const edge = (lv: ReturnType<typeof levelOf>, from: string, to: string) => lv.edges.find(e => e.from === from && e.to === to)!;

  it('the arrow to the place beside runs side to side; a jump goes over the row, a way back under it', () => {
    const lv = levelOf(mapOf({ elements: steps(4), links: [{ from: 's1', to: 's3', kind: 'next', label: 'se è piccolo' }, { from: 's4', to: 's1', label: 'da rifare' }, { from: 's3', to: 's2', label: 'corregge' }] }), null, T);
    expect([edge(lv, 's1', 's2').side, edge(lv, 's3', 's2').side, edge(lv, 's1', 's2').route]).toEqual([true, true, undefined]);
    const [s1, s3] = xs(lv, ['s1', 's3']);
    const jump = edge(lv, 's1', 's3').route!, back = edge(lv, 's4', 's1').route!;
    expect(jump[0]).toEqual([s1!.x + s1!.w, s1!.y + s1!.h / 2 - 28]); expect(jump.at(-1)).toEqual([s3!.x, s3!.y + s3!.h / 2 - 28]);
    expect(Math.min(...jump.map(c => c[1]))).toBeLessThan(s1!.y); expect(Math.min(...jump.map(c => c[1]))).toBeGreaterThan(0);
    expect(Math.max(...back.map(c => c[1]))).toBeGreaterThan(s1!.y + s1!.h); expect(Math.max(...back.map(c => c[1]))).toBeLessThan(lv.height);
    expect(crossed(lv)).toEqual([]);
  });

  it('the arrow to the next row goes round the row, also from and to steps that go together', () => {
    const lv = levelOf(mapOf({ elements: steps(LINE_MAX + 5, { s2: { par: true }, s8: { par: true }, s10: { par: true } }) }), null, T);
    // s7 and s8 share the last place of the first row, s9 and s10 the first of the second: four arrows go round
    expect(xs(lv, ['s8', 's9']).map(n => n!.n)).toEqual([LINE_MAX, LINE_MAX + 1]);
    const round = lv.edges.filter(e => ['s7', 's8'].includes(e.from) && ['s9', 's10'].includes(e.to));
    expect(round).toHaveLength(4); expect(round.every(e => e.route && e.route.every(c => c[0] >= 0 && c[0] <= lv.width))).toBe(true);
    expect(crossed(lv)).toEqual([]);
    for (const e of lv.edges) expect(!!e.side || !!e.route).toBe(true);
  });

  it('an arrow to or from an outside box runs along the lanes, whatever column and row it starts from', () => {
    const els = [{ id: 'sys', kind: 'system', name: 'Sys' }, ...steps(LINE_MAX + 2, { s2: { par: true } }).map(e => ({ ...e, parent: 'sys' })), { id: 'ext', kind: 'external', name: 'Ext' }, { id: 'doc', kind: 'doc', name: 'Doc' }];
    const lv = levelOf(mapOf({ elements: els, links: [{ from: 's1', to: 'ext', label: 'chiede' }, { from: 'doc', to: 's3', label: 'spiega' }, { from: 's8', to: 'doc', label: 'aggiorna' }] }), 'sys', T);
    expect(lv.linear).toBe(true);
    expect(lv.nodes.filter(n => n.ctx).map(n => n.id).sort()).toEqual(['doc', 'ext']);
    for (const [a, b] of [['s1', 'ext'], ['doc', 's3'], ['s8', 'doc']]) expect(edge(lv, a!, b!).route!.length).toBeGreaterThan(3);
    expect(crossed(lv)).toEqual([]);
  });

  it('a level in layers has no routes: its arrows are drawn as before', () => {
    const lv = levelOf(mapOf({ elements: [{ id: 'a', kind: 'system', name: 'A' }, { id: 'b', kind: 'system', name: 'B' }, { id: 'c', kind: 'system', name: 'C' }], links: [{ from: 'a', to: 'c', label: 'x' }, { from: 'a', to: 'b', label: 'y' }] }), null, T);
    expect(lv.edges.some(e => e.side || e.route)).toBe(false);
  });

  it('an arrow that stands for a next link and a passage tells the passage, with its note and whose turn it is', () => {
    const m = mapOf({ elements: [{ id: 'f', kind: 'phase', name: 'F' }, { id: 'g', kind: 'phase', name: 'G' }, { id: 'f1', kind: 'step', name: 'F1', parent: 'f' }, { id: 'g1', kind: 'step', name: 'G1', parent: 'g' }],
      links: [{ from: 'f', to: 'g', kind: 'next' }, { from: 'f1', to: 'g1', label: 'consegna', status: 'blocked', note: 'manca la firma', actor: 'user' }] });
    expect(levelOf(m, null, T).edges).toEqual([expect.objectContaining({ from: 'f', to: 'g', label: 'consegna', status: 'blocked', note: 'manca la firma', actor: 'user', count: 2 })]);
    expect(levelOf(m, null, T).edges[0]!.kind).toBeUndefined();
  });
});

describe('saved and read back', () => {
  let dir = '';
  // fake timers, as in projectmap-service.test.ts: the service's debounced notice never runs on a real clock
  beforeEach(() => { vi.useFakeTimers(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-map-linear-')); });
  afterEach(() => { vi.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('save keeps the map layout until another is sent; the file read back holds the new fields and drops broken ones', () => {
    const maps = new ProjectMaps({ store: new ProjectMapStore(() => dir), chats: () => [], items: () => [], pending: () => [], emit: () => {}, stateFile: path.join(dir, 'state.json'), now: () => T, debounceMs: 10 });
    const first = maps.save({ title: 'Migrazione', map: { ...phased, layout: 'auto', links: [{ from: 'p1', to: 'p2', kind: 'next' }] }, by: 't', summary: 's' });
    expect(first.layout).toBe('auto');
    expect(maps.save({ project: first.project, map: phased, by: 't', summary: 's' }).layout).toBe('auto');
    expect(maps.save({ project: first.project, map: { ...phased, layout: 'linear' }, by: 't', summary: 's' }).layout).toBe('linear');
    expect(() => maps.save({ project: first.project, map: { ...phased, layout: 'rows' }, by: 't', summary: 's' })).toThrow(/layout: linear \| auto/);
    const read = new ProjectMapStore(() => dir).get(first.project)!;
    expect(read.elements.find(e => e.id === 'p3')).toMatchObject({ kind: 'step', parent: 'prep', par: true });
    expect(read.elements.find(e => e.id === 'p1')!.proofs).toHaveLength(3);
    // a hand-edited file: what the drawing cannot show is dropped, the rest stays
    const raw = { ...read, layout: 'spiral', elements: read.elements.map(e => (e.id === 'p1' ? { ...e, layout: 7, par: 'si', proofs: [{ text: 'ok', href: 'javascript:x' }, { nope: 1 }], refs: [{ label: 'x', href: 'ftp://a' }] } : e)),
      links: [{ id: 'l', from: 'p1', to: 'p2', status: 'ok', kind: 'weird' }] };
    const m = asMap(JSON.parse(JSON.stringify(raw)), 'x')!;
    const p1 = m.elements.find(e => e.id === 'p1')!;
    expect(m.layout).toBeUndefined(); expect(p1.layout).toBeUndefined(); expect(p1.par).toBeUndefined();
    expect(p1.proofs).toEqual([{ text: 'ok' }]); expect(p1.refs).toBeUndefined(); expect(m.links[0]!.kind).toBeUndefined();
    expect(p1.parent).toBe('prep');
    // an arrow to the next step written by hand with a status: it waits for nobody and is never «da capire»
    const hand = asMap(JSON.parse(JSON.stringify({ ...read, links: [{ id: 'n', from: 'p1', to: 'p2', kind: 'next', status: 'blocked', actor: 'user' }, { id: 'w', from: 'p2', to: 'p4', kind: 'next', status: 'work' }] })), 'x')!;
    expect(hand.links.map(l => [l.id, l.kind, l.status, l.actor])).toEqual([['n', 'next', 'ok', undefined], ['w', 'next', 'ok', undefined]]);
    expect(levelOf(hand, 'prep', T + 100 * 3600_000).edges.filter(e => e.ids.length).map(e => [e.status, e.stale])).toEqual([['ok', false], ['ok', false]]);
  });

  it('undo brings back the layout the map had', () => {
    const maps = new ProjectMaps({ store: new ProjectMapStore(() => dir), chats: () => [], items: () => [], pending: () => [], emit: () => {}, stateFile: path.join(dir, 'state.json'), now: () => T, debounceMs: 10 });
    const first = maps.save({ title: 'Migrazione', map: phased, by: 't', summary: 'in fila' });
    expect(first.layout).toBeUndefined();
    expect(maps.save({ project: first.project, map: { ...phased, layout: 'auto' }, by: 't', summary: 'a livelli' }).layout).toBe('auto');
    expect(maps.undo(first.project, 't').layout).toBeUndefined();
    // and the other way: the undo of «back to a line» is «in layers» again
    maps.save({ project: first.project, map: { ...phased, layout: 'auto' }, by: 't', summary: 'a livelli' });
    maps.save({ project: first.project, map: { ...phased, layout: 'linear' }, by: 't', summary: 'in fila' });
    expect(maps.undo(first.project, 't').layout).toBe('auto');
  });
});
