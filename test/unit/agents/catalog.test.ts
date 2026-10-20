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
  const make = () => new AgentCatalogService({ userData: dir, models, tierModel: (_e, tier) => (tier === 'top' ? 'm-top' : 'm-mid') });
  return { dir, make, catalog: make() };
}
const edit = (p: AgentProfile, patch: Partial<AgentProfile>) => ({ instructions: p.instructions, engine: p.engine, model: p.model, tools: p.tools, permissionCeiling: p.permissionCeiling,
  tier: p.tier, tierMax: p.tierMax, launches: p.launches, skills: p.skills, ...patch });

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
  it('Sentinel and Judge resolve like any role: no `independent` field, no model switch away from the parent (issue #99)', () => {
    const { catalog } = setup();
    for (const id of ['sentinel', 'judge'] as const) {
      expect(catalog.list().profiles.find(p => p.id === id)).not.toHaveProperty('independent');
      const r = catalog.resolve({ harness: 'claude', roleId: id, model: 'm-top' } as never);
      expect(r.request.model).toBe('m-top'); // the top tier's model, the same one the parent runs
      expect(r).not.toHaveProperty('independent');
    }
  });
  it('a role with no model takes the routing row on its engine, and its effort unless the role names one (issue #99)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-catalog-')); roots.push(dir);
    const seen: unknown[] = [];
    const catalog = new AgentCatalogService({ userData: dir, models, tierModel: () => 'm-mid',
      tableModel: (engine, req) => { seen.push([engine, req.title]); return req.title?.startsWith('Verifica') ? { model: 'm-top', effort: 'low' } : null; } });
    const sentinel = catalog.resolve({ harness: 'claude', roleId: 'sentinel', title: 'Verifica · test', prompt: 'p' } as never);
    expect(sentinel.request).toMatchObject({ model: 'm-top', effort: 'low' });
    expect(sentinel.modelFrom).toBe('table');
    expect(seen).toContainEqual(['claude', 'Verifica · test']);
    // no row: the tier decides
    const other = catalog.resolve({ harness: 'claude', roleId: 'sentinel', title: 'Altro', prompt: 'p' } as never);
    expect(other.request.model).toBe('m-mid'); expect(other.modelFrom).toBeUndefined();
    // a launch that asks a tier keeps the tier
    expect(catalog.resolve({ harness: 'claude', roleId: 'sentinel', title: 'Verifica · x', tier: 'top' } as never).request.model).toBe('m-mid');
    // the role's own effort wins over the row's; the role's own model is never replaced
    const p = catalog.list().profiles.find(x => x.id === 'sentinel')!;
    catalog.save(edit(p, { effort: 'high' }), 'sentinel');
    expect(catalog.resolve({ harness: 'claude', roleId: 'sentinel', title: 'Verifica · y' } as never).request).toMatchObject({ model: 'm-top', effort: 'high' });
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
