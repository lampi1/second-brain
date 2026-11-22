// The role card's three presets in the catalog (main/agents/catalog.ts, ADR 0336): an old card reads as Base only (the
// migration), a save checks each preset against its engine and the order by price, an engine change drops them, an
// older version keeps today's presets, and resolve()/presetChoice() apply the delegation guards with the one price table.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import type { AgentModelChoice, AgentProfile } from '../../../src/shared/agents';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const engine = (id: string, ids: string[]): AgentModelChoice => ({ engine: id, label: id, enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed',
  models: ids.map(m => ({ id: m, name: m })), installed: true, authenticated: true });
const PRICE: Record<string, number> = { 'm-low': 1, 'm-mid': 5, 'm-top': 20, 'gpt-x': 3 };
function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-catalog-presets-')); roots.push(dir);
  return new AgentCatalogService({ userData: dir, models: () => [engine('claude', ['m-low', 'm-mid', 'm-top']), engine('codex', ['gpt-x'])],
    tierModel: (_e, tier) => (tier === 'top' ? 'm-top' : 'm-mid'), price: m => PRICE[m] ?? null });
}
const edit = (p: AgentProfile, patch: Partial<AgentProfile>) => ({ instructions: p.instructions, engine: p.engine, model: p.model, tools: p.tools, permissionCeiling: p.permissionCeiling,
  tier: p.tier, tierMax: p.tierMax, launches: p.launches, skills: p.skills, ...(p.presets ? { presets: p.presets } : {}), ...patch });
const role = (c: AgentCatalogService, id = 'scout') => c.list().profiles.find(p => p.id === id)!;
const onClaude = (c: AgentCatalogService) => c.save(edit(role(c), { engine: 'claude', model: 'm-mid' }), 'scout');

describe('the migration: a card without presets', () => {
  it('reads Minimo and Massimo as its Base', () => {
    const c = make(), p = onClaude(c);
    expect(p.presets).toBeUndefined();
    const all = c.presetsOf(p);
    expect(all.min).toEqual(all.base);
    expect(all.max).toEqual(all.base);
    expect(all.base.model).toBe('m-mid');
  });
});

describe('saving the presets', () => {
  it('keeps Minimo and Massimo on the card and survives a restart', () => {
    const c = make(); onClaude(c);
    const p = c.save(edit(role(c), { presets: { min: { model: 'm-low', effort: 'low' }, max: { model: 'm-top', effort: 'high' } } }), 'scout');
    expect(c.presetsOf(p)).toMatchObject({ min: { model: 'm-low', effort: 'low' }, base: { model: 'm-mid' }, max: { model: 'm-top', effort: 'high' } });
    expect(role(c).presets).toEqual(p.presets);
  });
  it('refuses a model the engine does not know, and an order against the price', () => {
    const c = make(); onClaude(c);
    expect(() => c.save(edit(role(c), { presets: { max: { model: 'gpt-x' } } }), 'scout')).toThrow(/Preset Massimo: il modello «gpt-x» non è tra quelli noti del motore claude/);
    expect(() => c.save(edit(role(c), { presets: { min: { model: 'm-top' } } }), 'scout')).toThrow(/Minimo costa più del Base/);
    expect(() => c.save(edit(role(c), { presets: { max: { model: 'm-low' } } }), 'scout')).toThrow(/Massimo costa meno del Base/);
  });
  it('drops the presets when the engine changes and they were carried along', () => {
    const c = make(); onClaude(c);
    c.save(edit(role(c), { presets: { max: { model: 'm-top' } } }), 'scout');
    const p = c.save(edit(role(c), { engine: 'codex', model: 'gpt-x' }), 'scout');
    expect(p.presets).toBeUndefined();
    expect(c.presetsOf(p).max.model).toBe('gpt-x');
  });
  it('an older version keeps today\'s presets (they change in place, like the model)', () => {
    const c = make(); onClaude(c);
    c.save(edit(role(c), { instructions: role(c).instructions + ' v2' }), 'scout');
    const v = role(c).activeVersion;
    c.save(edit(role(c), { presets: { max: { model: 'm-top' } }, instructions: role(c).instructions + ' v3' }), 'scout');
    const back = c.restoreVersion('scout', v);
    expect(back.presets).toEqual({ max: { model: 'm-top' } });
  });
});

describe('resolve and presetChoice: the guards on a real card', () => {
  const ready = () => { const c = make(); onClaude(c); c.save(edit(role(c), { presets: { min: { model: 'm-low', effort: 'low' }, max: { model: 'm-top', effort: 'high' } } }), 'scout'); return c; };
  it('Massimo with a reason runs the Massimo model; without a reason, Base and a warning', () => {
    const c = ready();
    expect(c.resolve({ harness: 'claude', cwd: '/x', roleId: 'scout', preset: 'max', presetWhy: 'migrazione' }).request).toMatchObject({ model: 'm-top', effort: 'high' });
    const r = c.resolve({ harness: 'claude', cwd: '/x', roleId: 'scout', preset: 'max' });
    expect(r.request.model).toBe('m-mid');
    expect(r.presetChoice?.warnings[0]).toMatch(/without presetWhy/);
  });
  it('never above the delegator\'s own model, across engines too', () => {
    const c = ready();
    const capped = c.presetChoice('scout', { preset: 'max', presetWhy: 'x' }, { role: 'orchestrator', model: 'm-mid' });
    expect(capped).toMatchObject({ preset: 'base', model: 'm-mid', asked: 'max', delegatorRole: 'orchestrator' });
    expect(capped.warnings[0]).toMatch(/costs more than your own model/);
    expect(c.presetChoice('scout', { preset: 'max', presetWhy: 'x' }, { model: 'gpt-x' })).toMatchObject({ preset: 'min', model: 'm-low', effort: 'low' });
  });
  it('the old tier is read as a preset relative to the card', () => {
    const c = ready();
    const r = c.resolve({ harness: 'claude', cwd: '/x', roleId: 'scout', tier: 'light' });
    expect(r.presetChoice?.preset).toBe('base');
    expect(r.presetChoice?.asked).toBe('min');
  });
});
