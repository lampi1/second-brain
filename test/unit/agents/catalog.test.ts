// The role catalog (main/agents/catalog.ts): exactly the Orchestrator, the eight work roles and Pulse; every shipped
// role survives a restart; edits are versions; "Ripristina predefinito"; a tolerant read of roles.json (an id this
// build does not know is left out, a broken file is kept and blocks writes); resolve() for role, Orchestrator and plain chats.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import type { AgentModelChoice, AgentProfile } from '../../../src/shared/agents';
import { ROLE_DEFAULTS, ROLE_IDS, WORK_ROLE_IDS } from '../../../src/shared/roles';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'm-top', name: 'Top' }, { id: 'm-mid', name: 'Mid' }], installed: true, authenticated: true }];
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-catalog-')); roots.push(dir);
  const make = () => new AgentCatalogService({ userData: dir, models, tierModel: (_e, tier) => ({ model: tier === 'top' ? 'm-top' : 'm-mid', independent: true }) });
  return { dir, make, catalog: make() };
}
const edit = (p: AgentProfile, patch: Partial<AgentProfile>) => ({ instructions: p.instructions, engine: p.engine, model: p.model, tools: p.tools, permissionCeiling: p.permissionCeiling,
  tier: p.tier, tierMax: p.tierMax, independent: p.independent, launches: p.launches, skills: p.skills, ...patch });

describe('role catalog', () => {
  it('holds exactly the Orchestrator, the eight roles and Pulse, with English names', () => {
    const { catalog } = setup(), list = catalog.list();
    expect(list.problem).toBeNull();
    expect(list.profiles.map(p => p.id)).toEqual([...ROLE_IDS, 'pulse']);
    expect(list.profiles.filter(p => p.scope === 'role').map(p => p.name)).toEqual(['Orchestrator', 'Strategist', 'Scout', 'Artisan', 'Sentinel', 'Herald', 'Router', 'Judge', 'Scribe']);
    expect(list.profiles.every(p => p.avatar.kind === 'character')).toBe(true);
  });
  it('every shipped role is valid on its own and survives a restart', () => {
    const { make, catalog } = setup(), before = catalog.list().profiles;
    for (const id of ROLE_IDS) expect(ROLE_DEFAULTS[id].launches).not.toContain(id);
    const again = make().list();
    expect(again.problem).toBeNull(); expect(again.profiles).toEqual(before);
  });
  it('an edit is a new version the next start keeps; Ripristina predefinito goes back to the shipped role', () => {
    const { make, catalog } = setup(), scout = catalog.list().profiles.find(p => p.id === 'scout')!;
    const saved = catalog.save(edit(scout, { instructions: 'Search the repo first.', skills: ['brain-edit'], tier: 'top' }), 'scout');
    expect(saved).toMatchObject({ version: 2, activeVersion: 2, userLocked: true, lastEditedBy: 'user', skills: ['brain-edit'], tier: 'top' });
    expect(make().list().profiles.find(p => p.id === 'scout')).toEqual(saved);
    expect(catalog.save(edit(saved, {}), 'scout').version).toBe(2); // nothing changed: same version
    const reset = catalog.reset('scout');
    expect(reset).toMatchObject({ instructions: ROLE_DEFAULTS.scout.instructions, skills: ROLE_DEFAULTS.scout.skills, tier: ROLE_DEFAULTS.scout.tier, userLocked: false, version: 3 });
    expect(catalog.history('scout').map(v => v.version).sort()).toEqual([1, 2, 3]);
    expect(catalog.restoreVersion('scout', 2).instructions).toBe('Search the repo first.');
  });
  it('refuses a role launching itself, a non-work role, a tier above its maximum and an unknown model', () => {
    const { catalog } = setup(), artisan = catalog.list().profiles.find(p => p.id === 'artisan')!;
    expect(() => catalog.save(edit(artisan, { launches: ['artisan'] }), 'artisan')).toThrow('mai sé stesso');
    expect(() => catalog.save(edit(artisan, { launches: ['orchestrator'] }), 'artisan')).toThrow();
    expect(() => catalog.save(edit(artisan, { tier: 'top', tierMax: 'light' }), 'artisan')).toThrow();
    expect(() => catalog.save(edit(artisan, { model: 'nope' }), 'artisan')).toThrow('modello');
  });
  it('reads roles.json tolerantly: an unknown id is left out, a broken file is kept and blocks writes', () => {
    const { dir, make, catalog } = setup(), file = path.join(dir, 'roles.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.roles.push({ ...raw.roles[1], id: 'future-role' });
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(make().list().profiles.map(p => p.id)).toEqual(catalog.list().profiles.map(p => p.id));
    fs.writeFileSync(file, '{"format":1,"roles":"x"}');
    const broken = make();
    expect(broken.list().problem).toMatch(/non è leggibile/);
    expect(() => broken.reset('scout')).toThrow(/non è leggibile/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"format":1,"roles":"x"}');
  });
  it('resolves a role chat on its tier, the Orchestrator on the session, a chat without role as plain', () => {
    const { catalog } = setup();
    const scout = catalog.resolve({ harness: 'claude', roleId: 'scout' } as never);
    expect(scout.owner).toMatchObject({ id: 'scout', name: 'Scout', source: 'catalog' });
    expect(scout.tier).toBe(ROLE_DEFAULTS.scout.tier); expect(scout.request.model).toBe('m-mid');
    expect(scout.instructions).toContain('Role: Scout.');
    expect(catalog.resolve({ harness: 'claude', roleId: 'scout', tier: 'top' } as never).request.model).toBe('m-top');
    expect(() => catalog.resolve({ harness: 'claude', roleId: 'herald', tier: 'top' } as never)).toThrow('massimo');
    expect(() => catalog.resolve({ harness: 'claude', roleId: 'orchestrator' } as never)).toThrow('coordinatore');
    expect(() => catalog.resolve({ harness: 'claude', roleId: 'reviewer' } as never)).toThrow('Ruolo sconosciuto');
    expect(catalog.resolve({ harness: 'claude', orchestrator: true, model: 'session' } as never).owner).toMatchObject({ id: 'orchestrator', model: 'session' });
    expect(catalog.resolve({ harness: 'claude' } as never).owner.source).toBe('plain');
    for (const id of WORK_ROLE_IDS) expect(catalog.resolve({ harness: 'claude', roleId: id } as never).launches).not.toContain(id);
  });
});
