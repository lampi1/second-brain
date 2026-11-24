// A role's own page (AgentStudio.tsx, ADR 0347): a work role shows Minimo / Base / Massimo as ordered model chips
// (RoleLevels.tsx), a level without its own list follows Base, the Orchestrator only its Base preset (RolePresetRows);
// no versions, no permissions; the Code Mode switch sits on the page too (RoleCodeMode,
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
const levelsOf = (html: string) => html.slice(html.indexOf('data-testid="role-levels"'));
const [orchestrator, scout, artisan] = profiles as [AgentProfile, AgentProfile, AgentProfile];

describe('the levels on a role\'s page (ADR 0347)', () => {
  it('a work role: Minimo, Base and Massimo as model chips, with what it would start on now', () => {
    const html = levelsOf(page(scout));
    expect(html).toContain('Modelli per livello');
    for (const id of ['min', 'base', 'max']) {
      expect(html).toContain(`data-testid="role-level-${id}"`);
      expect(html).toContain(`data-testid="role-level-${id}-0"`);
      expect(html).toContain(`data-testid="role-level-${id}-now"`);
    }
  });
  it('the Orchestrator: only Base', () => {
    const rows = levelsOf(page(orchestrator));
    expect(rows).toContain('data-testid="st-preset-orchestrator-base"');
    expect(rows).not.toContain('st-preset-orchestrator-min');
    expect(rows).not.toContain('role-level-base-0');
  });
  it('Base\'s first chip is the card\'s own model', () => {
    const html = levelsOf(page(scout));
    const chip = html.slice(html.indexOf('data-testid="role-level-base-0"') - 400, html.indexOf('data-testid="role-level-base-0"'));
    expect(html.slice(html.indexOf('data-testid="role-level-base"'))).toMatch(/rl-model[^>]*>Mid</);
    expect(chip).toBeTruthy();
  });
  it('a level without its own list says it uses Base\'s models', () => {
    const html = levelsOf(page(scout));
    const min = html.slice(html.indexOf('data-testid="role-level-min"'), html.indexOf('data-testid="role-level-base"'));
    expect(min).toContain('Vuoto: usa i modelli di Base.');
    const max = html.slice(html.indexOf('data-testid="role-level-max"'));
    expect(max).not.toContain('Vuoto: usa i modelli di Base.');
  });
  it('no versions and no permissions on the page', () => {
    const html = page(scout);
    expect(html).not.toContain('role-permissions');
    expect(html).not.toMatch(/Versione \d/);
  });
  it('Code Mode on the card: the switch on a work role, «parziale» named only off full parity, never on the Orchestrator', () => {
    const claudeCard = page(scout);
    expect(claudeCard).toContain('data-testid="agent-code-mode"');
    expect(claudeCard).not.toContain('Su questo motore è parziale');
    expect(page(artisan)).toContain('Su questo motore è parziale');
    expect(page(orchestrator)).not.toContain('data-testid="agent-code-mode"');
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
