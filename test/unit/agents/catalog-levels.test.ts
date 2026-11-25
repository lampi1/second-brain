// Several models per level across engines in the catalog (main/agents/catalog.ts, ADR 0347): a save checks each model
// against its engine and keeps the card's own model as the head of Base, resolve() starts on the first model of the
// level whose engine is on and whose plan has room, the user's pick is any model of the levels, and every role may do
// everything (no stored narrowing survives a load or a save).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import type { AgentModelChoice, AgentProfile } from '../../../src/shared/agents';
import type { Room } from '../../../src/shared/model-levels';
import { ALL_TOOLS } from '../../../src/shared/roles';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const engine = (id: string, ids: string[], enabled = true): AgentModelChoice => ({ engine: id, label: id, enabled, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed',
  models: ids.map(m => ({ id: m, name: m })), installed: true, authenticated: true });
function make(o: { room?: Record<string, Room['state']>; off?: string[]; block?: string[] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-catalog-levels-')); roots.push(dir);
  return new AgentCatalogService({ userData: dir,
    models: () => [engine('claude', ['m-low', 'm-mid', 'm-top'], !o.off?.includes('claude')), engine('codex', ['gpt-x'], !o.off?.includes('codex')), engine('cursor', ['comp'], !o.off?.includes('cursor'))],
    tierModel: (_e, tier) => (tier === 'top' ? 'm-top' : 'm-mid'),
    room: e => ({ state: o.room?.[e] ?? 'ok', why: o.room?.[e] ?? '', resetsAt: null }),
    engineBlock: e => o.block?.includes(e) ? 'refused to agents' : null });
}
const edit = (p: AgentProfile, patch: Partial<AgentProfile>) => ({ instructions: p.instructions, engine: p.engine, model: p.model, tools: p.tools, permissionCeiling: p.permissionCeiling,
  tier: p.tier, tierMax: p.tierMax, launches: p.launches, skills: p.skills, ...patch });
const role = (c: AgentCatalogService, id = 'artisan') => c.list().profiles.find(p => p.id === id)!;
const LEVELS = {
  min: [{ engine: 'cursor', model: 'comp' }, { engine: 'claude', model: 'm-low', effort: 'low' as const }],
  base: [{ engine: 'claude', model: 'm-mid', effort: 'medium' as const }, { engine: 'codex', model: 'gpt-x' }],
  max: [{ engine: 'claude', model: 'm-top', effort: 'high' as const }],
};
const withLevels = (c: AgentCatalogService) => c.save(edit(role(c), { levels: LEVELS }), 'artisan');
const start = (c: AgentCatalogService, extra: Record<string, unknown> = {}) => c.resolve({ harness: 'claude', cwd: os.tmpdir(), roleId: 'artisan', ...extra } as never);

describe('saving the levels', () => {
  it('keeps the lists and makes the head of Base the card\'s own model', () => {
    const c = make(), p = withLevels(c);
    expect(p.levels).toEqual(LEVELS);
    expect([p.engine, p.model, p.effort]).toEqual(['claude', 'm-mid', 'medium']);
    // Massimo's head is on the card's engine: it is the card's preset too; Minimo's is on Cursor, so none
    expect(p.presets).toEqual({ max: { model: 'm-top', effort: 'high' } });
    expect(c.presetsOf(p).min.model).toBe('comp');
  });
  it('refuses a model its engine does not know, and an unknown engine', () => {
    const c = make();
    expect(() => c.save(edit(role(c), { levels: { max: [{ engine: 'codex', model: 'm-mid' }] } }), 'artisan')).toThrow(/Massimo: il modello «m-mid» non è tra quelli noti di codex/);
    expect(() => c.save(edit(role(c), { levels: { min: [{ engine: 'kimi', model: null }] } }), 'artisan')).toThrow(/kimi non è disponibile/);
  });
  it('a change of the card\'s own model moves the head of Base with it', () => {
    const c = make(); withLevels(c);
    const p = c.save(edit(role(c), { model: 'm-top' }), 'artisan');
    expect(p.levels?.base?.map(x => x.model)).toEqual(['m-top', 'gpt-x']);
  });
});

describe('starting a chat', () => {
  it('starts on the first model of the level with room', () => {
    const c = make(); withLevels(c);
    const r = start(c);
    expect([r.request.harness, r.request.model]).toEqual(['claude', 'm-mid']);
    expect(r.presetChoice?.engine).toBe('claude');
  });
  it('a plan on pace or spent moves the start to the next engine, and says why', () => {
    const c = make({ room: { claude: 'pace' } }); withLevels(c);
    const r = start(c);
    expect([r.request.harness, r.request.model, r.owner.engine]).toEqual(['codex', 'gpt-x', 'codex']);
    expect(r.presetChoice?.route).toBe('codex gpt-x: claude sta per finire il limite');
    expect(r.presetChoice?.skipped?.[0]).toMatchObject({ engine: 'claude', model: 'm-mid', kind: 'credit' });
  });
  it('an engine off or refused to agents is never picked; none usable is an error that says so', () => {
    expect(start((() => { const c = make({ off: ['claude'] }); withLevels(c); return c; })()).request.harness).toBe('codex');
    expect(start((() => { const c = make({ block: ['claude'] }); withLevels(c); return c; })()).request.harness).toBe('codex');
    const none = make({ off: ['claude', 'codex'] }); withLevels(none);
    expect(() => start(none)).toThrow(/Nessun modello del livello base di Artisan può partire/);
  });
  it('the Minimo level starts on Cursor', () => {
    const c = make(); withLevels(c);
    const r = start(c, { preset: 'min', presetWhy: 'a quick read' });
    expect([r.request.harness, r.request.model]).toEqual(['cursor', 'comp']);
  });
  it('the user\'s pick is any model of the levels, on its own engine', () => {
    const c = make(); withLevels(c);
    const r = start(c, { userModel: { engine: 'codex', model: 'gpt-x' } });
    expect([r.request.harness, r.request.model, r.presetChoice?.preset]).toEqual(['codex', 'gpt-x', 'base']);
    expect(() => start(c, { userModel: { engine: 'claude', model: 'gpt-x' } })).toThrow(/non è tra i modelli dei suoi livelli/);
  });
  it('levelRoute says what each level would start on now', () => {
    const c = make({ room: { claude: 'out' } }); withLevels(c);
    const r = c.levelRoute('artisan');
    expect(r.base).toMatchObject({ engine: 'codex', model: 'gpt-x', state: 'ok' });
    // every plan of the level is spent: it would start there and wait for the renewal (ADR 0354), and the page says so
    expect(r.max).toMatchObject({ engine: 'claude', state: 'out', reason: 'claude m-top: tutti i motori del livello sono al limite' });
  });
});

describe('permissions: everything, always', () => {
  it('a narrowed role is widened on save and its chats get no policy', () => {
    const c = make();
    const p = c.save(edit(role(c), { tools: { allow: ['read'] }, permissionCeiling: 'plan' }), 'artisan');
    expect(p.tools?.allow).toEqual([...ALL_TOOLS]);
    expect(p.permissionCeiling).toBeNull();
    expect(start(c).policy).toBeNull();
  });
});

describe('review fixes', () => {
  it('a change of engine without lists drops the old engine\'s model from the Base head instead of refusing', () => {
    const c = make(); withLevels(c);
    const p = c.save(edit(role(c), { engine: 'codex', model: 'm-mid', effort: undefined }), 'artisan');
    expect(p.levels?.base?.[0]).toMatchObject({ engine: 'codex', model: null });
  });
  it('the first lists save keeps a card model the engine list does not name (an alias)', () => {
    const c = make();
    const fs2 = c as unknown as { profiles: AgentProfile[] };
    fs2.profiles = fs2.profiles.map(p => p.id === 'artisan' ? { ...p, model: 'sonnet' } : p);
    const p = c.save(edit(role(c), { levels: { base: [{ engine: 'claude', model: 'sonnet' }, { engine: 'codex', model: 'gpt-x' }] } }), 'artisan');
    expect(p.levels?.base?.[0]?.model).toBe('sonnet');
  });
  it('a preset changed without lists moves the head of that level', () => {
    const c = make(); withLevels(c);
    c.save(edit(role(c), { levels: { ...LEVELS, max: [{ engine: 'claude', model: 'm-top' }, { engine: 'codex', model: 'gpt-x' }] } }), 'artisan');
    const p = c.save(edit(role(c), { presets: { max: { model: 'm-low' } } }), 'artisan');
    expect(p.levels?.max?.map(x => x.model)).toEqual(['m-low', 'gpt-x']);
  });
  it('a model left to the engine reads as the role\'s tier model, and levelRoute says its index', () => {
    const c = make();
    c.save(edit(role(c), { levels: { base: [{ engine: 'claude', model: null }] } }), 'artisan');
    expect(c.levelRoute('artisan').base).toMatchObject({ model: 'm-mid', index: 0 });
  });
  it('a fallback takes its own effort, not the head\'s', () => {
    const c = make({ room: { claude: 'out' } }); withLevels(c);
    const r = start(c);
    expect(r.request.model).toBe('gpt-x');
    expect(r.request.effort).toBeUndefined();
    expect(r.presetChoice?.effort).toBeUndefined();
  });
});
