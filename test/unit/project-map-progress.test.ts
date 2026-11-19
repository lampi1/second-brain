// Unit tests of how far a project is, read from its map (ADR 0326; src/shared/project-map-progress.ts): the count of
// the pieces with nothing inside, the percentage, the phases with their own count, where the project is and what comes
// next when the phases come in order (a line, or boxes chained by their links), what is under way, what waits for the
// user, which maps have a progress at all, a plan's own count, and the line of text for the Orchestrator.
import { describe, expect, it } from 'vitest';
import { checkMap, type MapPlan, type ProjectMap } from '../../src/shared/project-map';
import { countOf, pctOf, planProgress, progressLine, progressOf } from '../../src/shared/project-map-progress';

const T = 1_000_000_000;
const mapOf = (drawing: unknown): ProjectMap => ({ project: 'n', title: 'N', version: 1, updatedAt: T, by: 'x', summary: '', corrections: [], ...checkMap(drawing, T) });
const phased = mapOf({
  elements: [
    { id: 'analisi', kind: 'phase', name: 'Analisi', status: 'ok' },
    { id: 'a1', kind: 'step', name: 'Inventario', parent: 'analisi', status: 'ok' },
    { id: 'a2', kind: 'step', name: 'Destino', parent: 'analisi', status: 'ok' },
    { id: 'prep', kind: 'phase', name: 'Preparazione', status: 'work' },
    { id: 'p1', kind: 'step', name: 'Script', parent: 'prep', status: 'ok' },
    { id: 'p2', kind: 'step', name: 'Prova di ripristino', parent: 'prep', status: 'work', note: 'mancano gli allegati' },
    { id: 'p3', kind: 'step', name: 'Via libera', parent: 'prep', status: 'blocked', actor: 'user', note: 'serve il tuo ok' },
    { id: 'p4', kind: 'step', name: 'Avviso', parent: 'prep', status: 'planned' },
    { id: 'migra', kind: 'phase', name: 'Migrazione', status: 'planned' },
    { id: 'm1', kind: 'step', name: 'Copia', parent: 'migra', status: 'planned' },
    { id: 'verifica', kind: 'phase', name: 'Verifica', status: 'unknown' },
    { id: 'capo', kind: 'person', name: 'Responsabile' },
  ],
  links: [{ from: 'capo', to: 'analisi', label: 'firma', status: 'blocked', actor: 'other', note: 'in ferie' }],
});

describe('the percentage', () => {
  it('is 100 only when everything is done and never 0 once something is', () => {
    expect(pctOf(0, 0)).toBe(0);
    expect(pctOf(0, 7)).toBe(0);
    expect(pctOf(1, 300)).toBe(1);
    expect(pctOf(1, 3)).toBe(33);
    expect(pctOf(299, 300)).toBe(99);
    expect(pctOf(3, 3)).toBe(100);
  });
});

describe('a map told as phases and steps', () => {
  const p = progressOf(phased)!;
  it('counts the steps with nothing inside; a phase without steps counts as one; people are not work', () => {
    expect([p.done, p.total, p.pct, p.unknown, p.steps]).toEqual([3, 8, 38, 1, true]);
  });
  it('gives each phase its own count and state, in the saved order', () => {
    expect(p.ordered).toBe(true);
    expect(p.groups.map(g => [g.id, g.done, g.total, g.state])).toEqual([['analisi', 2, 2, 'done'], ['prep', 1, 4, 'blocked'], ['migra', 0, 1, 'todo'], ['verifica', 0, 1, 'todo']]);
    expect(p.groups[0]!.pct).toBe(100);
  });
  it('says where the project is, what is under way, what waits for the user, what is blocked and what comes next', () => {
    expect(p.at).toBe(1);
    expect(p.now).toEqual([{ id: 'p2', name: 'Prova di ripristino', within: 'Preparazione', note: 'mancano gli allegati' }]);
    expect(p.you).toEqual([{ id: 'p3', name: 'Via libera', within: 'Preparazione', note: 'serve il tuo ok' }]);
    expect(p.blocked).toEqual([{ id: 'capo--analisi', name: 'firma', note: 'in ferie', link: true }]);
    expect(p.next).toEqual({ id: 'p4', name: 'Avviso', within: 'Preparazione' });
  });
  it('a piece somebody works on right now is under way whatever its status, and is not what comes next', () => {
    const live = progressOf(phased, new Set(['p4', 'migra']))!;
    expect(live.now.map(x => x.id)).toEqual(['p2', 'p4']);
    expect(live.next?.id).toBe('m1');
    expect(live.groups[2]!.state).toBe('now');
    // a done step somebody touches again stays done
    expect(progressOf(phased, new Set(['a1']))!.now.map(x => x.id)).toEqual(['p2']);
  });
  it('a finished project is at 100 with no place left', () => {
    const all = { ...phased, elements: phased.elements.map(e => ({ ...e, status: 'ok' as const })), links: [] };
    const d = progressOf(all)!;
    expect([d.done, d.total, d.pct, d.at, d.next, d.now.length]).toEqual([8, 8, 100, undefined, undefined, 0]);
  });
  it('counts the inside of one piece too (a phase\'s own bar)', () => {
    const c = countOf(phased, 'prep')!;
    expect([c.done, c.total, c.pct]).toEqual([1, 4, 25]);
    expect(c.you.map(x => x.id)).toEqual(['p3']);
    expect(c.blocked).toEqual([]); // the map's links are told on the whole map only
    expect(countOf(phased, 'a1')).toBeNull();
  });
});

