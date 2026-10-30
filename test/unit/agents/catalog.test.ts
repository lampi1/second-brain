// The role catalog (main/agents/catalog.ts): exactly the Orchestrator, the five work roles and Flash; every shipped
// role survives a restart; edits are versions; "Ripristina predefinito"; a tolerant read of roles.json (an id this
// build does not know is left out, a broken file is kept and blocks writes); a roles.json of the nine-role catalog still
// loads (ADR 0100); resolve() for role, Orchestrator and plain chats.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService, readOwner } from '../../../src/main/agents/catalog';
import { PRE_ADR0100_INSTRUCTIONS } from '../../../src/main/agents/role-migrate';
import type { AgentModelChoice, AgentProfile } from '../../../src/shared/agents';
import { ROLE_DEFAULTS, ROLE_IDS, WORK_ROLE_IDS } from '../../../src/shared/roles';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'm-top', name: 'Top' }, { id: 'm-mid', name: 'Mid' }], installed: true, authenticated: true }];
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-catalog-')); roots.push(dir);
  const make = () => new AgentCatalogService({ userData: dir, models, tierModel: (_e, tier) => (tier === 'top' ? 'm-top' : 'm-mid') });
  return { dir, make, catalog: make() };
}
const edit = (p: AgentProfile, patch: Partial<AgentProfile>) => ({ instructions: p.instructions, engine: p.engine, model: p.model, tools: p.tools, permissionCeiling: p.permissionCeiling,
  tier: p.tier, tierMax: p.tierMax, launches: p.launches, skills: p.skills, ...patch });

describe('Flash and the Orchestrator have their own model (ADR 0107)', () => {
  it('Flash runs on its card: its model, else its tier\'s; read only whatever is saved; never delegated', () => {
    const { catalog } = setup();
    const flash = catalog.list().profiles.find(p => p.id === 'flash')!;
    expect(catalog.resolve({ harness: 'claude', cwd: '/x', quick: true } as never)).toMatchObject({ request: { harness: 'claude', model: 'm-mid' }, owner: { source: 'plain', name: 'Flash' }, policy: { tools: { allow: ['read', 'web'] }, ceiling: 'plan' } });
    const saved = catalog.save(edit(flash, { model: 'm-top', tools: { allow: ['read', 'edit', 'command'] } as never, permissionCeiling: null }), 'flash');
    expect(saved).toMatchObject({ model: 'm-top', tools: { allow: ['read', 'web'] }, permissionCeiling: 'plan' });
    expect(catalog.resolve({ harness: 'claude', cwd: '/x', quick: true } as never).request.model).toBe('m-top');
    expect(() => catalog.save(edit(saved, { launches: ['scout'] }), 'flash')).toThrow(/Flash non avvia/);
    expect(() => catalog.resolve({ harness: 'claude', roleId: 'flash' } as never)).toThrow(/Ruolo sconosciuto/);
  });

  it('the Orchestrator takes its card\'s model on the card\'s engine, else the session\'s', () => {
    const { catalog } = setup();
    expect(catalog.resolve({ harness: 'claude', orchestrator: true, model: 'm-mid' } as never).request.model).toBe('m-mid');
    const o = catalog.list().profiles.find(p => p.id === 'orchestrator')!;
    catalog.save(edit(o, { engine: 'claude', model: 'm-top' }), 'orchestrator');
    expect(catalog.resolve({ harness: 'claude', orchestrator: true, model: 'm-mid' } as never).request.model).toBe('m-top');
  });
});

