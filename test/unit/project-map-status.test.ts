// Unit tests of shared/project-map-status.ts (issue #456, ADR 0330): a box with pieces inside shows what they say
// together, at every depth, in the drawing (statusesOf), in the saved file (settle) and in the map's text; a phase or
// a step that is ok reads «fatto», anything else «funziona»; a status meant for a box lands on its open pieces
// (spread); the progress no longer reads a box's own status.
import { describe, expect, it } from 'vitest';
import { elementText, mapText, type MapElement, type MapState, type ProjectMap } from '../../src/shared/project-map';
import { countOf } from '../../src/shared/project-map-progress';
import { STALE_MS, leavesOf, rollUp, settle, spread, stateLabel, statusesOf, waitingOf } from '../../src/shared/project-map-status';

const T = 1_000_000_000;
const el = (id: string, status: MapState, x: Partial<MapElement> = {}): MapElement => ({ id, kind: 'step', name: id.toUpperCase(), status, evidence: [], confirmedAt: T, ...x });
const map = (elements: MapElement[]): ProjectMap => ({ project: 'p', title: 'P', version: 1, updatedAt: T, by: 'x', summary: '', elements, links: [], corrections: [] });
const s = (status: MapState, x: { stale?: boolean; actor?: 'user' | 'agent' | 'other' } = {}) => ({ status, stale: !!x.stale, ...(x.actor ? { actor: x.actor } : {}) });

describe('rollUp', () => {
  it('all done = done; one under way = under way; one stuck = stuck', () => {
    expect(rollUp([s('ok'), s('ok')])).toEqual(s('ok'));
    expect(rollUp([s('ok'), s('work'), s('planned')])).toEqual(s('work'));
    expect(rollUp([s('ok'), s('work'), s('blocked')])).toEqual(s('blocked'));
  });
  it('stuck waits for the user when one of its stuck pieces does', () => {
    expect(rollUp([s('blocked', { actor: 'agent' }), s('blocked', { actor: 'user' })])).toEqual(s('blocked', { actor: 'user' }));
    expect(rollUp([s('blocked', { actor: 'other' }), s('ok')])).toEqual(s('blocked', { actor: 'other' }));
  });
  it('some done and some still to start = under way; none started = planned; a piece to verify = to verify', () => {
    expect(rollUp([s('ok'), s('planned')])).toEqual(s('work'));
    expect(rollUp([s('planned'), s('planned')])).toEqual(s('planned'));
    expect(rollUp([s('planned'), s('unknown')])).toEqual(s('planned'));
    expect(rollUp([s('ok'), s('unknown', { stale: true })])).toEqual(s('unknown', { stale: true }));
    expect(rollUp([s('ok'), s('unknown')])).toEqual(s('unknown'));
    expect(rollUp([s('unknown')])).toEqual(s('unknown'));
  });
});

describe('statusesOf', () => {
  // the owner's case: a phase saved ok over steps that are not all done
  const m = map([
    el('f1', 'ok', { kind: 'phase' }), el('a', 'ok', { parent: 'f1' }), el('b', 'planned', { parent: 'f1' }),
    el('f2', 'planned', { kind: 'phase' }), el('c', 'ok', { parent: 'f2' }), el('d', 'blocked', { parent: 'f2', actor: 'user' }),
    el('f3', 'work', { kind: 'phase' }), el('e', 'ok', { parent: 'f3' }), el('g', 'ok', { parent: 'f3' }),
    el('f4', 'ok', { kind: 'phase' }), el('h', 'work', { parent: 'f4' }), el('h1', 'ok', { parent: 'h' }), el('h2', 'work', { parent: 'h' }),
  ]);
  it('a box never shows its own saved status: it shows its pieces, all the way down', () => {
    const st = statusesOf(m, T);
    expect(st.get('f1')).toEqual(s('work'));
    expect(st.get('f2')).toEqual(s('blocked', { actor: 'user' }));
    expect(st.get('f3')).toEqual(s('ok'));
    expect(st.get('h')).toEqual(s('work'));
    expect(st.get('f4')).toEqual(s('work'));
    expect(st.get('a')).toEqual(s('ok'));
  });
  it('a piece under way nobody confirmed lately reads «da verificare», and so does the box around it', () => {
    const st = statusesOf(m, T + STALE_MS + 1);
    expect(st.get('h2')).toEqual(s('unknown', { stale: true }));
    expect(st.get('f4')).toEqual(s('unknown', { stale: true }));
    // files of a done piece edited after it was confirmed
    expect(statusesOf(m, T, { e: T + 5 }).get('f3')).toEqual(s('unknown', { stale: true }));
    // the box's own files, when everything inside is done
    expect(statusesOf(m, T, { f3: T + 5 }).get('f3')).toEqual(s('unknown', { stale: true }));
  });
  it('a box somebody works on right now reads under way, unless a piece inside is stuck', () => {
    const busy = (id: string) => map(m.elements.map(e => (e.id === id ? { ...e, busy: true as const } : e)));
    expect(statusesOf(busy('f3'), T).get('f3')).toEqual(s('work'));
    expect(statusesOf(busy('f2'), T).get('f2')).toEqual(s('blocked', { actor: 'user' }));
    // on a piece with nothing inside the mark means nothing
    expect(statusesOf(busy('a'), T).get('a')).toEqual(s('ok'));
  });
  it('a box whose chat waits and no piece inside can say so reads stuck on that actor, and counts once among what waits', () => {
    const waits = (id: string, actor: 'user' | 'agent') => map(m.elements.map(e => (e.id === id ? { ...e, waits: actor } : e)));
    expect(statusesOf(waits('f3', 'user'), T).get('f3')).toEqual(s('blocked', { actor: 'user' }));
    expect(statusesOf(waits('f3', 'agent'), T).get('f3')).toEqual(s('blocked', { actor: 'agent' }));
    // a piece inside already waits for the user: it stays the user's turn
    expect(statusesOf(waits('f2', 'agent'), T).get('f2')).toEqual(s('blocked', { actor: 'user' }));
    const w = waits('f3', 'user');
    expect(waitingOf(w, statusesOf(w, T))).toBe(waitingOf(m, statusesOf(m, T)) + 1);
    // as saved (no drawing at hand): the pieces with nothing inside, never their box too
    expect(waitingOf(m)).toBe(m.elements.filter(e => !m.elements.some(k => k.parent === e.id) && e.status === 'blocked' && e.actor === 'user').length);
  });
  it('the map\'s text says the same, with «fatto» on phases and steps and «funziona» elsewhere', () => {
    const text = mapText({ map: m, agents: [], changed: {} }, T);
    expect(text).toContain('- f1 · phase · F1 — in lavorazione');
    expect(text).toContain('- f2 · phase · F2 — bloccato [tocca all\'utente]');
    expect(text).toContain('- f3 · phase · F3 — fatto');
    expect(text).toContain('  - a · step · A — fatto');
    expect(elementText(m, 'f3', T)).toContain('«F3» (f3, phase) — fatto');
    const sys = map([el('web', 'ok', { kind: 'system' }), el('cart', 'ok', { kind: 'part', parent: 'web' })]);
    expect(mapText({ map: sys, agents: [], changed: {} }, T)).toContain('- web · system · WEB — funziona');
  });
});

