// Agent definitions v2: v1 migration, behaviour versions, restore parent rule, trials, archive and v0 snapshots.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentCatalogService, MAX_ACTIVE_AGENTS, ownerOf, readOwner } from '../../src/main/agents/catalog';
import { AgentHistory, HISTORY_BYTES, HISTORY_PER_AGENT, behaviourOf } from '../../src/main/agents/versions';
import type { AgentDraft, AgentModelChoice, AgentProfile, AgentVersion } from '../../src/shared/agents';

const dirs: string[] = [];
const tmp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-versions-')); dirs.push(p); return p; };
afterEach(() => { for (const p of dirs.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
const choices = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];
const draft = (over: Partial<AgentDraft> = {}): AgentDraft => ({ name: 'Ricerca', purpose: 'Controllare fonti', instructions: 'Cita le fonti.', engine: 'claude', model: 'known-model', avatar: { kind: 'symbol', value: 'search' }, effort: 'medium', ...over });
const service = (dir: string) => new AgentCatalogService({ userData: dir, models: choices });
const json = (dir: string, name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as Record<string, unknown>;
const GENERAL = 'Chiarisci il risultato atteso. Distingui fatti, ipotesi e proposte. Rispetta permessi e dati personali.';
const v1Record = (id: string, over: Record<string, unknown> = {}) => ({ id, name: 'Assistente', purpose: 'Organizzare il lavoro e preparare risultati utili', instructions: GENERAL, engine: 'claude', model: null, avatar: { kind: 'symbol', value: 'briefcase' }, createdAt: 10, updatedAt: 10, ...over });

function v1Catalog(dir: string) {
  const body = { version: 1, profiles: [
    v1Record('default-general'),
    v1Record('default-development', { name: 'Sviluppo', purpose: 'Progettare software', instructions: 'My own workflow' }),
    v1Record('agent-mine', { name: 'Mio', purpose: 'Il mio scopo', instructions: 'Fai X' }),
  ], legacyRouting: { preserved: true, imported: 0, remaining: 2 } };
  const text = `${JSON.stringify(body, null, 2)}\n`;
  fs.writeFileSync(path.join(dir, 'agents.json'), text);
  return text;
}

describe('Agent definitions v2', () => {
  it('migrates a v1 catalog once into agents.v2.json, leaves the v1 file untouched and records every agent as version 1', () => {
    const dir = tmp(), original = v1Catalog(dir);
    const c = service(dir).list();
    expect(c.problem).toBeNull();
    expect(json(dir, 'agents.v2.json')).toMatchObject({ version: 2, legacyRouting: { imported: 0, remaining: 2 } });
    const byId = Object.fromEntries(c.profiles.map(p => [p.id, p]));
    expect(byId['default-general']).toMatchObject({ origin: { kind: 'preset', presetId: 'legacy-general', presetRevision: 0 }, category: 'other', userLocked: false, version: 1, activeVersion: 1, lastEditedBy: 'migration', status: 'active', tools: null, permissionCeiling: null });
    expect(byId['default-general']!.manifest).toBeDefined();
    expect(byId['default-development']).toMatchObject({ origin: { kind: 'preset', presetId: 'legacy-development' }, category: 'development', userLocked: true, instructions: 'My own workflow' });
    expect(byId['agent-mine']).toMatchObject({ origin: { kind: 'user' }, category: 'other', role: 'Il mio scopo', userLocked: true });
    const history = json(dir, 'agent-history.json') as { entries: AgentVersion[] };
    expect(history.entries.map(e => [e.agentId, e.version, e.parentVersion, e.author, e.state])).toEqual([
      ['default-general', 1, null, 'migration', 'active'], ['default-development', 1, null, 'migration', 'active'], ['agent-mine', 1, null, 'migration', 'active']]);
    const after = fs.readFileSync(path.join(dir, 'agents.v2.json'), 'utf8');
    expect(service(dir).list().profiles).toHaveLength(3);
    expect(fs.readFileSync(path.join(dir, 'agents.v2.json'), 'utf8')).toBe(after);
    // A rolled-back build reads agents.json: it must still be the v1 catalog it wrote.
    expect(fs.readFileSync(path.join(dir, 'agents.json'), 'utf8')).toBe(original);
  });

  it('creates a version only for behaviour changes, never for cosmetic edits or the same behaviour', () => {
    const dir = tmp(), c = service(dir);
    const p = c.save(draft());
    expect(p).toMatchObject({ version: 1, activeVersion: 1, origin: { kind: 'user' }, userLocked: true, lastEditedBy: 'user' });
    const cosmetic = c.save({ ...draft(), name: 'Ricerca fonti', avatar: { kind: 'symbol', value: 'globe', tone: 'teal' }, role: 'Verifica fonti', category: 'personal' }, p.id);
    expect(cosmetic).toMatchObject({ version: 1, name: 'Ricerca fonti', avatar: { tone: 'teal' }, category: 'personal' });
    // Same behaviour with fields in another order: still no version.
    const { effort, model, ...rest } = draft();
    expect(c.save({ effort, ...rest, model, name: 'Ricerca fonti' } as AgentDraft, p.id).version).toBe(1);
    const changed = c.save({ ...draft(), instructions: 'Cita sempre due fonti.' }, p.id);
    expect(changed).toMatchObject({ version: 2, activeVersion: 2, category: 'personal', role: 'Verifica fonti' });
    expect(c.history(p.id).map(v => [v.version, v.parentVersion, v.state, v.author])).toEqual([[2, 1, 'active', 'user'], [1, null, 'superseded', 'user']]);
    expect(c.save({ ...draft(), instructions: 'Cita sempre due fonti.', tools: { allow: ['read', 'web'] } }, p.id).version).toBe(3);
    expect(c.save({ ...draft(), instructions: 'Cita sempre due fonti.', tools: { allow: ['read', 'web'] }, permissionCeiling: 'plan' }, p.id).version).toBe(4);
  });

  it('keeps stored definition fields when an older client omits them', () => {
    const c = service(tmp());
    const p = c.save(draft({ role: 'Fonti', category: 'personal', tools: { allow: ['read'] }, permissionCeiling: 'plan' }));
    const legacyClient = c.save({ ...draft(), name: 'Rinominato' }, p.id);
    expect(legacyClient).toMatchObject({ role: 'Fonti', category: 'personal', tools: { allow: ['read'] }, permissionCeiling: 'plan', version: 1 });
    expect(c.save({ ...draft(), tools: null }, p.id)).toMatchObject({ tools: null, version: 2 });
  });

  it('restores an older version and builds the next edit on it', () => {
    const dir = tmp(), c = service(dir);
    const p = c.save(draft());
    c.save({ ...draft(), instructions: 'Seconda versione' }, p.id);
    const restored = c.restoreVersion(p.id, 1);
    expect(restored).toMatchObject({ version: 2, activeVersion: 1, instructions: 'Cita le fonti.' });
    expect(c.history(p.id).map(v => [v.version, v.state])).toEqual([[2, 'superseded'], [1, 'active']]);
    const next = c.save({ ...draft(), instructions: 'Terza, dalla prima' }, p.id);
    expect(next).toMatchObject({ version: 3, activeVersion: 3 });
    expect(c.history(p.id)[0]).toMatchObject({ version: 3, parentVersion: 1 });
    expect(() => c.restoreVersion(p.id, 9)).toThrow(/Versione non valida/);
    expect(service(dir).list().profiles.find(x => x.id === p.id)).toMatchObject({ version: 3, activeVersion: 3, instructions: 'Terza, dalla prima' });
  });

  it('refuses behaviour changes, restores and archiving while a trial is open', () => {
    const dir = tmp(), first = service(dir);
    const p = first.save(draft());
    const file = json(dir, 'agents.v2.json') as { profiles: AgentProfile[] };
    file.profiles = file.profiles.map(x => x.id === p.id ? { ...x, trial: { version: 1, baseline: 1, startedAt: 5 } } : x);
    fs.writeFileSync(path.join(dir, 'agents.v2.json'), JSON.stringify(file));
    const c = service(dir);
    expect(c.list().problem).toBeNull();
    expect(() => c.save({ ...draft(), instructions: 'Altro' }, p.id)).toThrow(/prova in corso/);
    expect(() => c.restoreVersion(p.id, 1)).toThrow(/prova in corso/);
    expect(() => c.archive(p.id)).toThrow(/prova in corso/);
    expect(c.save({ ...draft(), name: 'Solo nome' }, p.id)).toMatchObject({ name: 'Solo nome', version: 1, trial: { version: 1 } });
  });

  it('archives out of the launch list and the active limit, and restores within it', () => {
    const c = service(tmp());
    const p = c.save(draft());
    c.archive(p.id);
    expect(c.list().profiles.some(x => x.id === p.id)).toBe(false);
    expect(c.list().archived.map(x => x.id)).toEqual([p.id]);
    expect(() => c.resolve({ harness: 'claude', cwd: '/unused', agentId: p.id })).toThrow(/archiviato/);
    expect(() => c.save(draft(), p.id)).toThrow(/Ripristina/);
    while (c.list().profiles.length < MAX_ACTIVE_AGENTS) c.save(draft());
    expect(() => c.save(draft())).toThrow(/64 Agenti attivi/);
    expect(() => c.restore(p.id)).toThrow(/64 Agenti attivi/);
    c.archive(c.list().profiles[0]!.id);
    expect(c.restore(p.id)).toMatchObject({ status: 'active' });
    expect(c.restore(p.id).archivedAt).toBeUndefined();
    expect(c.resolve({ harness: 'claude', cwd: '/unused', agentId: p.id }).owner).toMatchObject({ id: p.id, version: 1 });
  });

  it('snapshots the active version; older snapshots stay v0 and unknown symbols stay readable', () => {
    const c = service(tmp());
    const p = c.save(draft());
    c.save({ ...draft(), instructions: 'v2' }, p.id);
    const owner = ownerOf(c.list().profiles.find(x => x.id === p.id)!);
    expect(owner.version).toBe(2);
    expect(readOwner(owner)).toEqual(owner);
    const legacy = { id: 'agent-old', name: 'Vecchio', purpose: 'x', engine: 'claude', model: null, revision: 3, source: 'catalog', avatar: { kind: 'symbol', value: 'rocket-from-the-future', tone: 'teal' } };
    const v0 = readOwner(legacy)!;
    expect('version' in v0).toBe(false);
    expect(v0.avatar).toEqual({ kind: 'symbol', value: 'briefcase' });
    expect(readOwner({ ...legacy, avatar: { kind: 'symbol', value: 'bug', tone: 'not-a-tone' } })!.avatar).toEqual({ kind: 'symbol', value: 'bug' });
    expect(readOwner({ ...legacy, version: 0 })).toBeNull();
  });

  it('validates tools, the permission ceiling, category and tone', () => {
    const c = service(tmp());
    expect(() => c.save(draft({ tools: { allow: ['read', 'deploy' as never] } }))).toThrow(/Strumenti/);
    expect(() => c.save(draft({ tools: { allow: ['read', 'read'] } }))).toThrow(/Strumenti/);
    expect(() => c.save(draft({ tools: { allow: ['read'], mcp: ['devops'] } }))).toThrow(/MCP/);
    expect(c.save(draft({ tools: { allow: ['read', 'mcp'], mcp: ['devops'] } })).tools).toEqual({ allow: ['read', 'mcp'], mcp: ['devops'] });
    expect(() => c.save(draft({ permissionCeiling: 'bypassPermissions' as never }))).toThrow(/permessi/);
    expect(() => c.save(draft({ category: 'finance' as never }))).toThrow(/Categoria/);
    expect(() => c.save(draft({ avatar: { kind: 'symbol', value: 'bug', tone: 'gold' as never } }))).toThrow(/Colore/);
  });

  it('refuses tools beyond reading on the API engine and hands the policy to the chat it starts', () => {
    const api: AgentModelChoice = { ...choices()[0]!, engine: 'anthropic', label: 'Anthropic API', models: [{ id: 'api-model', name: 'API model' }] };
    const c = new AgentCatalogService({ userData: tmp(), models: () => [...choices(), api] });
    expect(() => c.save(draft({ engine: 'anthropic', model: 'api-model', tools: { allow: ['read', 'edit'] } }))).toThrow(/motore API/);
    expect(c.save(draft({ engine: 'anthropic', model: 'api-model', tools: { allow: ['read'] } })).tools).toEqual({ allow: ['read'] });
    const p = c.save(draft({ tools: { allow: ['read', 'edit'] }, permissionCeiling: 'default' }));
    expect(c.resolve({ harness: 'claude', cwd: '.', agentId: p.id }).policy).toEqual({ tools: { allow: ['read', 'edit'] }, ceiling: 'default' });
    const ceilingOnly = c.save(draft({ name: 'Solo limite', permissionCeiling: 'plan' }));
    expect(c.resolve({ harness: 'claude', cwd: '.', agentId: ceilingOnly.id }).policy).toEqual({ tools: null, ceiling: 'plan' });
    const free = c.save(draft({ name: 'Libero' }));
    expect(c.resolve({ harness: 'claude', cwd: '.', agentId: free.id }).policy).toBeNull();
    expect(c.resolve({ harness: 'claude', cwd: '.' }).policy).toBeNull();
  });

  it('keeps a corrupt history file and suspends edits with a visible problem', () => {
    const dir = tmp();
    service(dir).save(draft());
    fs.writeFileSync(path.join(dir, 'agent-history.json'), '{"version":1,"entries":[{"agentId":"x"}]}');
    const c = service(dir);
    expect(c.list().problem).toMatch(/cronologia/);
    expect(c.list().profiles.length).toBeGreaterThan(0);
    expect(() => c.save(draft())).toThrow(/cronologia/);
    expect(fs.readFileSync(path.join(dir, 'agent-history.json'), 'utf8')).toBe('{"version":1,"entries":[{"agentId":"x"}]}');
  });

  it('keeps an invalid v2 catalog untouched', () => {
    const dir = tmp(), p = service(dir).save(draft());
    const file = json(dir, 'agents.v2.json') as { profiles: AgentProfile[] };
    file.profiles = file.profiles.map(x => x.id === p.id ? { ...x, activeVersion: 7 } : x);
    const text = JSON.stringify(file);
    fs.writeFileSync(path.join(dir, 'agents.v2.json'), text);
    const c = service(dir);
    expect(c.list().problem).toMatch(/non è leggibile/);
    expect(() => c.save(draft())).toThrow();
    expect(fs.readFileSync(path.join(dir, 'agents.v2.json'), 'utf8')).toBe(text);
  });

  it('bounds the history per agent without dropping v1 or the active version', () => {
    const h = new AgentHistory(tmp());
    const behaviour = behaviourOf(draft());
    const entry = (version: number, state: AgentVersion['state']): AgentVersion => ({ agentId: 'agent-a', version, parentVersion: version === 1 ? null : version - 1, behaviour, author: 'user', reason: '', at: version, state });
    for (let v = 1; v <= HISTORY_PER_AGENT + 10; v++) h.commit([entry(v, 'active')], v > 1 ? [{ agentId: 'agent-a', version: v - 1, state: 'superseded' }] : []);
    const kept = h.list('agent-a').map(e => e.version);
    expect(kept).toHaveLength(HISTORY_PER_AGENT);
    expect(kept).toContain(1);
    expect(kept[0]).toBe(HISTORY_PER_AGENT + 10);
    expect(kept).not.toContain(2);
  });

  it('bounds the history in bytes, dropping the oldest superseded versions of any agent', () => {
    const h = new AgentHistory(tmp());
    // Larger than a real entry so a few commits cross the budget (the history does not re-validate text lengths).
    const big = behaviourOf(draft({ instructions: 'x'.repeat(400_000) }));
    const entry = (agentId: string, version: number, state: AgentVersion['state'], at: number): AgentVersion => ({ agentId, version, parentVersion: version === 1 ? null : version - 1, behaviour: big, author: 'user', reason: '', at, state });
    const agents = ['agent-0', 'agent-1', 'agent-2'];
    let at = 0;
    for (const id of agents) h.commit([entry(id, 1, 'active', ++at)]);
    for (let v = 2; v <= 10; v++) for (const id of agents) h.commit([entry(id, v, 'active', ++at)], [{ agentId: id, version: v - 1, state: 'superseded' }]);
    const all = agents.flatMap(id => h.list(id));
    expect(Buffer.byteLength(JSON.stringify({ version: 1, entries: all }, null, 2))).toBeLessThanOrEqual(HISTORY_BYTES);
    for (const id of agents) expect(h.list(id).map(e => e.version)).toEqual(expect.arrayContaining([1, 10]));
    expect(h.list('agent-0').map(e => e.version)).not.toContain(2);
  });

  it('leaves no version behind when the catalog refuses a save, and replaces stale versions of a regenerated agent', () => {
    const dir = tmp(), bytes = Buffer.alloc(250_000);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(64, 16); bytes.writeUInt32BE(64, 20);
    const avatar = { kind: 'image' as const, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
    const c = new AgentCatalogService({ userData: dir, models: choices, imageSize: () => ({ width: 64, height: 64 }) });
    c.save(draft({ avatar }));
    let refused = false;
    for (let i = 0; i < 40 && !refused; i++) { try { c.save(draft({ avatar })); } catch { refused = true; } }
    expect(refused).toBe(true);
    const ids = new Set(c.list().profiles.map(x => x.id));
    const history = json(dir, 'agent-history.json') as { entries: AgentVersion[] };
    expect(history.entries.every(e => ids.has(e.agentId))).toBe(true);
    // agents.v2.json lost: seeds come back as v1 and their stale later versions are dropped.
    const fresh = tmp(), first = service(fresh);
    first.save({ ...draft(), instructions: 'Seconda' }, 'default-general');
    fs.rmSync(path.join(fresh, 'agents.v2.json'));
    const again = service(fresh);
    expect(again.list().problem).toBeNull();
    expect(again.history('default-general').map(v => [v.version, v.state])).toEqual([[1, 'active']]);
  });

  it('keeps v1 edits made by a rolled-back build out of the v2 catalog, which stays the source of truth', () => {
    const dir = tmp(), original = v1Catalog(dir);
    service(dir).save({ ...draft(), name: 'Dopo' }, 'agent-mine');
    expect(fs.readFileSync(path.join(dir, 'agents.json'), 'utf8')).toBe(original);
    fs.writeFileSync(path.join(dir, 'agents.json'), original.replace('"Mio"', '"Durante il rollback"'));
    expect(service(dir).list().profiles.find(x => x.id === 'agent-mine')?.name).toBe('Dopo');
  });
});
