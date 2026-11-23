// app_config area agent key presets (src/main/appctl/config.ts, ADR 0336): the Orchestrator reads and sets a role card's
// Minimo/Base/Massimo through the card's own save (the real AgentCatalogService, its preset checks), with the same
// refusals the card shows and an undo that sets the "before" value back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import { configTool, type ConfigDeps } from '../../src/main/appctl/config';
import { ConfigStore } from '../../src/main/brain/config';
import type { AgentModelChoice, AgentProfile } from '../../src/shared/agents';
import { tmpDir } from './brain/helpers';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const engine = (id: string, ids: string[]): AgentModelChoice => ({ engine: id, label: id, enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed',
  models: ids.map(m => ({ id: m, name: m })), installed: true, authenticated: true });
const PRICE: Record<string, number> = { 'm-low': 1, 'm-mid': 5, 'm-top': 20, 'gpt-x': 3 };

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-presets-')); roots.push(dir);
  const c = new AgentCatalogService({ userData: dir, models: () => [engine('claude', ['m-low', 'm-mid', 'm-top']), engine('codex', ['gpt-x'])],
    tierModel: (_e, tier) => (tier === 'top' ? 'm-top' : 'm-mid'), price: m => PRICE[m] ?? null });
  const scout = c.list().profiles.find(p => p.id === 'scout')!;
  c.save({ instructions: scout.instructions, engine: 'claude', model: 'm-mid', effort: 'medium', tools: scout.tools, permissionCeiling: scout.permissionCeiling,
    tier: scout.tier, tierMax: scout.tierMax, launches: scout.launches, skills: scout.skills }, 'scout');
  const store = new ConfigStore(tmpDir(), {});
  const d: ConfigDeps = { callerId: 'orch-1', userAsked: () => true,
    brain: { settings: () => store.get(), settingsSchema: () => store.schema(), settingsHistory: n => store.history(n), undoSetting: (id, by = 'user', o) => store.undo(id, { by, ...o }), requestSetting: (k, v, o) => store.request(k, v, o) },
    agents: { list: () => c.list(), save: (draft, id, reason) => c.save(draft, id, reason), history: id => c.history(id), restore: (id, v) => c.restoreVersion(id, v), presetsOf: p => c.presetsOf(p) } };
  const run = (a: Record<string, unknown>) => Promise.resolve().then(() => configTool(d).run(a));
  const card = () => c.list().profiles.find(p => p.id === 'scout')!;
  return { c, run, card };
}
const set = (value: unknown) => ({ action: 'set', area: 'agent', agentId: 'scout', key: 'presets', value });
const BASE = { model: 'm-mid', effort: 'medium' };

describe('app_config: a role card\'s presets', () => {
  it('get returns the three presets of every role (Minimo and Massimo = Base on a card without them)', async () => {
    const { run } = setup();
    const all = await run({ action: 'get', area: 'agent' }) as { id: string; presets: Record<string, unknown> }[];
    expect(all.length).toBeGreaterThan(1);
    for (const r of all) expect(Object.keys(r.presets)).toEqual(['min', 'base', 'max']);
    const [scout] = await run({ action: 'get', area: 'agent', agentId: 'scout' }) as { presets: unknown }[];
    expect(scout!.presets).toEqual({ min: BASE, base: BASE, max: BASE });
  });

  it('set saves Minimo and Massimo on the card through its save, with the before value as the undo', async () => {
    const { run, card } = setup();
    const r = await run(set({ min: { model: 'm-low', effort: 'low' }, base: BASE, max: { model: 'm-top', effort: 'high' } })) as { changed: string; before: unknown; after: unknown; undo: { key?: string; value?: unknown } };
    expect(card().presets).toEqual({ min: { model: 'm-low', effort: 'low' }, max: { model: 'm-top', effort: 'high' } });
    expect(r.changed).toBe('presets');
    expect(r.before).toEqual({ min: BASE, base: BASE, max: BASE });
    expect(r.after).toEqual({ min: { model: 'm-low', effort: 'low' }, base: BASE, max: { model: 'm-top', effort: 'high' } });
    expect(r.undo).toMatchObject({ key: 'presets', value: r.before });
    // the card's change log: the version in use, amended with the Orchestrator's reason (in place, like the model)
    const h = await run({ action: 'history', area: 'agent', agentId: 'scout' }) as { amended?: string[] }[];
    expect(h.at(-1)!.amended?.at(-1)).toMatch(/Modificato dall’Orchestrator/);
    // a JSON string is read too (an agent that sends the value as text)
    await run(set(JSON.stringify({ base: BASE, max: { model: 'm-top' } })));
    expect(card().presets).toEqual({ max: { model: 'm-top' } });
  });

  it('undo: setting the "before" value back gives the card its old presets', async () => {
    const { run, card } = setup();
    const r = await run(set({ base: BASE, max: { model: 'm-top', effort: 'high' } })) as { undo: { value: unknown } };
    expect(card().presets).toBeDefined();
    await run(set(r.undo.value));
    const [scout] = await run({ action: 'get', area: 'agent', agentId: 'scout' }) as { presets: unknown }[];
    expect(scout!.presets).toEqual({ min: BASE, base: BASE, max: BASE });
  });

  it('refuses a missing base, a base other than the card\'s model, another engine and an unknown model', async () => {
    const { run, card } = setup();
    await expect(run(set({ max: { model: 'm-top' } }))).rejects.toThrow(/manca base/);
    await expect(run(set({ base: { model: 'm-top', effort: 'medium' }, max: { model: 'm-top' } }))).rejects.toThrow(/base deve restare il modello e l'effort della scheda \(m-mid \/ medium\)/);
    await expect(run(set({ base: { model: 'm-mid' }, max: { model: 'm-top' } }))).rejects.toThrow(/base deve restare/);
    await expect(run(set({ engine: 'codex', base: BASE, max: { model: 'gpt-x' } }))).rejects.toThrow(/solo sul motore claude/);
    await expect(run(set({ base: BASE, max: { model: 'gpt-x' } }))).rejects.toThrow(/Preset Massimo: il modello «gpt-x» non è tra quelli noti del motore claude/);
    await expect(run(set({ base: BASE, max: { model: 'nope-1' } }))).rejects.toThrow(/non è tra quelli noti/);
    await expect(run(set({ base: BASE, mid: { model: 'm-top' } }))).rejects.toThrow(/«mid» non è un preset/);
    await expect(run(set({ base: BASE, min: { model: 'm-top' } }))).rejects.toThrow(/Minimo costa più del Base/);
    await expect(run(set('not json'))).rejects.toThrow(/un oggetto/);
    expect(card().presets).toBeUndefined();
  });

  it('needs the user\'s ask, like every role change', async () => {
    const { c } = setup();
    const d = { callerId: 'orch-1', userAsked: () => false, brain: {} as ConfigDeps['brain'],
      agents: { list: () => c.list(), save: (dr: never, id: string) => c.save(dr, id), history: () => [], restore: (() => ({})) as unknown as (id: string, v: number) => AgentProfile } } as ConfigDeps;
    await expect(Promise.resolve().then(() => configTool(d).run(set({ base: BASE, max: { model: 'm-top' } })))).rejects.toThrow(/bloccato/);
  });
});
