// Per-task model presets (shared/model-presets.ts, ADR 0336): each guard of a delegation's preset (only the three,
// missing = Base, not Base without a reason = Base with a warning, never priced above the delegator's own model, an
// unknown price said), the old `tier` read as a preset, the card's presets defaulting to its Base (the migration), the
// stored shape and its order by price, and the per-run record read back.
import { describe, expect, it } from 'vitest';
import { cardPresets, checkedPresets, choosePreset, presetAskOf, presetNamed, presetOfTier, presetOrderProblem, presetsUpTo, readRunPreset, runPresetOf, type FullPresets } from '../../../src/shared/model-presets';

const PRICE: Record<string, number> = { light: 1, mid: 5, top: 20, gpt: 4 };
const price = (m: string) => PRICE[m] ?? null;
const P: FullPresets = { min: { model: 'light', effort: 'low' }, base: { model: 'mid' }, max: { model: 'top', effort: 'high' } };

describe('cardPresets (the migration: an old card is Base only)', () => {
  it('Base is the card\'s model and effort, else its tier\'s model; Minimo and Massimo default to the Base', () => {
    expect(cardPresets({ model: 'mid', effort: 'medium' })).toEqual({ min: { model: 'mid', effort: 'medium' }, base: { model: 'mid', effort: 'medium' }, max: { model: 'mid', effort: 'medium' } });
    expect(cardPresets({ model: null }, 'tier-model').base).toEqual({ model: 'tier-model' });
    expect(cardPresets({ model: 'mid', presets: { max: { model: 'top', effort: 'high' } } })).toEqual({ min: { model: 'mid' }, base: { model: 'mid' }, max: { model: 'top', effort: 'high' } });
  });
});

describe('checkedPresets and presetOrderProblem (saving a card)', () => {
  it('only min and max, each a model and an optional effort; empty = none', () => {
    expect(checkedPresets(undefined)).toBeUndefined();
    expect(checkedPresets({})).toBeUndefined();
    expect(checkedPresets({ min: { model: 'light', effort: 'low' } })).toEqual({ min: { model: 'light', effort: 'low' } });
    expect(() => checkedPresets({ base: { model: 'x' } })).toThrow(/non è un preset/);
    expect(() => checkedPresets({ min: { model: 'a b' } })).toThrow(/Preset min/);
    expect(() => checkedPresets({ max: { model: 'top', effort: 'huge' } })).toThrow(/effort non valido/);
    expect(() => checkedPresets([])).toThrow();
  });
  it('Minimo <= Base <= Massimo by price, unknown prices not judged', () => {
    expect(presetOrderProblem(P, price)).toBeNull();
    expect(presetOrderProblem({ ...P, min: { model: 'top' } }, price)).toMatch(/Minimo costa più del Base/);
    expect(presetOrderProblem({ ...P, max: { model: 'light' } }, price)).toMatch(/Massimo costa meno del Base/);
    expect(presetOrderProblem({ ...P, max: { model: 'unknown' } }, price)).toBeNull();
  });
});

describe('presetAskOf (the tool fields)', () => {
  it('only the three presets, presetWhy one line, taskKind a short label', () => {
    expect(presetAskOf({ preset: 'max', presetWhy: ' migrazione delicata ', taskKind: 'migration' })).toEqual({ preset: 'max', presetWhy: 'migrazione delicata', taskKind: 'migration' });
    expect(presetAskOf({})).toEqual({});
    expect(() => presetAskOf({ preset: 'huge' }, 'tasks[0]')).toThrow(/^tasks\[0\]\.preset: one of min \| base \| max/);
    expect(() => presetAskOf({ presetWhy: 'a\nb' })).toThrow(/presetWhy: one line/);
    expect(() => presetAskOf({ taskKind: 'x'.repeat(61) })).toThrow(/taskKind: one line, at most 60/);
  });
  it('the old tier is a preset relative to the card\'s tier; both together are refused', () => {
    expect(presetOfTier('light', 'mid')).toBe('min');
    expect(presetOfTier('mid', 'mid')).toBe('base');
    expect(presetOfTier('top', 'mid')).toBe('max');
    expect(presetAskOf({}, '', { tier: 'top', card: 'mid' })).toEqual({ preset: 'max' });
    expect(() => presetAskOf({ preset: 'min' }, '', { tier: 'top', card: 'mid' })).toThrow(/pass only preset/);
    expect(() => presetAskOf({}, '', { tier: 'huge', card: 'mid' })).toThrow(/light \| mid \| top/);
  });
});

