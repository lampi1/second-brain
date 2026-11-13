// The shared model picker's catalog (src/renderer/lib/model-catalog.ts): the four engines grouped with the current one
// first, each engine's state and default row, a chosen model kept when the engine stops listing it, the search (accents
// ignored, a matching engine keeps every row), the effort a run really gets and the short token sizes.
import { describe, expect, it } from 'vitest';
import type { AgentModelChoice } from '../../src/shared/agents';
import { catalogGroups, findRow, kTokens, realEffort, rowEfforts, searchGroups } from '../../src/renderer/lib/model-catalog';

const choice = (engine: string, over: Partial<AgentModelChoice> = {}): AgentModelChoice => ({
  engine, label: engine[0]!.toUpperCase() + engine.slice(1), enabled: true, trusted: true, effort: false, models: [], source: 'registry',
  installed: true, authenticated: true, defaultModel: true, modelSelectable: true, modelReason: null, ...over,
});
const CHOICES: AgentModelChoice[] = [
  choice('claude', { effort: true, maxContext: true, models: [
    { id: 'claude-opus-5-5', name: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', contextWindow: 1_000_000 },
    { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', efforts: ['low', 'medium', 'high', 'max'], contextWindow: 200_000 },
  ] }),
  choice('cursor', { source: 'observed', models: [{ id: 'gpt-5', name: 'GPT-5' }] }),
  choice('codex', { enabled: false }),
  choice('opencode', { source: 'unknown', modelSelectable: false, modelReason: 'no model flag' }),
];

describe('catalogGroups', () => {
  it('lists the four engines, the current one first, each with its default row first', () => {
    const groups = catalogGroups(CHOICES, { engine: 'cursor', model: null }, 'Predefinito della CLI');
    expect(groups.map(g => g.engine)).toEqual(['cursor', 'claude', 'codex', 'opencode']);
    for (const g of groups) expect(g.rows[0]).toEqual({ engine: g.engine, id: null, name: 'Predefinito della CLI' });
    expect(groups.find(g => g.engine === 'claude')!.rows.map(r => r.id)).toEqual([null, 'claude-opus-5-5', 'claude-sonnet-4-6']);
  });
  it('says why an engine cannot take a model: off, untrusted, or the CLI default only', () => {
    const groups = catalogGroups([...CHOICES, choice('gemini', { trusted: false })], { engine: 'claude', model: null }, 'x');
    const block = Object.fromEntries(groups.map(g => [g.engine, g.block]));
    expect(block).toEqual({ claude: null, cursor: null, codex: 'off', opencode: 'not-selectable', gemini: 'untrusted' });
    expect(groups.find(g => g.engine === 'opencode')!.reason).toBe('no model flag');
  });
  it('carries effort, context window, the source and the engine capabilities', () => {
    const claude = catalogGroups(CHOICES, { engine: 'claude', model: null }, 'x')[0]!;
    expect(claude).toMatchObject({ effort: true, maxContext: true, source: 'registry' });
    expect(claude.models[0]).toMatchObject({ efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', contextWindow: 1_000_000 });
    expect(catalogGroups(CHOICES, { engine: 'claude', model: null }, 'x').find(g => g.engine === 'cursor')).toMatchObject({ effort: false, maxContext: false, source: 'observed' });
  });
  it('keeps the current model as a marked row when the engine no longer lists it, and only on its engine', () => {
    const groups = catalogGroups(CHOICES, { engine: 'claude', model: 'claude-old-1' }, 'x');
    expect(groups[0]!.rows.at(-1)).toEqual({ engine: 'claude', id: 'claude-old-1', name: 'claude-old-1', missing: true });
    expect(groups.find(g => g.engine === 'cursor')!.rows.some(r => r.id === 'claude-old-1')).toBe(false);
    expect(catalogGroups(CHOICES, { engine: 'claude', model: 'claude-opus-5-5' }, 'x')[0]!.rows.filter(r => r.missing)).toEqual([]);
  });
  it('marks a model that only the brain\'s models.json names, «dal registro» (ADR 0267)', () => {
    const groups = catalogGroups([choice('codex', { source: 'observed', models: [{ id: 'gpt-5.5', name: 'GPT-5.5' }, { id: 'gpt-6', name: 'GPT-6', registry: true }] })], { engine: 'codex', model: null }, 'x');
    expect(groups[0]!.models.map(m => [m.id, m.registry ?? false])).toEqual([['gpt-5.5', false], ['gpt-6', true]]);
  });
  it('an empty catalog gives no group (the picker says so)', () => {
    expect(catalogGroups([], { engine: 'claude', model: null }, 'x')).toEqual([]);
  });
});

describe('searchGroups', () => {
  const groups = catalogGroups(CHOICES, { engine: 'claude', model: null }, 'Predefinito');
  it('an empty search keeps everything', () => { expect(searchGroups(groups, '  ')).toHaveLength(4); });
  it('a model match keeps only the matching rows (no default row)', () => {
    const hit = searchGroups(groups, 'sonnet');
    expect(hit.map(g => g.engine)).toEqual(['claude']);
    expect(hit[0]!.rows.map(r => r.id)).toEqual(['claude-sonnet-4-6']);
  });
  it('an engine match keeps the whole engine; ids match too; accents and case are ignored', () => {
    expect(searchGroups(groups, 'CÚRSOR')[0]!.rows.map(r => r.id)).toEqual([null, 'gpt-5']);
    expect(searchGroups(groups, 'opus-5')[0]!.rows.map(r => r.id)).toEqual(['claude-opus-5-5']);
  });
  it('no match gives no group', () => { expect(searchGroups(groups, 'nessuno')).toEqual([]); });
});

describe('effort and sizes', () => {
  const groups = catalogGroups(CHOICES, { engine: 'claude', model: null }, 'x');
  const sonnet = findRow(groups, 'claude', 'claude-sonnet-4-6');
  it('finds a row by engine and id (null = the default row)', () => {
    expect(sonnet?.name).toBe('Sonnet 4.6');
    expect(findRow(groups, 'claude', null)?.id).toBeNull();
    expect(findRow(groups, 'gemini', null)).toBeUndefined();
  });
  it('offers the model\'s own levels, else every level', () => {
    expect(rowEfforts(sonnet, ['low', 'max'])).toEqual(['low', 'medium', 'high', 'max']);
    expect(rowEfforts(findRow(groups, 'claude', null), ['low', 'max'])).toEqual(['low', 'max']);
  });
  it('says what a run really gets: the next lower level, nothing when the model takes none', () => {
    expect(realEffort('xhigh', sonnet)).toBe('high');
    expect(realEffort('max', sonnet)).toBe('max');
    expect(realEffort(null, sonnet)).toBeNull();
    expect(realEffort('high', { engine: 'x', id: 'm', name: 'm', efforts: [] })).toBeNull();
    expect(realEffort('high', undefined)).toBe('high');
  });
  it('writes token sizes short', () => {
    expect(kTokens(200_000)).toBe('200k');
    expect(kTokens(1_000_000)).toBe('1M');
    expect(kTokens(1_500_000)).toBe('1.5M');
  });
});