describe('role catalog', () => {
  it('holds exactly the Orchestrator, the five work roles and Flash, with English names', () => {
    const { catalog } = setup(), list = catalog.list();
    expect(list.problem).toBeNull();
    expect(list.profiles.map(p => p.id)).toEqual([...ROLE_IDS, 'flash']);
    expect(list.profiles.find(p => p.id === 'flash')).toMatchObject({ name: 'Flash', scope: 'background', tier: 'mid', launches: [], tools: { allow: ['read', 'web'] }, permissionCeiling: 'plan' });
    expect(list.profiles.filter(p => p.scope === 'role').map(p => p.name)).toEqual(['Orchestrator', 'Strategist', 'Scout', 'Artisan', 'Sentinel', 'Herald']);
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
  it('keeps the model a role already runs with when only its text changes (#128)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-catalog-')); roots.push(dir);
    // a launch still checks the model it would run with: a role whose model left the engine's list is not started
    let known = [{ id: 'm-top', name: 'Top' }, { id: 'm-mid', name: 'Mid' }];
    const live = new AgentCatalogService({ userData: dir, models: () => models().map(m => ({ ...m, models: known })) });
    const scout = live.list().profiles.find(p => p.id === 'scout')!;
    live.save(edit(scout, { model: 'm-mid' }), 'scout');
    known = [{ id: 'm-top', name: 'Top' }];
    expect(live.save(edit(live.list().profiles.find(p => p.id === 'scout')!, { instructions: 'Altro testo.' }), 'scout').model).toBe('m-mid');
    expect(() => live.resolve({ harness: 'claude', roleId: 'scout' } as never)).toThrow('modello');
  });
  it('reads roles.json tolerantly: an unknown id is left out, a broken file is kept and blocks writes', () => {
    const { dir, make, catalog } = setup(), file = path.join(dir, 'roles.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.roles.push({ ...raw.roles[1], id: 'future-role' }, { ...raw.roles[1], id: 'pulse' }); // Pulse: removed by ADR 0201
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(make().list().profiles.map(p => p.id)).toEqual(catalog.list().profiles.map(p => p.id));
    fs.writeFileSync(file, '{"format":1,"roles":"x"}');
    const broken = make();
    expect(broken.list().problem).toMatch(/non è leggibile/);
    expect(() => broken.reset('scout')).toThrow(/non è leggibile/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"format":1,"roles":"x"}');
  });
  it('loads a nine-role roles.json (ADR 0100): retired profiles left out, their launches dropped, an untouched text moved', () => {
    const { dir, make, catalog } = setup(), file = path.join(dir, 'roles.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { roles: Record<string, unknown>[] };
    const base = raw.roles.find(r => r.id === 'scout')!;
    for (const id of ['router', 'judge', 'scribe']) raw.roles.push({ ...base, id, launches: ['scout'] });
    const strategist = raw.roles.find(r => r.id === 'strategist')!;
    Object.assign(strategist, { launches: ['scout', 'artisan', 'sentinel', 'herald', 'judge', 'scribe'], instructions: PRE_ADR0100_INSTRUCTIONS.strategist });
    const artisan = raw.roles.find(r => r.id === 'artisan')!;
    Object.assign(artisan, { launches: ['scout', 'sentinel', 'judge'], instructions: 'My own Artisan text.', userLocked: true, lastEditedBy: 'user' });
    fs.writeFileSync(file, JSON.stringify(raw));
    const again = make(), list = again.list();
    expect(list.problem).toBeNull();
    expect(list.profiles.map(p => p.id)).toEqual(catalog.list().profiles.map(p => p.id));
    const get = (id: string) => list.profiles.find(p => p.id === id)!;
    expect(get('strategist')).toMatchObject({ launches: ['scout', 'artisan', 'sentinel', 'herald'], instructions: ROLE_DEFAULTS.strategist.instructions, lastEditedBy: 'default' });
    // a migration changes the active version in place (ADR 0186), and says so on it
    expect(again.history('strategist').flatMap(v => (v.amended ?? []).map(a => a.reason))).toContain('Cinque ruoli di lavoro (ADR 0100)');
    expect(get('strategist')).toMatchObject({ version: 1, activeVersion: 1 });
    expect(get('artisan')).toMatchObject({ launches: ['scout', 'sentinel'], instructions: 'My own Artisan text.' });
    // a stored version naming a retired launch restores without an error
    expect(again.restoreVersion('artisan', 1).launches).not.toContain('judge');
    expect(() => again.resolve({ harness: 'claude', roleId: 'judge' } as never)).toThrow(/Sentinel/);
  });
  it('an old chat of a retired role shows as its successor (ADR 0100)', () => {
    const owner = { id: 'judge', name: 'Judge', purpose: 'old', avatar: { kind: 'character', value: 'judge' }, engine: 'claude', model: null, revision: 1, source: 'catalog', version: 3 };
    expect(readOwner(owner)).toMatchObject({ id: 'sentinel', name: 'Sentinel', avatar: { kind: 'character', value: 'sentinel' }, version: 3 });
    expect(readOwner({ ...owner, id: 'router', name: 'Router' })).toMatchObject({ id: 'orchestrator', name: 'Orchestrator' });
    expect(readOwner({ ...owner, id: 'scribe', name: 'Scribe' })).toMatchObject({ id: 'artisan', name: 'Artisan' });
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
  it('Sentinel resolves like any role: no `independent` field, no model switch away from the parent (issue #99)', () => {
    const { catalog } = setup();
    for (const id of ['sentinel'] as const) {
      expect(catalog.list().profiles.find(p => p.id === id)).not.toHaveProperty('independent');
      const r = catalog.resolve({ harness: 'claude', roleId: id, model: 'm-top' } as never);
      expect(r.request.model).toBe('m-top'); // the top tier's model, the same one the parent runs
      expect(r).not.toHaveProperty('independent');
    }
  });
  it('a role with no model takes its tier\'s model whatever the work; its own model and effort always win (ADR 0210: no routing table)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-catalog-')); roots.push(dir);
    const catalog = new AgentCatalogService({ userData: dir, models, tierModel: (_e, tier) => `m-${tier}` });
    const own = catalog.list().profiles.find(x => x.id === 'sentinel')!;
    const sentinel = catalog.resolve({ harness: 'claude', roleId: 'sentinel', title: 'Verifica · test', prompt: 'p' } as never);
    expect(sentinel.request.model).toBe(`m-${own.tier}`);
    expect(sentinel).not.toHaveProperty('modelFrom');
    // a launch that asks a tier gets that tier's model
    expect(catalog.resolve({ harness: 'claude', roleId: 'sentinel', title: 'Verifica · x', tier: 'top' } as never).request.model).toBe('m-top');
    // the role's own effort and model are never replaced
    const p = catalog.list().profiles.find(x => x.id === 'sentinel')!;
    catalog.save(edit(p, { effort: 'high' }), 'sentinel');
    expect(catalog.resolve({ harness: 'claude', roleId: 'sentinel', title: 'Verifica · y' } as never).request).toMatchObject({ model: `m-${own.tier}`, effort: 'high' });
    const q = catalog.list().profiles.find(x => x.id === 'sentinel')!;
    catalog.save(edit(q, { model: 'm-mid', effort: 'medium' }), 'sentinel');
    expect(catalog.resolve({ harness: 'claude', roleId: 'sentinel', title: 'Verifica · z' } as never).request).toMatchObject({ model: 'm-mid', effort: 'medium' });
  });
});

