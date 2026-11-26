// The whole move of 2026-11-23 on one old profile (ADR 0337 and 0341): a config.json with tiers, Balanced, the global
// Code Mode and a children limit, plus a roles.json where workers still launch others, an untouched role still has an
// older shipped text and no card names a model. Both migrations run in the app's own order (config capture, catalog
// load, the model move: wiring.ts) and every card must end in the expected state, also after a save and a restart.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { markLegacyDone, migratedCards, readLegacy } from '../../../src/main/agents/legacy-cards';
import type { ModelTiers } from '../../../src/main/agents/model-tier';
import { SHIPPED_BEFORE } from '../../../src/main/agents/role-migrate';
import { ConfigStore } from '../../../src/main/brain/config';
import type { AgentModelChoice, AgentProfile } from '../../../src/shared/agents';
import type { Harness } from '../../../src/shared/contract';
import { ROLE_DEFAULTS, WORK_ROLE_IDS, type ModelTier, type RoleId } from '../../../src/shared/roles';

const WORKERS = ['scout', 'artisan', 'sentinel'] as const;
const OLD_LAUNCHES: Record<(typeof WORKERS)[number], string[]> = { scout: ['artisan'], artisan: ['scout', 'sentinel'], sentinel: ['scout'] };
const TIERS = { light: 'haiku', mid: 'sonnet', top: 'opus' } as const;

const models = (): AgentModelChoice[] => [
  { engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: Object.values(TIERS).map(id => ({ id, name: id })), installed: true, authenticated: true }];
// what a tier resolved to with the old Settings: the user's pick, else the registry's
const tierModel = (engine: Harness, tier: ModelTier, o?: ModelTiers) => o?.[engine]?.[tier] ?? `reg-${engine}-${tier}`;

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-simplify-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const rolesFile = () => path.join(dir, 'roles.json');
const configFile = () => path.join(dir, 'config.json');
const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown>;
const make = () => new AgentCatalogService({ userData: dir, models });
const card = (c: AgentCatalogService, id: string) => c.list().profiles.find(p => p.id === id)!;

/** The files as a build before 2026-11-23 left them. */
function oldProfile(patch: (p: AgentProfile) => Partial<AgentProfile> = () => ({})): void {
  const fresh = make().list().profiles;
  const roles = fresh.map(p => ({ ...p, model: null, launches: p.id in OLD_LAUNCHES ? OLD_LAUNCHES[p.id as keyof typeof OLD_LAUNCHES] : p.launches,
    ...(p.id === 'artisan' ? { instructions: SHIPPED_BEFORE.artisan![0]! } : {}), ...(p.id === 'strategist' ? { instructions: SHIPPED_BEFORE.strategist![0]! } : {}), ...patch(p) }));
  fs.writeFileSync(rolesFile(), JSON.stringify({ format: 1, roles }));
  fs.writeFileSync(configFile(), JSON.stringify({ codeMode: true, balancedMode: true, modelTiers: { claude: TIERS }, delegation: { maxDepth: 3, maxParallel: 4, stallMin: 10 },
    orchestratorChats: { harness: 'claude', claudeModel: 'opus', claudeEffort: 'high' } }));
}
/** The app's start (wiring.ts): settings, catalog, then the model move when it is still owed. */
function start(): { catalog: AgentCatalogService; moved: string[] } {
  new ConfigStore(dir, {});
  const catalog = make(), legacy = readLegacy(dir);
  const moved = legacy ? catalog.migrateLegacy(list => migratedCards(list, legacy, tierModel)) : [];
  if (legacy) markLegacyDone(dir);
  return { catalog, moved };
}
/** A card's values that the two migrations decide. */
const state = (p: AgentProfile) => ({ engine: p.engine, model: p.model, effort: p.effort ?? null, codeMode: p.codeMode === true, launches: p.launches });
const expected = (id: RoleId) => id === 'orchestrator'
  ? { engine: 'claude', model: 'opus', effort: 'high', codeMode: false, launches: ROLE_DEFAULTS.orchestrator.launches }
  : { engine: 'claude', model: TIERS[ROLE_DEFAULTS[id].tier], effort: null, codeMode: true, launches: id === 'strategist' ? ROLE_DEFAULTS.strategist.launches : [] };

describe('an old profile, both migrations', () => {
  it('every card ends in the expected state and the retired settings are gone', () => {
    oldProfile();
    const { catalog, moved } = start();
    expect(catalog.list().problem).toBeNull();
    expect([...moved].sort()).toEqual(['artisan', 'orchestrator', 'scout', 'sentinel', 'strategist']);
    for (const id of ['orchestrator', ...WORK_ROLE_IDS] as RoleId[]) expect({ id, ...state(card(catalog, id)) }).toEqual({ id, ...expected(id) });
    // the role texts still shipped before the routing change are today's
    for (const id of ['artisan', 'strategist'] as const) expect(card(catalog, id).instructions).toBe(ROLE_DEFAULTS[id].instructions);

    const saved = readJson(configFile());
    for (const k of ['codeMode', 'balancedMode', 'modelTiers']) expect(saved).not.toHaveProperty(k);
    expect(saved.orchestratorChats ?? {}).not.toHaveProperty('claudeModel');
    expect(saved.delegation ?? {}).not.toHaveProperty('maxParallel');
    // the stored cards lost the workers' children too, not only the view of them
    const stored = (readJson(rolesFile()).roles as AgentProfile[]).filter(p => (WORKERS as readonly string[]).includes(p.id));
    expect(stored.map(p => p.launches)).toEqual(WORKERS.map(() => []));
  });

  it('a chat launched on each role takes the card: its model, its Code Mode, no children for a worker', () => {
    oldProfile();
    const { catalog } = start();
    for (const id of WORK_ROLE_IDS) {
      const r = catalog.resolve({ harness: 'claude', cwd: dir, roleId: id });
      expect({ id, harness: r.request.harness, model: r.request.model }).toEqual({ id, harness: 'claude', model: expected(id).model });
      expect(catalog.launchFlags(id)).toEqual({ codeMode: true, fast: false });
    }
    expect(catalog.launchFlags('orchestrator').codeMode).toBe(false);
  });

  it('a user\'s own card keeps its text, model and presets; only its children go', () => {
    oldProfile(p => p.id === 'scout' ? { userLocked: true, lastEditedBy: 'user', instructions: 'My scout.', model: 'opus', presets: { min: { model: 'haiku' } } } : {});
    const { catalog } = start();
    expect(card(catalog, 'scout')).toMatchObject({ userLocked: true, instructions: 'My scout.', model: 'opus', presets: { min: { model: 'haiku' } }, codeMode: true, launches: [] });
  });

  it('a restart moves nothing and changes no card', () => {
    oldProfile();
    const first = start().catalog.list().profiles.map(p => ({ id: p.id, ...state(p), version: p.activeVersion }));
    const again = start();
    expect(again.moved).toEqual([]);
    expect(again.catalog.list().profiles.map(p => ({ id: p.id, ...state(p), version: p.activeVersion }))).toEqual(first);
  });
});