describe('stateLabel', () => {
  it('ok is «fatto» on a phase or a step, «funziona» on anything else', () => {
    expect(stateLabel('ok', 'step')).toBe('fatto');
    expect(stateLabel('ok', 'phase')).toBe('fatto');
    expect(stateLabel('ok', 'system')).toBe('funziona');
    expect(stateLabel('ok')).toBe('funziona');
    expect(stateLabel('work', 'step')).toBe('in lavorazione');
    expect(stateLabel('stale', 'step')).toBe('da verificare');
  });
});

describe('settle', () => {
  it('saves each box with what its pieces say; nothing to change returns the same array', () => {
    const els = [el('f', 'ok', { kind: 'phase' }), el('a', 'ok', { parent: 'f' }), el('b', 'planned', { parent: 'f' }), el('lone', 'ok', { kind: 'phase' })];
    const out = settle(els);
    expect(out.map(e => e.status)).toEqual(['work', 'ok', 'planned', 'ok']);
    expect(out[1]).toBe(els[1]);
    expect(settle(out)).toBe(out);
  });
});

describe('spread', () => {
  const els = [el('f', 'planned', { kind: 'phase' }), el('a', 'ok', { parent: 'f' }), el('b', 'planned', { parent: 'f' }), el('c', 'blocked', { parent: 'f' }), el('d', 'unknown', { parent: 'f' }), el('lone', 'planned')];
  it('a piece with nothing inside takes the status itself', () => {
    expect(spread(els, 'lone', 'work')).toEqual([{ id: 'lone', status: 'work' }]);
    expect(spread(els, 'lone', 'planned' as never)).toEqual([]);
    expect(leavesOf(els, 'lone').map(e => e.id)).toEqual(['lone']);
  });
  it('a box holds no status: under way saves nothing, done and stuck land on the pieces it speaks for', () => {
    expect(leavesOf(els, 'f').map(e => e.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(spread(els, 'f', 'work')).toEqual([]);
    // a finished phase has finished steps: the ones not started turn done; a done or stuck one is left alone
    expect(spread(els, 'f', 'ok')).toEqual([{ id: 'b', status: 'ok' }, { id: 'd', status: 'ok' }]);
    // stuck: the pieces under way, else the first step still open
    expect(spread(els, 'f', 'blocked')).toEqual([{ id: 'b', status: 'blocked' }]);
    expect(spread(els.map(e => (e.id === 'd' ? { ...e, status: 'work' as const } : e)), 'f', 'blocked')).toEqual([{ id: 'd', status: 'blocked' }]);
    // a piece somebody else speaks for is skipped
    expect(spread(els, 'f', 'ok', new Set(['b']))).toEqual([{ id: 'd', status: 'ok' }]);
  });
  it('the parts of a system nobody worked on keep what they say when work on the system ends', () => {
    const sys = [el('web', 'ok', { kind: 'system' }), el('cart', 'work', { kind: 'part', parent: 'web' }), el('pay', 'unknown', { kind: 'part', parent: 'web' }), el('new', 'planned', { kind: 'part', parent: 'web' })];
    expect(spread(sys, 'web', 'ok')).toEqual([{ id: 'cart', status: 'ok' }]);
    expect(spread(sys.map(e => (e.id === 'cart' ? { ...e, status: 'ok' as const } : e)), 'web', 'blocked')).toEqual([]);
  });
});

describe('progress', () => {
  it('reads the pieces, never the box around them', () => {
    // the phase is saved blocked and under way, its steps are not
    const m = map([el('f1', 'blocked', { kind: 'phase', actor: 'user' }), el('a', 'ok', { parent: 'f1' }), el('b', 'planned', { parent: 'f1' }), el('f2', 'work', { kind: 'phase' }), el('c', 'planned', { parent: 'f2' })]);
    const p = countOf(m)!;
    expect(p.groups.map(g => g.state)).toEqual(['now', 'todo']);
    expect(p.you).toEqual([]);
    expect(p.blocked).toEqual([]);
  });
});
