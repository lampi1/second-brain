// The Grindhouse grouped by Strategist (src/renderer/lib/grind-groups.ts, ADR 0366): one unit per root chat with its
// whole subtree, siblings ordered wait → work → done with each subtree after its chat, the sections «Ti aspetta»,
// «Al lavoro», «Finite oggi» in that order from the worst status of the unit, the root and delegated statuses, and the
// hold that keeps a unit at work through a short stop.
import { describe, expect, it } from 'vitest';
import { chatTree } from '../../src/renderer/lib/chat-tree';
import { grindSections, holdStatuses, kidCount, kidStatus, rootStatus, type GrindKid, type GrindStatus } from '../../src/renderer/lib/grind-groups';

type Row = { cwd: string; parentId: string | null; closedAt: number | null; delegation?: undefined };
const row = (parentId: string | null = null): Row => ({ cwd: 'C:/p', parentId, closedAt: null });
const tree = (chats: Record<string, Row>) => chatTree(Object.keys(chats), chats as never);
const of = (m: Record<string, GrindStatus>) => (id: string): GrindStatus => m[id] ?? 'work';
/** The kids flattened depth first, as [id, depth]. */
const flat = (kids: readonly GrindKid[], depth = 1): [string, number][] => kids.flatMap(k => [[k.id, depth] as [string, number], ...flat(k.kids, depth + 1)]);

describe('grindSections', () => {
  it('makes one unit per Strategist with its children and grandchildren indented, plain chats as units of their own', () => {
    const nodes = tree({ s1: row(), a: row('s1'), b: row('s1'), g: row('a'), plain: row() });
    const secs = grindSections(nodes, of({}));
    expect(secs.map(s => s.id)).toEqual(['work']);
    expect(secs[0]!.units.map(u => u.lead)).toEqual(['s1', 'plain']);
    expect(secs[0]!.units[0]!.kids).toEqual([{ id: 'a', kids: [{ id: 'g', kids: [] }] }, { id: 'b', kids: [] }]);
    expect(kidCount(secs[0]!.units[0]!.kids)).toBe(3);
    expect(secs[0]!.units[1]!.kids).toEqual([]);
  });

  it('orders the children: waiting for the user first, then at work, then ended; their own subtree right after each', () => {
    const nodes = tree({ s: row(), d: row('s'), w: row('s'), q: row('s'), q2: row('q') });
    const u = grindSections(nodes, of({ d: 'done', w: 'work', q: 'wait', q2: 'done' }))[0]!.units[0]!;
    expect(flat(u.kids)).toEqual([['q', 1], ['q2', 2], ['w', 1], ['d', 1]]);
  });

  it('puts a unit in the section of its worst status, sections in the order Ti aspetta, Al lavoro, Finite oggi', () => {
    const nodes = tree({ done: row(), s: row(), k: row('s'), w: row(), x: row(), xk: row('x') });
    const secs = grindSections(nodes, of({ done: 'done', s: 'done', k: 'wait', w: 'work', x: 'done', xk: 'work' }));
    expect(secs.map(s => [s.id, s.units.map(u => u.lead)])).toEqual([['wait', ['s']], ['work', ['w', 'x']], ['done', ['done']]]);
  });

  it('keeps the tree order of the units inside a section and leaves empty sections out', () => {
    const nodes = tree({ b: row(), a: row(), c: row() });
    const secs = grindSections(nodes, of({ a: 'done', b: 'done', c: 'done' }));
    expect(secs).toHaveLength(1);
    expect(secs[0]!.units.map(u => u.lead)).toEqual(nodes.map(n => n.id));
  });

  it('nothing to show: no sections', () => {
    expect(grindSections([], of({}))).toEqual([]);
  });
});

describe('statuses', () => {
  it('a root chat: waiting or failed → wait, ended → done, anything else → work', () => {
    expect(rootStatus('wait')).toBe('wait');
    expect(rootStatus('err')).toBe('wait');
    expect(rootStatus('done')).toBe('done');
    for (const t of ['run', 'off', 'idle', 'orchestrator'] as const) expect(rootStatus(t)).toBe('work');
  });
  it('a delegated chat: a question or an error → wait, a result or an archive → done, the rest → work', () => {
    expect(kidStatus('wait')).toBe('wait');
    expect(kidStatus('err')).toBe('wait');
    for (const s of ['done', 'partial', 'blocked', 'noreport', 'closed'] as const) expect(kidStatus(s)).toBe('done');
    for (const s of ['run', 'start', 'queued', 'heldParent', 'heldOrchestrator', 'stall', 'refused'] as const) expect(kidStatus(s)).toBe('work');
  });
});

describe('holdStatuses', () => {
  it('a chat that leaves work stays at work until the stop lasts the hold, then shows ended', () => {
    const mem = new Map();
    expect(holdStatuses({ a: 'work' }, mem, 0, 700)).toEqual({ shown: { a: 'work' }, wakeAt: null });
    expect(holdStatuses({ a: 'done' }, mem, 100, 700)).toEqual({ shown: { a: 'work' }, wakeAt: 800 });
    expect(holdStatuses({ a: 'done' }, mem, 500, 700)).toEqual({ shown: { a: 'work' }, wakeAt: 800 });
    expect(holdStatuses({ a: 'done' }, mem, 800, 700)).toEqual({ shown: { a: 'done' }, wakeAt: null });
  });
  it('back at work within the hold: nothing moved; a wait and a first sight show at once', () => {
    const mem = new Map();
    holdStatuses({ a: 'work', b: 'work' }, mem, 0, 700);
    holdStatuses({ a: 'done', b: 'wait' }, mem, 10, 700);
    expect(holdStatuses({ a: 'work', b: 'wait', c: 'done' }, mem, 20, 700)).toEqual({ shown: { a: 'work', b: 'wait', c: 'done' }, wakeAt: null });
  });
  it('forgets the chats that left the page', () => {
    const mem = new Map();
    holdStatuses({ a: 'work' }, mem, 0, 700);
    holdStatuses({}, mem, 1, 700);
    expect(mem.size).toBe(0);
  });
});
