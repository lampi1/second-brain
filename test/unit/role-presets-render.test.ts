// A role's «Modelli per compito» rows (components/RolePresets.tsx RolePresetRows, ADR 0336; on the role's own page
// only since 2026-11-23): the role's engine once and the rows Minimo / Base / Massimo with a model and an effort; empty
// Minimo / Massimo read as Base; an engine without a model choice says so; a pick changes only Base's card fields or
// only that preset.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentProfile } from '../../src/shared/agents';
const claude = { engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, modelSelectable: true, models: [{ id: 'm-low', name: 'Low' }, { id: 'm-mid', name: 'Mid' }, { id: 'm-top', name: 'Top', efforts: ['low', 'high'] }] };
const cursor = { engine: 'cursor', label: 'Cursor', enabled: true, trusted: true, effort: false, modelSelectable: false, models: [] };
const profiles: Partial<AgentProfile>[] = [
  { id: 'scout', name: 'Scout', engine: 'claude', model: 'm-mid', effort: 'medium', presets: { max: { model: 'm-top', effort: 'high' } } },
  { id: 'herald', name: 'Herald', engine: 'cursor', model: null },
];
vi.mock('../../src/renderer/store/agents', () => ({ useAgents: () => ({ catalog: { profiles, models: [claude, cursor] } }), saveAgent: vi.fn() }));
import { RolePresetRows, presetChange } from '../../src/renderer/components/RolePresets';
import { setLang } from '../../src/renderer/i18n';

afterEach(() => setLang('it'));
const render = (p: Partial<AgentProfile>) => renderToStaticMarkup(createElement(RolePresetRows, { profile: p as AgentProfile }));

describe('Modelli per compito rows', () => {
  it('the engine once, three rows', () => {
    const html = render(profiles[0]!);
    expect(html).toContain('data-testid="st-presets-scout"');
    expect(html.match(/data-testid="st-presets-engine-scout"/g)).toHaveLength(1);
    expect(html).toContain('>Claude<');
    for (const id of ['min', 'base', 'max']) expect(html).toContain(`data-testid="st-preset-scout-${id}"`);
    expect(html).toContain('Minimo'); expect(html).toContain('Base'); expect(html).toContain('Massimo');
  });
  it('an engine without a model choice says Base only', () => {
    expect(render(profiles[1]!)).toContain('Questo motore non applica una scelta di modello: solo Base.');
  });
  it('English labels', () => {
    setLang('en');
    expect(render(profiles[0]!)).toContain('Minimum');
  });
});

describe('presetChange', () => {
  const scout = profiles[0] as AgentProfile;
  it('Base changes the card\'s model and effort only', () => {
    expect(presetChange(scout, 'base', 'm-low', 'low')).toEqual({ model: 'm-low', effort: 'low' });
    expect(presetChange(scout, 'base', '', '')).toEqual({ model: null, effort: null });
  });
  it('Minimo / Massimo change only their preset; empty drops it, the last one leaves {}', () => {
    expect(presetChange(scout, 'min', 'm-low', 'low')).toEqual({ presets: { min: { model: 'm-low', effort: 'low' }, max: { model: 'm-top', effort: 'high' } } });
    expect(presetChange(scout, 'max', '', '')).toEqual({ presets: {} });
    expect(presetChange(scout, 'max', 'm-top', 'nonsense')).toEqual({ presets: { max: { model: 'm-top' } } });
  });
});
