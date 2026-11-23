// A role's own page edits its presets (AgentStudio.tsx → RolePresets.tsx RolePresetRows, owner 2026-11-23: only there,
// Impostazioni has no model control): a work role shows Minimo / Base / Massimo in its Configurazione card, the
// Orchestrator only Base (Base is the card's model and effort); the Code Mode switch sits on the card too (RoleCodeMode,
// never on the Orchestrator, «parziale» named on an engine without full parity); a save on the page offers Annulla,
// which puts back the card's model, effort and presets as they were.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProfile } from '../../../src/shared/agents';
const claude = { engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, modelSelectable: true, codeMode: 'full', models:[{ id: 'm-low', name: 'Low' }, { id: 'm-mid', name: 'Mid' }, { id: 'm-top', name: 'Top', efforts: ['low', 'high'] }] };
const codex = { engine: 'codex', label: 'Codex', enabled: true, trusted: true, effort: true, modelSelectable: true, codeMode: 'partial', models: [{ id: 'gpt-x', name: 'GPT X' }] };
const base = { purpose: '', avatar: 'scout', instructions: 'Find things.', tools: null, permissionCeiling: null, tier: 'mid', tierMax: 'top', launches: [], skills: [], version: 3, activeVersion: 3, updatedAt: 0, userLocked: false };
const profiles = [
  { ...base, id: 'orchestrator', name: 'Orchestrator', engine: 'claude', model: 'm-top', effort: 'high' },
  { ...base, id: 'scout', name: 'Scout', engine: 'claude', model: 'm-mid', effort: 'medium', presets: { max: { model: 'm-top', effort: 'high' } }, codeMode: true },
  { ...base, id: 'artisan', name: 'Artisan', engine: 'codex', model: 'gpt-x' },
] as unknown as AgentProfile[];
const saveAgent = vi.fn(async () => ({}));
const toast = vi.fn();
vi.mock('../../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(async () => null), on: vi.fn(() => () => {}) } }));
vi.mock('../../../src/renderer/store/agents', () => ({
  useAgents: () => ({ catalog: { profiles, models: [claude, codex] }, metrics: {} }),
  saveAgent: (...a: unknown[]) => saveAgent(...(a as [])), agentHistory: vi.fn(async () => []), refreshAgents: vi.fn(), resetAgent: vi.fn(), restoreAgentVersion: vi.fn(),
}));
vi.mock('../../../src/renderer/store/ui', async orig => ({ ...(await orig<object>()), toast: (...a: unknown[]) => toast(...(a as [])) }));
import { AgentStudio } from '../../../src/renderer/components/AgentStudio';
import { presetUndo, savePreset } from '../../../src/renderer/components/RolePresets';
import { setLang } from '../../../src/renderer/i18n';

beforeEach(() => { saveAgent.mockClear(); toast.mockClear(); });
afterEach(() => setLang('it'));
const page = (p: AgentProfile) => renderToStaticMarkup(createElement(AgentStudio, { profile: p }));
const presetsOf = (html: string) => html.slice(html.indexOf('data-testid="agent-presets"'));
const [orchestrator, scout, artisan] = profiles as [AgentProfile, AgentProfile, AgentProfile];

describe('the presets on a role\'s page', () => {
  it('a work role: Minimo, Base and Massimo in its Configurazione card, with model and effort each', () => {
    const html = page(scout);
    expect(html).toContain('data-testid="agent-presets"');
    const rows = presetsOf(html);
    for (const id of ['min', 'base', 'max']) {
      expect(rows).toContain(`data-testid="st-preset-scout-${id}"`);
      expect(rows).toContain(`data-testid="st-preset-model-scout-${id}"`);
      expect(rows).toContain(`data-testid="st-preset-effort-scout-${id}"`);
    }
    expect(rows).toContain('Modelli per compito');
  });
  it('the Orchestrator: only Base', () => {
    const rows = presetsOf(page(orchestrator));
    expect(rows).toContain('data-testid="st-preset-orchestrator-base"');
    expect(rows).not.toContain('st-preset-orchestrator-min');
    expect(rows).not.toContain('st-preset-orchestrator-max');
    expect(rows).toContain('solo Base');
  });
  it('Base shows the card\'s own model and effort', () => {
    const card = presetsOf(page(scout));
    const baseRow = card.slice(card.indexOf('data-testid="st-preset-scout-base"'), card.indexOf('data-testid="st-preset-scout-max"'));
    expect(baseRow).toMatch(/data-value="m-mid" data-testid="st-preset-model-scout-base"/);
    expect(baseRow).toMatch(/data-value="medium" data-testid="st-preset-effort-scout-base"/);
  });
  it('Code Mode on the card: the switch on a work role, «parziale» named only off full parity, never on the Orchestrator', () => {
    const claudeCard = page(scout);
    expect(claudeCard).toContain('data-testid="agent-code-mode"');
    expect(claudeCard).not.toContain('Su questo motore è parziale');
    expect(page(artisan)).toContain('Su questo motore è parziale');
    expect(page(orchestrator)).not.toContain('data-testid="agent-code-mode"');
  });
  it('Minimo without a model reads as Base and its effort stays off until a model is picked', () => {
    const rows = presetsOf(page(scout));
    const min = rows.slice(rows.indexOf('data-testid="st-preset-scout-min"'), rows.indexOf('data-testid="st-preset-scout-base"'));
    expect(min).toContain('Come Base');
    expect(min).toMatch(/<button[^>]*disabled=""[^>]*data-testid="st-preset-effort-scout-min"/);
  });
});

describe('savePreset and Annulla', () => {
  it('a Base pick saves the card\'s model and effort; on the page a toast offers Annulla', async () => {
    await savePreset(scout, 'base', 'm-top', 'high', true);
    expect(saveAgent).toHaveBeenCalledWith(expect.objectContaining({ model: 'm-top', effort: 'high' }), 'scout');
    expect(toast).toHaveBeenCalledTimes(1);
    const [text, tone, action] = toast.mock.calls[0] as unknown as [string, string, { label: string; run: () => void }];
    expect(text).toBe('Base salvato.'); expect(tone).toBe('ok'); expect(action.label).toBe('Annulla');
    action.run();
    expect(saveAgent).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'm-mid', effort: 'medium', presets: { max: { model: 'm-top', effort: 'high' } } }), 'scout');
  });
  it('Impostazioni saves without a toast', async () => {
    await savePreset(scout, 'min', 'm-low', '', false);
    expect(saveAgent).toHaveBeenCalledWith(expect.objectContaining({ presets: { min: { model: 'm-low' }, max: { model: 'm-top', effort: 'high' } } }), 'scout');
    expect(toast).not.toHaveBeenCalled();
  });
  it('the undo draft clears what the card did not have: null model and effort, {} presets', () => {
    const bare = { ...scout, model: null, effort: undefined, presets: undefined } as unknown as AgentProfile;
    expect(presetUndo(bare)).toMatchObject({ model: null, effort: null, presets: {} });
  });
});
