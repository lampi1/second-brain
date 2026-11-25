// Several models per level across engines (ADR 0347): the stored shape is checked, a card without lists reads as its
// presets, a verdict of the one credit rule as a level's room (ADR 0354) and the pick in the user's order.
import { describe, expect, it } from 'vitest';
import { creditVerdict } from '../../../src/shared/credit-rule';
import { pastThreshold } from '../../../src/shared/engine-order';
import { checkedLevels, headPresets, levelEngines, levelNamed, levelsOf, pickInLevel, roomOf, type LevelModel, type Room } from '../../../src/shared/model-levels';

const H = 3600e3, NOW = 1_000 * H;

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
  it('maps the one rule\'s verdict to a level\'s room (no rule of its own)', () => {
    expect(roomOf({ state: 'free', why: '5h al 3%', source: 'reading', until: null, readingAt: NOW })).toEqual({ state: 'ok', why: '5h al 3%', resetsAt: null, source: 'reading', readingAt: NOW });
    expect(roomOf({ state: 'out', why: 'x', source: 'error', until: NOW + H, readingAt: null }).resetsAt).toBe(NOW + H);
  });
});

describe('roomOf with the user\'s threshold (ADR 0358)', () => {
  const at = (pct: number, threshold: number | null = 80): Room => {
    const reading = { at: NOW, ok: true, pool: 'codex', account: null, windows: [{ kind: 'weekly' as const, label: '7g', usedPercent: pct, resetsAt: NOW + 10 * H }] };
    return roomOf(creditVerdict({ pool: 'codex', reading, error: null, workedFrom: null }, NOW), pastThreshold(reading, null, threshold, NOW));
  };
  it('past it the plan is over, before its credits end; spent stays spent', () => {
    expect(at(79).state).toBe('ok');
    expect(at(80)).toMatchObject({ state: 'over', why: '7g al 80%, soglia 80%' });
    expect(at(99).state).toBe('out');
    expect(at(95, null).state).not.toBe('over');
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
    expect(pickInLevel(list, () => null, room({ claude: 'out' }))?.reason).toBe('antigravity gemini: claude al limite');
    expect(pickInLevel(list, () => null, room({ claude: 'pace' }))!.skipped).toEqual([expect.objectContaining({ engine: 'claude', kind: 'credit', state: 'pace' })]);
  });
  it('an engine that is off is never picked', () => {
    expect(pickInLevel(list, x => x.engine === 'claude' ? 'spento' : null, room({}))?.chosen.engine).toBe('antigravity');
    expect(pickInLevel(list, () => 'spento', room({}))).toBeNull();
  });
  it('all on pace: the first on pace; all spent: the first, and it says so', () => {
    expect(pickInLevel(list, () => null, room({ claude: 'out', antigravity: 'pace', opencode: 'pace' }))?.chosen.engine).toBe('antigravity');
    const all = pickInLevel(list, () => null, room({ claude: 'out', antigravity: 'out', opencode: 'out' }))!;
    expect(all.chosen.engine).toBe('claude');
    expect(all.reason).toContain('tutti i motori del livello sono al limite');
    expect(all.allOut).toBe(true);
  });
  it('the engine order comes before the list\'s; a plan on pace is no reason to skip it', () => {
    const order = ['opencode', 'antigravity', 'claude'];
    expect(pickInLevel(list, () => null, room({}), { order })?.chosen.engine).toBe('opencode');
    expect(pickInLevel(list, () => null, room({ opencode: 'pace' }), { order })?.chosen.engine).toBe('opencode');
    expect(pickInLevel(list, x => x.engine === 'antigravity' ? 'non collegato' : null, room({ opencode: 'out' }), { order })).toMatchObject({ chosen: { engine: 'claude' }, reason: 'claude sonnet: opencode al limite, antigravity non collegato' });
    // an engine the order does not name comes after the named ones
    expect(pickInLevel(list, () => null, room({}), { order: ['antigravity'] })?.chosen.engine).toBe('antigravity');
  });
  it('past the threshold the next one starts; all past it: the first, and it says so', () => {
    const order = ['opencode', 'antigravity', 'claude'];
    expect(pickInLevel(list, () => null, room({ opencode: 'over' }), { order })).toMatchObject({ chosen: { engine: 'antigravity' }, reason: 'antigravity gemini: opencode oltre la soglia' });
    expect(pickInLevel(list, () => null, room({ opencode: 'over', antigravity: 'over', claude: 'over' }), { order })).toMatchObject({ chosen: { engine: 'opencode' }, reason: 'opencode gpt: oltre la soglia, ma nessun altro è libero' });
  });
});