describe('choosePreset (the guards)', () => {
  it('missing preset = Base, no warning', () => {
    expect(choosePreset({ presets: P, ask: {}, price })).toEqual({ preset: 'base', model: 'mid', warnings: [] });
  });
  it('not Base without presetWhy = Base and a warning', () => {
    const c = choosePreset({ presets: P, ask: { preset: 'max' }, price });
    expect(c).toMatchObject({ preset: 'base', model: 'mid', asked: 'max' });
    expect(c.warnings[0]).toMatch(/without presetWhy: base used/);
    expect(choosePreset({ presets: P, ask: { preset: 'min' }, price }).preset).toBe('base');
  });
  it('with a reason: the preset asked, its effort and the record fields', () => {
    expect(choosePreset({ presets: P, ask: { preset: 'max', presetWhy: 'x', taskKind: 'review' }, delegator: { role: 'orchestrator', model: 'top' }, price }))
      .toEqual({ preset: 'max', model: 'top', effort: 'high', presetWhy: 'x', taskKind: 'review', delegatorRole: 'orchestrator', warnings: [] });
  });
  it('ceiling: never priced above the delegator\'s own model; the highest preset that is not, said in a warning', () => {
    const c = choosePreset({ presets: P, ask: { preset: 'max', presetWhy: 'x' }, delegator: { model: 'mid' }, price });
    expect(c).toMatchObject({ preset: 'base', model: 'mid', asked: 'max' });
    expect(c.warnings[0]).toMatch(/costs more than your own model mid: base used/);
    // across engines: one price table (a Codex delegator at 4 cannot start a Claude Base at 5)
    expect(choosePreset({ presets: P, ask: { preset: 'max', presetWhy: 'x' }, delegator: { model: 'gpt' }, price })).toMatchObject({ preset: 'min', model: 'light' });
    // nothing fits: Minimo, the cheapest
    expect(choosePreset({ presets: P, ask: {}, delegator: { model: 'cheap' }, price: m => (m === 'cheap' ? 0.1 : price(m)) }).warnings[0]).toMatch(/min \(the cheapest\)/);
    // equal price fits
    expect(choosePreset({ presets: P, ask: { preset: 'max', presetWhy: 'x' }, delegator: { model: 'top' }, price }).preset).toBe('max');
  });
  it('an unknown price is not capped, and said when it matters', () => {
    expect(choosePreset({ presets: P, ask: { preset: 'max', presetWhy: 'x' }, delegator: { model: null }, price }).warnings[0]).toMatch(/no known price, the ceiling was not checked/);
    const odd: FullPresets = { ...P, max: { model: 'new-model' } };
    const c = choosePreset({ presets: odd, ask: { preset: 'max', presetWhy: 'x' }, delegator: { model: 'mid' }, price });
    expect(c.preset).toBe('max');
    expect(c.warnings[0]).toMatch(/new-model has no price/);
  });
});

describe('presetsUpTo, presetNamed and the run record', () => {
  it('picks come from Minimo up to the preset chosen; a model names its preset', () => {
    expect(presetsUpTo('min')).toEqual(['min']);
    expect(presetsUpTo('max')).toEqual(['min', 'base', 'max']);
    expect(presetNamed(P, 'top', undefined)).toBe('max');
    expect(presetNamed(P, 'top', undefined, ['min', 'base'])).toBeNull();
    const same: FullPresets = { min: { model: 'mid', effort: 'low' }, base: { model: 'mid' }, max: { model: 'mid', effort: 'high' } };
    expect(presetNamed(same, 'mid', 'high')).toBe('max');
    expect(presetNamed(same, 'mid', undefined)).toBe('min');
  });
  it('the run keeps preset, effort, asked, why, kind and delegator; a malformed record is dropped', () => {
    const c = choosePreset({ presets: P, ask: { preset: 'max', presetWhy: 'x', taskKind: 'review' }, delegator: { role: 'scout', model: 'mid' }, price });
    const rec = runPresetOf(c);
    expect(rec).toEqual({ preset: 'base', asked: 'max', presetWhy: 'x', taskKind: 'review', delegatorRole: 'scout' });
    expect(readRunPreset(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
    expect(readRunPreset({ preset: 'huge' })).toBeUndefined();
    expect(readRunPreset({ preset: 'min', effort: 'loud' })).toBeUndefined();
    expect(readRunPreset(null)).toBeUndefined();
  });
});

describe('choosePreset: an explicit Minimo above the ceiling', () => {
  it('warns that even the cheapest preset costs more than the delegator\'s own model', () => {
    const c = choosePreset({ presets: P, ask: { preset: 'min', presetWhy: 'lettura' }, delegator: { model: 'cheap' }, price: m => m === 'cheap' ? 0.5 : price(m) });
    expect(c.preset).toBe('min');
    expect(c.warnings.join(' ')).toMatch(/preset min \(light\) costs more than your own model cheap/);
  });
});
