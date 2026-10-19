// The Settings page's pure parts: the model comparison words (lib/compare.ts: each side by engine, model and effort, the
// "cost so far" line), the model choices of "Chat aperte dall'Orchestrator" (lib/models.ts), the spending limit amounts and
// the MCP port (lib/settings-page.ts) and the Ctrl+, shortcut that opens the page (lib/keys.ts).
import { describe, expect, it } from 'vitest';
import type { CompareExperiment } from '@shared/contract';
import { autoLine, costLine, sideName, sidesLine } from '../../src/renderer/lib/compare';
import { resolveShortcut } from '../../src/renderer/lib/keys';
import { MODELS, modelOptions } from '../../src/renderer/lib/models';
import { matchesSettingsSearch, parseUsd, portOf } from '../../src/renderer/lib/settings-page';

const exp = (o: Partial<CompareExperiment> = {}): CompareExperiment => ({
  name: 'x', title: 'X', description: '', on: true, changedAt: null,
  a: { engine: 'cursor', label: 'Cursor' }, b: { engine: 'claude', label: 'Claude', model: 'opus', effort: 'medium' }, judge: { engine: 'kimi', label: 'Kimi', model: 'k2' },
  agents: [], rounds: 4, cost: { a: { usd: 1.84, missing: 1 }, b: { usd: 6.12, missing: 0 } }, ...o,
});

describe('model comparison words', () => {
  it('names each side by its engine, model and effort, nothing hard-coded', () => {
    expect(sideName({ label: 'Claude', model: 'opus', effort: 'medium' })).toBe('Claude opus medium');
    expect(sideName({ label: 'Cursor' })).toBe('Cursor');
    expect(sideName({ label: '', model: null })).toBe('motore non indicato');
    const agents = [{ name: 'sentinel', on: true }, { name: 'scout', on: false }];
    expect(sidesLine(exp({ agents }))).toBe('A: Cursor (Sentinel) · B: Claude opus medium · giudice: Kimi k2');
    expect(sidesLine(exp())).toBe('A: Cursor · B: Claude opus medium · giudice: Kimi k2');
  });
  it('says the cost so far per side, the rounds without a cost, and nothing before the first round', () => {
    expect(costLine(exp())).toBe('Finora 4 confronti · Claude opus medium 6,12 $ · Cursor 1,84 $ (1 confronto senza costo)');
    expect(costLine(exp({ rounds: 1, cost: { a: { usd: null, missing: 1 }, b: { usd: 0.4, missing: 0 } } })))
      .toBe('Finora 1 confronto · Claude opus medium 0,40 $ · Cursor: costo non ancora importato');
    expect(costLine(exp({ rounds: 0 }))).toBeNull();
  });
  it('names the main switch in the user\'s words', () => {
    const agents = [{ name: 'sentinel', on: true }, { name: 'scout', on: false }];
    expect(autoLine(exp({ agents }))).toBe('Opus rifà in automatico il lavoro di Sentinel, Scout di Cursor');
    expect(autoLine(exp({ agents: [{ name: 'scout', on: true }] }))).toBe('Opus rifà in automatico il lavoro di Scout di Cursor');
    expect(autoLine(exp({ b: { engine: 'kimi', label: 'Kimi', model: null, effort: null }, agents: [] }))).toBe('Kimi rifà in automatico il lavoro degli agenti di Cursor');
  });
});

describe('model choices (lib/models.ts)', () => {
  const seen = { cursor: { at: 1, ids: [{ id: 'grok-4.7', name: 'Grok 4.7' }, { id: 'gpt-5', name: '' }] } };
  it('Cursor: the list its CLI offered when there is one, else the built-in list; always the CLI default first', () => {
    expect(modelOptions('cursor', seen).map(m => m.id)).toEqual(['', 'grok-4.7', 'gpt-5']);
    expect(modelOptions('cursor', seen)[2]!.label).toBe('gpt-5');
    expect(modelOptions('cursor', null)).toEqual(MODELS.cursor);
    expect(modelOptions('claude', seen)).toEqual(MODELS.claude);
  });
  it('keeps an id already chosen even when the list does not have it', () => {
    expect(modelOptions('cursor', seen, 'grok-4.7-fast').at(-1)).toEqual({ id: 'grok-4.7-fast', label: 'grok-4.7-fast' });
    expect(modelOptions('cursor', seen, 'grok-4.7')).toHaveLength(3);
  });
});

describe('spending limit amounts and the MCP port (lib/settings-page.ts)', () => {
  it('reads $ amounts like the main process checks them; thousands separators are refused, never read as 1 $', () => {
    expect(parseUsd('')).toBeNull();
    expect(parseUsd(' 50 ')).toBe(50);
    expect(parseUsd('12,5')).toBe(12.5);
    expect(parseUsd('12.34')).toBe(12.34);
    expect(parseUsd('1000000')).toBe(1e6);
    for (const t of ['1.000', '1.000,50', '12,341', '0', '0,00', '-3', '2000000', 'abc', '1e3']) expect(parseUsd(t), t).toBe('bad');
  });
  it('shows the port the MCP server listens on, from its url', () => {
    expect(portOf('http://127.0.0.1:52011/mcp')).toBe('52011');
    expect(portOf(undefined)).toBeNull();
    expect(portOf('nonsense')).toBeNull();
  });
});

describe('Ctrl+, opens the settings', () => {
  const key = (o: Partial<{ key: string; code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }>) =>
    ({ key: '', code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
  it('maps Ctrl+Comma, not a plain comma', () => {
    expect(resolveShortcut(key({ key: ',', code: 'Comma', ctrlKey: true }))).toEqual({ type: 'settings' });
    expect(resolveShortcut(key({ key: ',', code: 'Comma' }))).toBeNull();
  });
});

describe('settings search', () => {
  const section = 'Aspetto Densità Compatta mostra più righe nello stesso spazio.';
  it('finds labels, descriptions and section names without accents or case', () => {
    for (const query of ['DENSITA', 'piu righe', 'aspetto', '  ASPETTO   densita  '])
      expect(matchesSettingsSearch(query, section), query).toBe(true);
    expect(matchesSettingsSearch('densità notifiche', section)).toBe(false);
    expect(matchesSettingsSearch('assente', section)).toBe(false);
  });
  it('restores every section for an empty or whitespace-only query and treats punctuation literally', () => {
    expect(matchesSettingsSearch('', section)).toBe(true);
    expect(matchesSettingsSearch('  ', section)).toBe(true);
    expect(matchesSettingsSearch('[.*', section)).toBe(false);
  });
});