describe('which maps have a progress', () => {
  const sys = (links: unknown[], status: Record<string, string> = {}) => mapOf({
    elements: [
      { id: 'utente', kind: 'person', name: 'Utente', status: 'ok' },
      { id: 'zero', kind: 'system', name: '0 · Analisi', status: status.zero ?? 'ok' },
      { id: 'z1', kind: 'part', name: 'Vecchia analisi', parent: 'zero', status: 'ok' },
      { id: 'uno', kind: 'system', name: '1 · Base dei test', status: status.uno ?? 'work' },
      { id: 'u1', kind: 'part', name: 'Test su DB vero', parent: 'uno', status: status.u1 ?? 'ok' },
      { id: 'u2', kind: 'part', name: 'Test dei medici', parent: 'uno', status: status.u2 ?? 'work' },
      { id: 'due', kind: 'system', name: '2 · EF ovunque', status: status.due ?? 'planned' },
    ],
    links,
  });
  const chain = [{ from: 'uno', to: 'due', label: 'poi', id: 'b' }, { from: 'zero', to: 'uno', label: 'poi', id: 'a' }];
  it('systems chained by their links from the first to the last are phases in that order', () => {
    const p = progressOf(sys(chain))!;
    expect(p.steps).toBe(false);
    expect(p.ordered).toBe(true);
    expect(p.groups.map(g => g.id)).toEqual(['zero', 'uno', 'due']);
    expect([p.done, p.total, p.pct, p.at]).toEqual([2, 4, 50, 1]);
    expect(p.next?.id).toBe('due');
  });
  it('a map of systems with no order is a picture, not a plan: no progress', () => {
    expect(progressOf(sys([]))).toBeNull();
    expect(progressOf(sys([{ from: 'zero', to: 'uno', label: 'chiama' }, { from: 'zero', to: 'due', label: 'chiama' }]))).toBeNull(); // a fork
    expect(progressOf(sys([...chain, { from: 'due', to: 'zero', label: 'torna', id: 'c' }]))).toBeNull(); // a loop
    expect(countOf(sys([]))!.total).toBe(4); // counted all the same when asked
  });
  it('a chain where everything works or nobody knows has nothing to track', () => {
    expect(progressOf(sys(chain, { uno: 'ok', u2: 'ok', due: 'ok' }))).toBeNull();
    expect(progressOf(sys(chain, { uno: 'ok', u2: 'unknown', due: 'ok' }))).toBeNull();
  });
  it('an empty map has none', () => {
    expect(progressOf({ elements: [], links: [] })).toBeNull();
  });
});

describe('a plan\'s own count', () => {
  const plan: Pick<MapPlan, 'flow'> = { flow: [
    { step: 1, title: 'a', state: 'done', wave: 1 }, { step: 2, title: 'b', state: 'now', wave: 2 }, { step: 3, title: 'c', state: 'blocked', wave: 3 },
    { step: 4, title: 'd', state: 'todo', wave: 4 }, { step: 5, title: 'e', state: 'todo', wave: 5 },
  ] };
  it('steps done, under way, stuck, and the first still to start', () => {
    const p = planProgress(plan);
    expect([p.done, p.total, p.pct]).toEqual([1, 5, 20]);
    expect(p.now.map(f => f.step)).toEqual([2]);
    expect(p.blocked.map(f => f.step)).toEqual([3]);
    expect(p.next?.step).toBe(4);
    expect(planProgress({ flow: [] }).pct).toBe(0);
  });
  it('a step waits for the user when a chat working on it asked something; a done step never does', () => {
    const flow = [{ step: 1, title: 'a', state: 'done' as const, wave: 1, chatIds: ['c1'] }, { step: 2, title: 'b', state: 'now' as const, wave: 2, chatIds: ['c2', 'c3'] }, { step: 3, title: 'c', state: 'todo' as const, wave: 3 }];
    expect(planProgress({ flow }).you).toEqual([]);
    expect(planProgress({ flow }, new Set(['c1', 'c3', 'zz'])).you.map(f => f.step)).toEqual([2]);
  });
});

describe('the progress as a line of text', () => {
  it('tells the Orchestrator the number the user sees', () => {
    expect(progressLine(phased)).toBe('Avanzamento: 3 di 8 passi (38%); siamo a «Preparazione»; in corso: Prova di ripristino; aspettano l\'utente: Via libera; poi: Avviso');
    expect(progressLine({ elements: [], links: [] })).toBe('');
  });
});
