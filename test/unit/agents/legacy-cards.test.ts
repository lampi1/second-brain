// The one-off move of the retired model Settings onto the role cards (agents/legacy-cards.ts, 2026-11-23): config.json's
// old keys are captured beside it and dropped (brain/config.ts), then the cards take them once (catalog.migrateLegacy):
// a card with no model gets the model its tier resolved to, the global Code Mode goes to every work role, the
// Orchestrator's «Chat aperte dall'Orchestrator» model and effort go to its card, the Cursor reasoning and fast to every
// card on Cursor; a malformed value is left out and never makes the catalog unreadable; a card the app rebinds to
// another engine launches there and takes its values back on its return; a second start moves nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../../../src/main/log';
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

describe('a malformed config.json never breaks the catalog', () => {
  it('legacyOf drops an engine id out of shape or removed and a model id the catalog could not read back', () => {
    const oc = { harness: 'Not an engine', claudeModel: 'opus 4', cursorModel: '-gpt', claudeEffort: 'high' };
    expect(legacyOf({ orchestratorChats: oc })).toEqual({ orchestrator: { claudeEffort: 'high' } });
    expect(legacyOf({ orchestratorChats: { harness: 'gemini', claudeModel: 'opus' } })).toEqual({ orchestrator: { claudeModel: 'opus' } });
    expect(legacyOf({ modelTiers: { claude: { mid: '--danger', light: 'x'.repeat(121), top: 'opus' } } })).toEqual({ modelTiers: { claude: { top: 'opus' } } });
  });
  it('a second catalog reads the cards a malformed config moved, the other values moved', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ codeMode: true, modelTiers: { claude: { mid: '--danger' } }, orchestratorChats: { harness: 'claude', claudeModel: 'opus 4', claudeEffort: 'high' } }));
    new ConfigStore(dir, {});
    const catalog = new AgentCatalogService({ userData: dir, models });
    catalog.migrateLegacy(list => migratedCards(list, readLegacy(dir)!, tierModel));
    const again = new AgentCatalogService({ userData: dir, models });
    expect(again.list().problem).toBeNull();
    expect(card(again, 'scout').codeMode).toBe(true);
    expect(card(again, 'orchestrator').effort).toBe('high');
  });
  it('migrateLegacy leaves a card it could not read back as it was, says so in the log, and moves the others', () => {
    const dir = tmp(), catalog = new AgentCatalogService({ userData: dir, models });
    const before = card(catalog, 'artisan');
    const warned = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const moved = catalog.migrateLegacy(list => list.map(p => ({ ...p, model: p.id === 'artisan' ? 'a model' : 'opus' })));
    const warnings = warned.mock.calls.filter(c => (c[2]?.data as { role?: string } | undefined)?.role === 'artisan');
    warned.mockRestore();
    expect(moved).toEqual(expect.arrayContaining(['scout', 'orchestrator']));
    expect(moved).not.toContain('artisan');
    expect(warnings).toHaveLength(1);
    const again = new AgentCatalogService({ userData: dir, models });
    expect(again.list().problem).toBeNull();
    expect(card(again, 'artisan')).toEqual(before);
    expect(card(again, 'scout').model).toBe('opus');
  });
});

