// Several models per level across engines (ADR 0347): the stored shape is checked, a card without lists reads as its
// presets, the room of a plan (spent, on pace to run out, fine, unknown) and the pick in the user's order.
import { describe, expect, it } from 'vitest';
import { checkedLevels, headPresets, levelEngines, levelNamed, levelsOf, pickInLevel, roomOf, type LevelModel, type Room } from '../../../src/shared/model-levels';
import type { HarnessUsage } from '../../../src/shared/contract';

const H = 3600e3, NOW = 1_000 * H;
const usage = (windows: HarnessUsage['windows'], status: HarnessUsage['status'] = 'ok'): HarnessUsage =>
  ({ harness: 'claude', label: 'Claude', status, planLabel: null, accountEmail: null, windows, message: null, source: 'oauth', at: NOW });

describe('checkedLevels', () => {
  it('keeps the three levels in order and drops empty ones', () => {
    expect(checkedLevels({ base: [{ engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' }, { engine: 'cursor', model: null }], min: [] }))
      .toEqual({ base: [{ engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' }, { engine: 'cursor', model: null }] });
    expect(checkedLevels({})).toBeUndefined();
    expect(checkedLevels(null)).toBeUndefined();
  });
  it('refuses another level, a bad engine, a bad effort and a duplicate', () => {
    expect(() => checkedLevels({ top: [] })).toThrow(/non è un livello/);
    expect(() => checkedLevels({ base: [{ engine: 'Claude!', model: null }] })).toThrow(/motore/);
    expect(() => checkedLevels({ base: [{ engine: 'claude', model: 'x', effort: 'huge' }] })).toThrow(/effort/);
    expect(() => checkedLevels({ base: [{ engine: 'claude', model: 'x' }, { engine: 'claude', model: 'x' }] })).toThrow(/già nella lista/);
  });
});

describe('levelsOf', () => {
  const presets = { min: { model: 'h' }, base: { model: 's', effort: 'medium' as const }, max: { model: 'o' } };
  it('a card without lists reads as its presets on its engine', () => {
    const l = levelsOf({ engine: 'claude' }, presets);
    expect(l.base).toEqual([{ engine: 'claude', model: 's', effort: 'medium' }]);
    expect(headPresets(l)).toEqual(presets);
  });
  it('its own lists win; a level it has none for keeps its preset', () => {
    const l = levelsOf({ engine: 'claude', levels: { max: [{ engine: 'codex', model: 'gpt' }, { engine: 'claude', model: 'o' }] } }, presets);
    expect(l.max.map(x => x.engine)).toEqual(['codex', 'claude']);
    expect(l.min).toEqual([{ engine: 'claude', model: 'h' }]);
    expect(levelEngines(l)).toEqual(['claude', 'codex']);
    expect(levelNamed(l, 'gpt')).toEqual({ preset: 'max', at: { engine: 'codex', model: 'gpt' } });
    expect(levelNamed(l, 'gpt', 'claude')).toBeNull();
  });
});

describe('roomOf', () => {
  it('a window at 98% or more is spent', () => {
    expect(roomOf(usage([{ kind: 'five-hour', label: '5h', usedPercent: 99, resetsAt: NOW + H }]), null, NOW).state).toBe('out');
  });
  it('a limit the app saw hit is spent until it renews', () => {
    expect(roomOf(undefined, { until: NOW + H }, NOW).state).toBe('out');
    expect(roomOf(undefined, { until: NOW - 1 }, NOW).state).toBe('unknown');
  });
  it('86% of 5 hours with 2 hours left runs out before it renews: pace', () => {
    expect(roomOf(usage([{ kind: 'five-hour', label: '5h', usedPercent: 86, resetsAt: NOW + 2 * H }]), null, NOW).state).toBe('pace');
  });
  it('37% of the week is fine, and so is a window used under half', () => {
    expect(roomOf(usage([{ kind: 'weekly', label: '7g', usedPercent: 37, resetsAt: NOW + 6 * 24 * H }]), null, NOW).state).toBe('ok');
    expect(roomOf(usage([{ kind: 'five-hour', label: '5h', usedPercent: 45, resetsAt: NOW + 4.5 * H }]), null, NOW).state).toBe('ok');
  });
  it('no reading, or a model-scoped window only, says nothing', () => {
    expect(roomOf(usage([], 'unavailable'), null, NOW).state).toBe('unknown');
    expect(roomOf(usage([{ kind: 'weekly', label: '7g · Sonnet', usedPercent: 99, resetsAt: NOW + H, model: 'sonnet' }]), null, NOW).state).toBe('ok');
  });
});

describe('roomOf with the user\'s threshold (ADR 0355)', () => {
  const at = (pct: number) => usage([{ kind: 'weekly', label: '7g', usedPercent: pct, resetsAt: NOW + 10 * H }]);
  it('past it the plan is over, before its credits end; spent stays spent', () => {
    expect(roomOf(at(79), null, NOW, 80).state).toBe('ok');
    expect(roomOf(at(80), null, NOW, 80)).toMatchObject({ state: 'over', why: '7g al 80%, soglia 80%' });
    expect(roomOf(at(99), null, NOW, 80).state).toBe('out');
    expect(roomOf(at(95), null, NOW).state).not.toBe('over');
  });
});

describe('pickInLevel', () => {
  const list: LevelModel[] = [{ engine: 'claude', model: 'sonnet' }, { engine: 'antigravity', model: 'gemini' }, { engine: 'opencode', model: 'gpt' }];
  const room = (states: Record<string, Room['state']>) => (x: LevelModel): Room => ({ state: states[x.engine] ?? 'ok', why: states[x.engine] ?? '', resetsAt: null });
  it('the first with room, in the list\'s order; the reason says so', () => {
    expect(pickInLevel(list, () => null, room({}))).toMatchObject({ chosen: { engine: 'claude' }, reason: 'claude sonnet: primo disponibile' });
  });
  it('skips a plan on pace or spent while another has room, and says why', () => {
    expect(pickInLevel(list, () => null, room({ claude: 'pace' }))).toMatchObject({ chosen: { engine: 'antigravity' }, reason: 'antigravity gemini: claude sta per finire il limite' });
    expect(pickInLevel(list, () => null, room({ claude: 'out' })).reason).toBe('antigravity gemini: claude al limite');
  });
  it('an engine that is off is never picked', () => {
    expect(pickInLevel(list, x => x.engine === 'claude' ? 'spento' : null, room({})).chosen?.engine).toBe('antigravity');
    expect(pickInLevel(list, () => 'spento', room({}))).toMatchObject({ chosen: null, reason: 'claude spento, antigravity spento, opencode spento' });
  });
  it('all on pace: the first on pace; all spent: nothing starts, and it says so', () => {
    expect(pickInLevel(list, () => null, room({ claude: 'out', antigravity: 'pace', opencode: 'pace' })).chosen?.engine).toBe('antigravity');
    expect(pickInLevel(list, () => null, room({ claude: 'out', antigravity: 'out', opencode: 'out' }))).toMatchObject({ chosen: null, reason: 'claude al limite, antigravity al limite, opencode al limite' });
  });
  it('the engine order comes before the list\'s; a plan on pace is no reason to skip it', () => {
    const order = ['opencode', 'antigravity', 'claude'];
    expect(pickInLevel(list, () => null, room({}), { order }).chosen?.engine).toBe('opencode');
    expect(pickInLevel(list, () => null, room({ opencode: 'pace' }), { order }).chosen?.engine).toBe('opencode');
    expect(pickInLevel(list, x => x.engine === 'antigravity' ? 'non collegato' : null, room({ opencode: 'out' }), { order })).toMatchObject({ chosen: { engine: 'claude' }, reason: 'claude sonnet: opencode al limite, antigravity non collegato' });
    // an engine the order does not name comes after the named ones
    expect(pickInLevel(list, () => null, room({}), { order: ['antigravity'] }).chosen?.engine).toBe('antigravity');
  });
  it('past the threshold the next one starts; all past it: the first, and it says so', () => {
    const order = ['opencode', 'antigravity', 'claude'];
    expect(pickInLevel(list, () => null, room({ opencode: 'over' }), { order })).toMatchObject({ chosen: { engine: 'antigravity' }, reason: 'antigravity gemini: opencode oltre la soglia' });
    expect(pickInLevel(list, () => null, room({ opencode: 'over', antigravity: 'over', claude: 'over' }), { order })).toMatchObject({ chosen: { engine: 'opencode' }, reason: 'opencode gpt: oltre la soglia, ma nessun altro è libero' });
  });
});
