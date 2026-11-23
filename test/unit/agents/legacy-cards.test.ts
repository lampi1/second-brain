// The one-off move of the retired model Settings onto the role cards (agents/legacy-cards.ts, 2026-11-23): config.json's
// old keys are captured beside it and dropped (brain/config.ts), then the cards take them once (catalog.migrateLegacy):
// a card with no model gets the model its tier resolved to, the global Code Mode goes to every work role, the
// Orchestrator's «Chat aperte dall'Orchestrator» model and effort go to its card; a second start moves nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { hasLegacyKeys, legacyOf, markLegacyDone, migratedCards, readLegacy, writeLegacy, type LegacyModelSettings } from '../../../src/main/agents/legacy-cards';
import { ConfigStore } from '../../../src/main/brain/config';
import type { AgentModelChoice, AgentProfile } from '../../../src/shared/agents';
import type { Harness } from '../../../src/shared/contract';
import type { ModelTier } from '../../../src/shared/roles';
import type { ModelTiers } from '../../../src/main/agents/model-tier';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-legacy-')); roots.push(d); return d; };
const models = (): AgentModelChoice[] => [
  { engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: true, authenticated: true },
  { engine: 'cursor', label: 'Cursor', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: true, authenticated: true }];
// what a tier resolved to with the old Settings: the user's pick, else the registry's
const tierModel = (engine: Harness, tier: ModelTier, o?: ModelTiers) => o?.[engine]?.[tier] ?? `reg-${engine}-${tier}`;
const card = (c: AgentCatalogService, id: string) => c.list().profiles.find(p => p.id === id)!;

describe('legacyOf: what config.json still holds', () => {
  it('reads tiers, Code Mode and the Orchestrator\'s models; nothing retired = null', () => {
    expect(legacyOf({ modelTiers: { claude: { light: 'haiku', top: 'opus', huge: 'x' } }, codeMode: true, orchestratorChats: { harness: 'claude', claudeModel: 'opus', claudeEffort: 'high' } }))
      .toEqual({ modelTiers: { claude: { light: 'haiku', top: 'opus' } }, codeMode: true, orchestrator: { harness: 'claude', claudeModel: 'opus', claudeEffort: 'high' } });
    expect(legacyOf({ orchestratorChats: { harness: 'claude' } })).toBeNull();
    expect(hasLegacyKeys({ orchestratorChats: { harness: 'claude' } })).toBe(false);
    // only the old defaults on file: still a move (the cards get the registry's models)
    expect(legacyOf({ codeMode: false, balancedMode: false })).toEqual({});
  });
  it('drops a model id that could become a flag or a path', () => {
    expect(legacyOf({ modelTiers: { claude: { low: '--danger', mid: 'a b', top: 'opus' } } })).toEqual({ modelTiers: { claude: { top: 'opus' } } });
  });
});

describe('migratedCards', () => {
  const profiles = () => new AgentCatalogService({ userData: tmp(), models }).list().profiles;
  it('a card with no model gets its tier\'s model (the old pick, else the registry\'s); a card with a model keeps it', () => {
    const list = profiles().map(p => p.id === 'herald' ? { ...p, model: 'kept' } : { ...p, model: null }) as AgentProfile[];
    const out = migratedCards(list, { modelTiers: { claude: { light: 'haiku' } } }, tierModel);
    const scout = list.find(p => p.id === 'scout')!;
    expect(out.find(p => p.id === 'scout')!.model).toBe(tierModel('claude', scout.tier, { claude: { light: 'haiku' } }));
    expect(out.find(p => p.id === 'herald')).toBeUndefined();
  });
  it('Code Mode on goes to every work role, never the Orchestrator', () => {
    const out = migratedCards(profiles(), { codeMode: true }, () => null);
    expect(out.filter(p => p.codeMode === true).map(p => p.id).sort()).toEqual(['artisan', 'herald', 'scout', 'sentinel', 'strategist']);
    expect(out.find(p => p.id === 'orchestrator')).toBeUndefined();
  });
  it('the Orchestrator\'s settings go to its card: on Cursor its model, reasoning and fast, its old presets left behind', () => {
    const list = profiles().map(p => p.id === 'orchestrator' ? { ...p, model: null, presets: { max: { model: 'x' } } } : p) as AgentProfile[];
    const legacy: LegacyModelSettings = { orchestrator: { harness: 'cursor', cursorModel: 'gpt-5', cursorReasoning: 'high', cursorFast: true, claudeModel: 'opus' } };
    expect(migratedCards(list, legacy, () => null).find(p => p.id === 'orchestrator')).toMatchObject({ engine: 'cursor', model: 'gpt-5', effort: 'high', fast: true, presets: undefined });
    const claude: LegacyModelSettings = { orchestrator: { harness: 'claude', claudeModel: 'opus', claudeEffort: 'max' } };
    expect(migratedCards(list, claude, () => null).find(p => p.id === 'orchestrator')).toMatchObject({ engine: 'claude', model: 'opus', effort: 'max' });
  });
});

describe('the move end to end, once', () => {
  it('config.json loses the keys, the cards take them, a second start moves nothing', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ codeMode: true, balancedMode: true, modelTiers: { claude: { mid: 'sonnet' } }, orchestratorChats: { harness: 'claude', claudeModel: 'opus', claudeEffort: 'high' } }));
    new ConfigStore(dir, {});
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')) as Record<string, unknown>;
    for (const k of ['codeMode', 'balancedMode', 'modelTiers']) expect(saved).not.toHaveProperty(k);
    expect(saved.orchestratorChats ?? {}).not.toHaveProperty('claudeModel');
    const legacy = readLegacy(dir)!;
    expect(legacy).toMatchObject({ codeMode: true, modelTiers: { claude: { mid: 'sonnet' } }, orchestrator: { claudeModel: 'opus' } });

    const catalog = new AgentCatalogService({ userData: dir, models });
    const changed = catalog.migrateLegacy(list => migratedCards(list, legacy, tierModel));
    markLegacyDone(dir);
    expect(changed).toContain('orchestrator');
    expect(card(catalog, 'orchestrator')).toMatchObject({ model: 'opus', effort: 'high' });
    expect(card(catalog, 'orchestrator').codeMode).not.toBe(true);
    expect(card(catalog, 'scout').codeMode).toBe(true);
    expect(catalog.launchFlags('artisan').codeMode).toBe(true);
    // the cards stay after a restart; the move is not run again (the marker), nor captured again
    const again = new AgentCatalogService({ userData: dir, models });
    expect(card(again, 'orchestrator').model).toBe('opus');
    expect(readLegacy(dir)).toBeNull();
    writeLegacy(dir, { codeMode: false });
    expect(readLegacy(dir)).toBeNull();
  });
});