describe('default engine (issue #96)', () => {
  const choice = (engine: string, p: Partial<AgentModelChoice> = {}): AgentModelChoice => ({ engine, label: engine, enabled: true, trusted: true, effort: engine === 'claude', defaultModel: true, modelSelectable: true, modelReason: null, source: 'registry', models: [], installed: null, authenticated: null, ...p });
  function world(initial: { preferred: string | null; models: AgentModelChoice[] }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-catalog-')); roots.push(dir);
    const state = { ...initial }, emitted: number[] = [];
    const catalog = new AgentCatalogService({ userData: dir, models: () => state.models, preferredEngine: () => state.preferred, emit: c => emitted.push(c.profiles.length) });
    const engineOf = (id: string) => catalog.list().profiles.find(p => p.id === id)!.engine;
    return { state, emitted, catalog, engineOf };
  }
  it('seeds untouched roles on the engine chosen at onboarding while logins are still unknown', () => {
    const w = world({ preferred: 'cursor', models: [choice('claude'), choice('cursor')] });
    expect(w.engineOf('artisan')).toBe('cursor');
    expect(w.engineOf('sentinel')).toBe('cursor');
  });
  it('moves untouched roles to the chosen engine when it changes, never a role the user edited', () => {
    const w = world({ preferred: 'claude', models: [choice('claude', { installed: true, authenticated: true }), choice('cursor', { installed: true, authenticated: true })] });
    expect(w.engineOf('scout')).toBe('claude');
    const scout = w.catalog.list().profiles.find(p => p.id === 'scout')!;
    w.catalog.save(edit(scout, { instructions: 'mine' }), 'scout');
    w.state.preferred = 'cursor';
    expect(w.engineOf('artisan')).toBe('cursor');
    expect(w.engineOf('scout')).toBe('claude');
    // a rebind is not a change of the role (ADR 0186): the same version, with a note on it
    expect(w.catalog.list().profiles.find(p => p.id === 'artisan')).toMatchObject({ engine: 'cursor', version: 1, activeVersion: 1 });
    expect(w.catalog.history('artisan')[0]).toMatchObject({ version: 1, behaviour: { engine: 'cursor' }, amended: [expect.objectContaining({ reason: 'Motore disponibile' })] });
  });
  it('makes a new version only for the role\'s text, skills, model or tier, and records which (ADR 0186)', () => {
    const { catalog } = setup(), scout = catalog.list().profiles.find(p => p.id === 'scout')!;
    const tools = catalog.save(edit(scout, { tools: { allow: ['read'] } as never, maxContext: 200_000 }), 'scout');
    expect(tools).toMatchObject({ version: 1, activeVersion: 1, userLocked: true, lastEditedBy: 'user', tools: { allow: ['read'] } });
    expect(catalog.history('scout')).toHaveLength(1);
    expect(catalog.history('scout')[0]).toMatchObject({ behaviour: { tools: { allow: ['read'] } }, amended: [expect.objectContaining({ by: 'user' })] });
    const text = catalog.save(edit(tools, { instructions: 'Read first.', tier: 'top' }), 'scout');
    expect(text).toMatchObject({ version: 2, activeVersion: 2 });
    expect(catalog.history('scout')[0]).toMatchObject({ version: 2, changed: ['text', 'tier'] });
    // going back to v1 brings back its text and tier, never wider tools than today's (ADR 0186)
    const narrowed = catalog.save(edit(catalog.list().profiles.find(p => p.id === 'scout')!, { tools: { allow: [] } as never, permissionCeiling: 'plan' }), 'scout');
    expect(narrowed).toMatchObject({ version: 2, tools: { allow: [] }, permissionCeiling: 'plan' });
    const back = catalog.restoreVersion('scout', 1);
    expect(back).toMatchObject({ activeVersion: 1, instructions: scout.instructions, tier: scout.tier, tools: { allow: [] }, permissionCeiling: 'plan' });
    // a trial always makes a version, even for tools only
    const trial = catalog.approveTrial('scout', { ...edit(back, { tools: { allow: ['read'] } as never }) }, 'prova');
    expect(trial.trial).toMatchObject({ version: 3, baseline: 1 });
  });
  it('ignores a chosen engine that is not usable', () => {
    const w = world({ preferred: 'cursor', models: [choice('claude', { installed: true, authenticated: true }), choice('cursor', { authenticated: false })] });
    expect(w.engineOf('artisan')).toBe('claude');
    w.state.models = [choice('claude', { installed: true, authenticated: true }), choice('cursor', { enabled: false })];
    expect(w.engineOf('artisan')).toBe('claude');
  });
  it('refresh() sends the catalog to the renderer even when no role changed', () => {
    const w = world({ preferred: 'claude', models: [choice('claude')] });
    const before = w.emitted.length;
    w.state.models = [choice('claude', { installed: true, authenticated: true, models: [{ id: 'm', name: 'm' }] })];
    w.catalog.refresh();
    expect(w.emitted.length).toBe(before + 1);
  });
});
