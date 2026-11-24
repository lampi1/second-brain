// app_config area agent key levels (#468, src/main/appctl/config.ts): the Orchestrator reads and sets a role's ordered
// model lists per level (ADR 0347) through the card's own save, models from several engines in one level, the same checks
// as the role page, a feed card with «Annulla», and an undo that sets the stored lists back. The Orchestrator has Base
// only, and its chat starts on the first model of that list on its own engine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import { configTool, type ConfigDeps } from '../../src/main/appctl/config';
import { ConfigStore } from '../../src/main/brain/config';
import { feedAction } from '../../src/main/brain/live';
import { modelRow } from '../../src/main/brain/routing';
import type { AgentModelChoice } from '../../src/shared/agents';
import type { Effort } from '../../src/shared/contract';
import { tmpDir } from './brain/helpers';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const engine = (id: string, ids: string[], efforts?: Effort[]): AgentModelChoice => ({ engine: id, label: id, enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed',
  models: ids.map(m => ({ id: m, name: m, ...(efforts ? { efforts } : {}) })), installed: true, authenticated: true });

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-levels-')); roots.push(dir);
  const c = new AgentCatalogService({ userData: dir, models: () => [engine('claude', ['m-low', 'm-mid', 'm-top'], ['low', 'medium', 'high']), engine('cursor', ['c-1']), engine('opencode', ['openai/gpt-x'])],
    tierModel: () => 'm-mid' });
  const scout = c.list().profiles.find(p => p.id === 'scout')!;
  c.save({ instructions: scout.instructions, engine: 'claude', model: 'm-mid', effort: 'medium', tools: scout.tools, permissionCeiling: scout.permissionCeiling,
    tier: scout.tier, tierMax: scout.tierMax, launches: scout.launches, skills: scout.skills }, 'scout');
  const cards: unknown[] = [];
  const store = new ConfigStore(tmpDir(), {});
  const d: ConfigDeps = { callerId: 'orch-1', userAsked: () => true,
    brain: { settings: () => store.get(), settingsSchema: () => store.schema(), settingsHistory: n => store.history(n), undoSetting: (id, by = 'user', o) => store.undo(id, { by, ...o }), requestSetting: (k, v, o) => store.request(k, v, o) },
    agents: { list: () => c.list(), save: (draft, id, reason) => c.save(draft, id, reason), history: id => c.history(id), restore: (id, v) => c.restoreVersion(id, v), presetsOf: p => c.presetsOf(p), levelsOf: p => c.levelsFor(p) },
    announce: e => cards.push(e) };
  const run = (a: Record<string, unknown>) => Promise.resolve().then(() => configTool(d).run(a));
  const card = (id = 'scout') => c.list().profiles.find(p => p.id === id)!;
  return { c, run, card, cards };
}
const set = (value: unknown, agentId = 'scout') => ({ action: 'set', area: 'agent', agentId, key: 'levels', value });

