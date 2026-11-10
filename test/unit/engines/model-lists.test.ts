// The live model lists (src/main/engines/model-lists.ts, ADR 0256): for every engine kind (Claude Code, Codex, an ACP
// CLI such as Cursor, whose live list is its chats', an HTTP engine) the live path (its own source answers), the cached path (the source fails after
// a list was saved: the list stays) and the fallback path (no list yet: the brain's models.json rows); the parsers of
// each source; the read side (withApiModels) that falls back to models.json and adds the Models API's new Claude
// models; and routing taking a model models.json does not know. Fake channels only: no process, no network.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ModelsSeen, SeenModel } from '../../../src/shared/contract';
import { acpModels, claudeModels, codexModels, httpModels, ModelLists, type LineChannel, type ModelListDeps } from '../../../src/main/engines/model-lists';
import { ModelsSeenStore } from '../../../src/main/brain/models-seen';
import { engineOf } from '../../../src/main/engines/registry';
import { withApiModels } from '../../../src/main/engines/sessions';
import { setPriceTable } from '../../../src/main/chats/live-cost';
import { resolve } from '../../../src/main/brain/routing';
import { TEST_REGISTRY } from '../../fixtures/model-registry';
import { log } from '../../../src/main/log';
import { tmpDir } from '../brain/helpers';

type Obj = Record<string, unknown>;

/** A CLI that answers each request it is sent with `answer(msg)` (undefined = never answers). */
function fakeCli(answer: (msg: Obj) => Obj | undefined): LineChannel & { sent: Obj[]; closed: boolean } {
  const out: Obj[] = [];
  const ch = {
    sent: [] as Obj[], closed: false,
    send(msg: Obj) { ch.sent.push(msg); const a = answer(msg); if (a) out.push(a); },
    reply(match: (m: Obj) => boolean) {
      const hit = out.find(match);
      return hit ? Promise.resolve(hit) : Promise.reject(new Error('nessuna risposta'));
    },
    close() { ch.closed = true; },
  };
  return ch;
}

const CLAUDE_INIT = { models: [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'claude-fable-5-2', resolvedModel: 'claude-fable-5-2', displayName: 'Fable 5.2', supportsEffort: true, supportedEffortLevels: ['low', 'high', 'max', 'turbo'] },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
] };
const claudeCli = (models: unknown = CLAUDE_INIT.models) => fakeCli(m => m.type === 'control_request'
  ? { type: 'control_response', response: { subtype: 'success', request_id: (m as { request_id: string }).request_id, response: { models } } } : undefined);
const codexCli = (data: unknown[]) => fakeCli(m => m.method === 'initialize' ? { id: m.id, result: { userAgent: 'codex_cli_rs/1.0.0' } }
  : m.method === 'model/list' ? { id: m.id, result: { data } } : undefined);
const acpCli = (session: Obj) => fakeCli(m => m.method === 'initialize' ? { jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1 } }
  : m.method === 'session/new' ? { jsonrpc: '2.0', id: m.id, result: session } : undefined);

const ids = (l: readonly SeenModel[] | undefined) => (l ?? []).map(m => m.id);

/** A ModelLists on a temp store, with one opener per engine and a fetch. */
function lists(over: Partial<ModelListDeps> & { open?: ModelListDeps['open'] }) {
  const store = new ModelsSeenStore(path.join(tmpDir(), 'engine-models.json'));
  const changed = vi.fn();
  const deps: ModelListDeps = {
    engines: () => ['claude', 'codex', 'cursor', 'anthropic'].map(id => engineOf(id)!).filter(Boolean),
    open: () => ({ error: 'non installata' }), fetchJson: () => Promise.reject(new Error('offline')), key: () => null,
    store, registry: e => TEST_REGISTRY.models.filter(m => m.harness === e.id), appVersion: '0.1.0', changed, ...over,
  };
  return { m: new ModelLists(deps), store, changed };
}