describe('an engine the app rebinds after the move', () => {
  const two = (): AgentModelChoice[] => models().map(m => m.engine === 'claude' ? { ...m, models: [{ id: 'opus', name: 'Opus' }] } : { ...m, effort: false, models: [{ id: 'gpt-5', name: 'GPT' }] });
  const world = () => {
    const dir = tmp(), state = { preferred: 'claude' };
    const make = () => new AgentCatalogService({ userData: dir, models: two, preferredEngine: () => state.preferred });
    return { state, make, catalog: make() };
  };
  const launch = (c: AgentCatalogService) => c.resolve({ harness: 'claude', cwd: '/x', roleId: 'artisan' }).request;
  // what the move wrote on a card nobody edited, plus the other engine-specific fields
  const move = (c: AgentCatalogService) => c.migrateLegacy(list => list.map(p => ({ ...p, model: 'opus', effort: 'high' as const, fast: true, presets: { max: { model: 'opus' } }, ...(p.id === 'orchestrator' ? {} : { codeMode: true }) })));
  it('drops the old engine\'s model, effort, presets and fast, so the role launches; Code Mode stays', () => {
    const w = world();
    move(w.catalog);
    expect(launch(w.catalog)).toMatchObject({ harness: 'claude', model: 'opus', effort: 'high' });
    w.state.preferred = 'cursor';
    const p = card(w.catalog, 'artisan');
    expect(p).toMatchObject({ engine: 'cursor', model: null, codeMode: true });
    for (const k of ['effort', 'presets', 'fast'] as const) expect(p[k]).toBeUndefined();
    expect(launch(w.catalog).harness).toBe('cursor');
    expect(launch(w.catalog)).not.toHaveProperty('model');
  });
  it('gives the values back when the card returns to that engine, across a restart too', () => {
    const w = world();
    move(w.catalog);
    w.state.preferred = 'cursor';
    expect(card(w.catalog, 'artisan').model).toBeNull();
    const again = w.make();
    w.state.preferred = 'claude';
    expect(card(again, 'artisan')).toMatchObject({ engine: 'claude', model: 'opus', effort: 'high', fast: true, presets: { max: { model: 'opus' } } });
    expect(launch(again)).toMatchObject({ harness: 'claude', model: 'opus', effort: 'high' });
  });
  it('«Ripristina predefinito» forgets them', () => {
    const w = world();
    move(w.catalog);
    w.state.preferred = 'cursor';
    expect(card(w.catalog, 'artisan').model).toBeNull();
    w.catalog.reset('artisan');
    w.state.preferred = 'claude';
    expect(card(w.catalog, 'artisan')).toMatchObject({ engine: 'claude', model: null });
  });
});

describe('effort and fast', () => {
  const profiles = (patch: (p: AgentProfile) => Partial<AgentProfile>) => new AgentCatalogService({ userData: tmp(), models }).list().profiles.map(p => ({ ...p, ...patch(p) })) as AgentProfile[];
  it('an Orchestrator card with its own model still takes effort and fast on its engine, never over its own', () => {
    const own = (patch: Partial<AgentProfile>) => profiles(p => (p.id === 'orchestrator' ? { model: 'own', ...patch } : {}));
    const orchestrator = (list: AgentProfile[], o: LegacyModelSettings['orchestrator']) => migratedCards(list, { orchestrator: o }, () => null).find(p => p.id === 'orchestrator');
    expect(orchestrator(own({}), { harness: 'claude', claudeModel: 'opus', claudeEffort: 'high' })).toMatchObject({ engine: 'claude', model: 'own', effort: 'high' });
    expect(orchestrator(own({ engine: 'cursor' }), { harness: 'cursor', cursorReasoning: 'high', cursorFast: true })).toMatchObject({ engine: 'cursor', model: 'own', effort: 'high', fast: true });
    expect(orchestrator(own({ effort: 'low' }), { harness: 'claude', claudeEffort: 'high' })).toBeUndefined();
    // on another engine the card keeps its own model and engine: nothing of it applies there
    expect(orchestrator(own({}), { harness: 'cursor', cursorModel: 'gpt-5', cursorReasoning: 'high', cursorFast: true })).toBeUndefined();
  });
  it('the work cards on Cursor with none take the reasoning and fast every Cursor chat had; the others do not', () => {
    const list = profiles(p => (p.id === 'scout' ? { engine: 'cursor', presets: { min: { model: 'a' }, max: { model: 'b', effort: 'max' } } } : p.id === 'artisan' ? { engine: 'cursor', model: 'own', effort: 'low' } : {}));
    const out = migratedCards(list, { orchestrator: { harness: 'claude', cursorReasoning: 'high', cursorFast: true } }, () => null);
    expect(out.find(p => p.id === 'scout')).toMatchObject({ effort: 'high', fast: true, presets: { min: { model: 'a', effort: 'high' }, max: { model: 'b', effort: 'max' } } });
    expect(out.find(p => p.id === 'artisan')).toMatchObject({ model: 'own', effort: 'low', fast: true });
    expect(out.map(p => p.id).sort()).toEqual(['artisan', 'scout']);
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
