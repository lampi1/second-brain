// Unit tests of the words under a plan's steps on the map (ADR 0307, PlanFlow.tsx): when a step starts (first, after
// which steps, together with which) and how far it is (to do, under way since, done in so long, blocked); and of the
// full screen the maps take when the user opens them, not when the Orchestrator does (actions.ts openMaps).
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
import type { MapFlowStep } from '../../src/shared/project-map';
import { stateOf, whenOf } from '../../src/renderer/components/project-map/PlanFlow';
import { openMaps, uiCommand } from '../../src/renderer/actions';
import { setMapsFull, ui } from '../../src/renderer/store/ui';

const flow: MapFlowStep[] = [
  { step: 1, title: 'a', state: 'done', wave: 1, startedAt: 60_000, endedAt: 6 * 60_000 },
  { step: 2, title: 'b', state: 'now', wave: 2, par: true, startedAt: 6 * 60_000 },
  { step: 3, title: 'c', state: 'todo', wave: 2, par: true },
  { step: 4, title: 'd', state: 'todo', wave: 2, par: true },
  { step: 5, title: 'e', state: 'blocked', wave: 3 },
];

describe('a step in words', () => {
  it('says when it starts', () => {
    expect(whenOf(flow[0]!, flow)).toBe('Parte per primo.');
    expect(whenOf(flow[1]!, flow)).toBe('Parte quando è finito il passo 1. Va insieme ai passi 3, 4.');
    expect(whenOf(flow[4]!, flow)).toBe('Parte quando sono finiti i passi 2, 3, 4.');
    expect(whenOf(flow[1]!, flow.slice(0, 3))).toBe('Parte quando è finito il passo 1. Va insieme al passo 3.');
  });
  it('says how far it is', () => {
    expect(stateOf(flow[0]!, 10 * 60_000)).toBe('fatto in 5 min');
    expect(stateOf({ ...flow[0]!, endedAt: undefined }, 0)).toBe('fatto');
    expect(stateOf(flow[1]!, 16 * 60_000)).toBe('in corso da 10 min');
    expect(stateOf({ step: 2, title: 'b', state: 'now', wave: 2 }, 0)).toBe('in corso');
    expect(stateOf(flow[2]!, 0)).toBe('da fare');
    expect(stateOf(flow[4]!, 0)).toBe('bloccato');
  });
});

describe('the maps open full screen for the user', () => {
  beforeEach(() => setMapsFull(false));
  it('from the button, the shortcut and the palette: full; from the Orchestrator: beside its column', () => {
    openMaps();
    expect(ui.get().mapsFull).toBe(true);
    expect(ui.get().page).toBe('collegamenti');
    uiCommand({ action: 'maps', value: 'shop/web' });
    expect(ui.get().mapsFull).toBe(false);
  });
});