describe('the parsers of each live source', () => {
  it('Claude Code initialize: aliases under their real id, names without «recommended», only known efforts', () => {
    expect(claudeModels(CLAUDE_INIT.models)).toEqual([
      { id: 'claude-opus-5-5', name: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { id: 'claude-fable-5-2', name: 'Fable 5.2', efforts: ['low', 'high', 'max'] },
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', efforts: [] },
    ]);
    expect(claudeModels(null)).toEqual([]);
  });

  it('Codex model/list, ACP session/new (models or OpenCode configOptions), HTTP /models', () => {
    expect(codexModels({ data: [{ model: 'gpt-6-codex', displayName: 'GPT-6 Codex' }, { id: 'old', hidden: true }, { id: 'o9' }] }))
      .toEqual([{ id: 'gpt-6-codex', name: 'GPT-6 Codex' }, { id: 'o9', name: 'o9' }]);
    expect(acpModels({ models: { availableModels: [{ modelId: 'grok-5', name: 'Grok 5' }] } })).toEqual([{ id: 'grok-5', name: 'Grok 5' }]);
    expect(acpModels({ configOptions: [{ id: 'model', category: 'model', options: [{ value: 'openrouter/kimi-k3', name: 'Kimi K3' }] }] }))
      .toEqual([{ id: 'openrouter/kimi-k3', name: 'Kimi K3' }]);
    expect(httpModels({ data: [{ id: 'claude-fable-5-2', display_name: 'Claude Fable 5.2', max_input_tokens: 1_000_000 }, { id: 'x', context_length: 'big' }] }))
      .toEqual([{ id: 'claude-fable-5-2', name: 'Claude Fable 5.2', contextWindow: 1_000_000 }, { id: 'x', name: 'x' }]);
  });
});

describe('each harness: live, cached, fallback', () => {
  it('Claude: live from Claude Code, the CLI closed after; a later failure keeps the list; with none, models.json', async () => {
    const ch = claudeCli();
    const a = lists({ engines: () => [engineOf('claude')!], open: () => ch });
    expect(await a.m.refresh()).toEqual([{ engine: 'claude', ok: true, count: 3 }]);
    expect(ids(a.store.get().claude?.ids)).toContain('claude-fable-5-2');
    expect(ch.closed).toBe(true);
    expect(ch.sent[0]).toMatchObject({ type: 'control_request', request: { subtype: 'initialize' } }); // never a prompt
    expect(ch.sent).toHaveLength(1);
    expect(a.changed).toHaveBeenCalledTimes(1);

    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const failing = new ModelLists({ ...(a.m as unknown as { d: ModelListDeps }).d, open: () => claudeCli('broken') });
    expect(await failing.refresh()).toEqual([{ engine: 'claude', ok: false, count: 3, error: 'la sorgente non ha elencato modelli', using: 'cache' }]);
    expect(ids(a.store.get().claude?.ids)).toContain('claude-fable-5-2');
    expect(warn).toHaveBeenCalledWith('engines', 'model list not refreshed', expect.objectContaining({ data: { engine: 'claude', using: 'cache' } }));

    const fresh = lists({ engines: () => [engineOf('claude')!] });
    expect(await fresh.m.refresh()).toEqual([{ engine: 'claude', ok: false, count: TEST_REGISTRY.models.filter(m => m.harness === 'claude').length, error: 'non installata', using: 'registry' }]);
    expect(fresh.store.get()).toEqual({});
    expect(fresh.changed).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('Codex: live from model/list after initialize; cached; fallback none (models.json has no Codex row)', async () => {
    const a = lists({ engines: () => [engineOf('codex')!], open: () => codexCli([{ model: 'gpt-6-codex', displayName: 'GPT-6 Codex' }]) });
    expect(await a.m.refresh()).toEqual([{ engine: 'codex', ok: true, count: 1 }]);
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const failing = new ModelLists({ ...(a.m as unknown as { d: ModelListDeps }).d, open: () => fakeCli(() => undefined) });
    expect(await failing.refresh('codex')).toMatchObject([{ engine: 'codex', ok: false, count: 1, using: 'cache' }]);
    expect(ids(a.store.get().codex?.ids)).toEqual(['gpt-6-codex']);
    const fresh = lists({ engines: () => [engineOf('codex')!], open: () => fakeCli(m => (m.method === 'initialize' ? { id: m.id, error: { message: 'not logged in' } } : undefined)) });
    expect(await fresh.m.refresh()).toEqual([{ engine: 'codex', ok: false, count: 0, error: 'initialize: not logged in', using: 'none' }]);
    warn.mockRestore();
  });

  it('Cursor (ACP): live from its chat\'s session/new (never started only to ask); cached; fallback to models.json', async () => {
    const open = vi.fn(() => acpCli({}));
    const a = lists({ engines: () => [engineOf('cursor')!], open });
    // the live source: a Cursor chat's session/new, recorded by the chat manager (wiring.ts onModels)
    a.store.record('cursor', acpModels({ sessionId: 's1', models: { availableModels: [{ modelId: 'grok-5', name: 'Grok 5' }, { modelId: 'composer-3', name: 'Composer 3' }] } }));
    expect(ids(withApiModels(a.store.get()).cursor?.ids)).toEqual(['grok-5', 'composer-3']);
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(await a.m.refresh()).toMatchObject([{ engine: 'cursor', ok: false, count: 2, using: 'cache' }]);
    expect(open).not.toHaveBeenCalled(); // rule 4: `agent` only for Cursor chats
    const fresh = lists({ engines: () => [engineOf('cursor')!] });
    expect(await fresh.m.refresh()).toMatchObject([{ engine: 'cursor', ok: false, count: 1, using: 'registry' }]);
    warn.mockRestore();
  });

  it('closes a CLI still answering when the app quits', async () => {
    const ch = fakeCli(() => undefined);
    let release: (m: Obj) => void = () => {};
    ch.reply = () => new Promise(r => { release = r; });
    const a = lists({ engines: () => [engineOf('claude')!], open: () => ch });
    const run = a.m.refresh();
    await Promise.resolve();
    a.m.stop();
    expect(ch.closed).toBe(true);
    release({});
    await run;
  });

  it('an HTTP engine: live from the Models API with its own key only; cached; no key = not asked', async () => {
    const fetchJson = vi.fn(async () => ({ data: [{ id: 'claude-fable-5-2', display_name: 'Claude Fable 5.2' }] }));
    const testKey = ['k', 'placeholder'].join('-'); // built at run time: never a key-shaped literal
    const a = lists({ engines: () => [engineOf('anthropic')!], key: h => (h === 'anthropic' ? testKey : null), fetchJson });
    expect(await a.m.refresh()).toEqual([{ engine: 'anthropic', ok: true, count: 1 }]);
    expect(fetchJson).toHaveBeenCalledWith('https://api.anthropic.com/v1/models?limit=1000', { 'x-api-key': testKey, 'anthropic-version': '2023-06-01' });
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const failing = new ModelLists({ ...(a.m as unknown as { d: ModelListDeps }).d, fetchJson: () => Promise.reject(new Error('HTTP 503')) });
    expect(await failing.refresh()).toMatchObject([{ engine: 'anthropic', ok: false, count: 1, using: 'cache', error: 'HTTP 503' }]);
    const noKey = lists({ engines: () => [engineOf('anthropic')!], fetchJson });
    fetchJson.mockClear();
    expect(await noKey.m.refresh()).toMatchObject([{ engine: 'anthropic', ok: false, error: 'nessuna chiave API' }]);
    expect(fetchJson).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('joins a refresh already running and schedules itself with timers that never keep the app alive', async () => {
    vi.useFakeTimers();
    try {
      const open = vi.fn(() => claudeCli());
      const a = lists({ engines: () => [engineOf('claude')!], open });
      const p1 = a.m.refresh(), p2 = a.m.refresh();
      expect(p1).toBe(p2);
      await p1;
      expect(open).toHaveBeenCalledTimes(1);
      a.m.start(1000, 10);
      await vi.advanceTimersByTimeAsync(10);
      expect(open).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(open).toHaveBeenCalledTimes(3);
      a.m.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(open).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
});

describe('what the pickers and routing read', () => {
  it('a new model the provider lists shows up, with models.json only as the fallback and overrides', () => {
    setPriceTable(() => TEST_REGISTRY);
    try {
      // no list yet: models.json rows (at 0) for Claude and Cursor alike
      const none = withApiModels({});
      expect(none.claude?.at).toBe(0);
      expect(ids(none.cursor?.ids)).toEqual(['grok-4.7']);
      // a live Claude list wins whole; the Models API's claude-* models the CLI does not name are added
      const seen: ModelsSeen = { claude: { ids: [{ id: 'claude-opus-5-5', name: 'Opus 5.5' }], at: 5 }, anthropic: { ids: [{ id: 'claude-fable-5-2', name: 'Claude Fable 5.2' }, { id: 'claude-opus-5-5-20261001', name: 'x' }], at: 9 } };
      expect(ids(withApiModels(seen).claude?.ids)).toEqual(['claude-opus-5-5', 'claude-fable-5-2']);
    } finally { setPriceTable(() => null); }
  });

  it('routing takes a Claude model models.json does not know (no allow-list), keeping the other hard rules', () => {
    const DEF = { harness: 'claude', models: { claude: null, cursor: null }, effort: null } as const;
    expect(resolve({ harness: 'claude', model: 'claude-fable-5-2' }, { ...DEF, models: { ...DEF.models } }, TEST_REGISTRY))
      .toMatchObject({ harness: 'claude', model: 'claude-fable-5-2', source: 'override' });
    expect(resolve({ harness: 'cursor', model: 'claude-fable-5-2' }, { ...DEF, models: { ...DEF.models } }, TEST_REGISTRY))
      .toEqual({ error: expect.stringMatching(/Claude gira solo/) });
  });

  it('the template models.json says it is an override, never an allow-list', () => {
    const t = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../../brain-template/harness/models.json'), 'utf8')) as { about: string; appChats?: unknown };
    expect(t.about).toMatch(/never an allow-list/);
    expect(t.appChats).toBeUndefined();
  });
});