describe('app_config: a role\'s model lists per level', () => {
  it('set saves lists from several engines, get returns them, the head of Base is the card\'s model', async () => {
    const { run, card, cards } = setup();
    const r = await run(set({ base: [{ engine: 'cursor', model: 'c-1' }, { engine: 'claude', model: 'm-mid', effort: 'high' }], max: [{ engine: 'claude', model: 'm-top', effort: 'high' }, { engine: 'opencode', model: 'openai/gpt-x', effort: 'xhigh' }] })) as { changed: string; undo: { key: string; value: unknown } };
    expect(r.changed).toBe('levels');
    expect(card().levels?.base).toEqual([{ engine: 'cursor', model: 'c-1' }, { engine: 'claude', model: 'm-mid', effort: 'high' }]);
    expect(card().levels?.max?.[1]).toEqual({ engine: 'opencode', model: 'openai/gpt-x', effort: 'xhigh' });
    expect(card().engine).toBe('cursor');
    expect(card().model).toBe('c-1');
    const [scout] = await run({ action: 'get', area: 'agent', agentId: 'scout' }) as { levels: Record<string, unknown[]> }[];
    expect(scout!.levels.base).toHaveLength(2);
    expect(scout!.levels.min).toHaveLength(1); // follows Base's card preset
    // the change's card with its «Annulla», which the feed accepts
    expect(cards).toHaveLength(1);
    const action = (cards[0] as { action: unknown }).action;
    expect(feedAction(action)).toMatchObject({ kind: 'levels-undo', agentId: 'scout', levels: { base: [{ engine: 'claude', model: 'm-mid', effort: 'medium' }] } });
    // undo = set the stored lists back
    expect(r.undo.key).toBe('levels');
    await run(set(r.undo.value));
    expect(card().engine).toBe('claude');
    expect(card().model).toBe('m-mid');
    expect(card().levels?.max).toBeUndefined();
  });

  it('a level left out keeps its list; [] sends Massimo back to following Base', async () => {
    const { run, card } = setup();
    await run(set({ max: [{ engine: 'claude', model: 'm-top' }] }));
    await run(set(JSON.stringify({ min: [{ engine: 'claude', model: 'm-low' }] })));
    expect(card().levels?.max).toEqual([{ engine: 'claude', model: 'm-top' }]);
    expect(card().levels?.min).toEqual([{ engine: 'claude', model: 'm-low' }]);
    await run(set({ max: [] }));
    expect(card().levels?.max).toBeUndefined();
  });

  it('refuses what the page refuses: duplicates, more than 8, unknown models, an effort the model does not take', async () => {
    const { run } = setup();
    await expect(run(set({ base: [{ engine: 'claude', model: 'm-mid' }, { engine: 'claude', model: 'm-mid' }] }))).rejects.toThrow(/già nella lista/);
    await expect(run(set({ max: Array.from({ length: 9 }, (_, i) => ({ engine: 'claude', model: `m-${i}` })) }))).rejects.toThrow(/al massimo 8/);
    await expect(run(set({ base: [{ engine: 'claude', model: 'nope' }] }))).rejects.toThrow(/non è tra quelli noti/);
    await expect(run(set({ base: [{ engine: 'claude', model: 'm-top', effort: 'max' }] }))).rejects.toThrow(/non prende l’effort max/);
    await expect(run(set({ base: [] }))).rejects.toThrow(/base/i);
  });

  it('the Orchestrator: Base only, and its chat starts on the first model of the list on its engine', async () => {
    const { run, c } = setup();
    await expect(run(set({ max: [{ engine: 'claude', model: 'm-top' }] }, 'orchestrator'))).rejects.toThrow(/solo Base/);
    await run(set({ base: [{ engine: 'claude', model: 'm-top', effort: 'high' }, { engine: 'opencode', model: 'openai/gpt-x', effort: 'xhigh' }] }, 'orchestrator'));
    const onOpen = c.resolve({ harness: 'opencode', cwd: '', orchestrator: true } as never);
    expect(onOpen.request).toMatchObject({ model: 'openai/gpt-x', effort: 'xhigh' });
    const onClaude = c.resolve({ harness: 'claude', cwd: '', orchestrator: true } as never);
    expect(onClaude.request).toMatchObject({ model: 'm-top', effort: 'high' });
    const [o] = await run({ action: 'get', area: 'agent', agentId: 'orchestrator' }) as { levels: Record<string, unknown> }[];
    expect(Object.keys(o!.levels)).toEqual(['base']);
  });
});

describe('the registry row of a provider-prefixed model (OpenCode)', () => {
  it('openai/gpt-x reads the gpt-x row (its efforts and price)', () => {
    const reg = { models: [{ id: 'gpt-x', efforts: ['low', 'high'] }] } as never;
    expect(modelRow('openai/gpt-x', reg)).toMatchObject({ id: 'gpt-x' });
    expect(modelRow('openai/none', reg)).toBeNull();
  });
});
