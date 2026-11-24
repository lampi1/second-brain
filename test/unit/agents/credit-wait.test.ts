// A role chat out of credits waits for its role's card (ADR 0346, issue #462): what a card means for a waiting chat
// (agents/credit-wait.ts creditMove, creditWaitWatch), and on a real ChatManager with fake engines: a delegated child
// whose turn or engine ends on the provider's limit is not closed as blocked, says why it waits, shows as waiting to
// its parent and on the maps, goes on on the card's new model (creditResume) or in a new chat on the card's new engine
// (creditContinue), and keeps the wait over a restart. Never a real engine, git or timer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { creditMove, creditWaitWatch, type CardNow, type CreditWaitDeps } from '../../../src/main/agents/credit-wait';
import { delegationTools } from '../../../src/main/agents/delegation';
import { DELEGATION_DEFAULTS, ROLE_DEFAULTS, ROLE_IDS, isWorkRole, type RoleId } from '../../../src/shared/roles';
import type { AgentCatalog } from '../../../src/shared/agents';
import type { ChatSummary, Harness, NewChat } from '../../../src/shared/contract';
import { closeAppDbs } from '../../../src/main/app-db';
import { readingOf } from '../../../src/main/workmap/live';
import { sayOf } from '../../../src/main/projectmap/follow';
import { markOf } from '../../../src/main/appctl/agents-recap';
import { wakeLine } from '../../../src/main/chats/orchestrator-wake';
import { waitsOnUser } from '../../../src/shared/work-map';

const LIMIT = 'Claude AI usage limit reached|1764000000';

const chat = (p: Partial<ChatSummary> = {}): ChatSummary => ({ id: 'c1', harness: 'claude', origin: 'app', title: 'Scout · Log', cwd: '/repo', sessionId: null, model: 'm-old', effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [],
  agent: { id: 'scout', name: 'Scout', purpose: '', engine: 'claude', model: 'm-old', revision: 1, source: 'catalog' }, creditWait: { at: 1, model: 'm-old' }, ...p });
const cardOf = (c: Partial<CardNow> = {}) => vi.fn((): CardNow => ({ engine: 'claude', model: 'm-old', effort: null, ...c }));

describe('creditMove: what the role card means for a chat that waits on its credits', () => {
  it('nothing while the card still names the model that ran out; an effort alone changes nothing', () => {
    expect(creditMove(chat(), undefined, { card: cardOf(), engineRefusal: () => null })).toBeNull();
    expect(creditMove(chat(), undefined, { card: cardOf({ effort: 'high' }), engineRefusal: () => null })).toBeNull();
  });
  it('another model on the same engine: the chat switches to it', () => {
    expect(creditMove(chat(), undefined, { card: cardOf({ model: 'm-new', effort: 'low' }), engineRefusal: () => null })).toEqual({ do: 'resume', to: { model: 'm-new', effort: 'low' } });
    // the model that ran out counts, not the one the chat shows now
    expect(creditMove(chat({ model: 'm-new' }), undefined, { card: cardOf({ model: 'm-new' }), engineRefusal: () => null })).toEqual({ do: 'resume', to: { model: 'm-new', effort: null } });
  });
  it('reads the card for the preset the chat runs on, under its parent\'s ceiling', () => {
    const card = cardOf({ model: 'm-top' });
    const parent = chat({ id: 'p', model: 'm-parent', agent: { id: 'strategist', name: 'Strategist', purpose: '', engine: 'claude', model: null, revision: 1, source: 'catalog' }, creditWait: undefined });
    creditMove(chat({ parentId: 'p', run: { runId: 'r', presetChoice: { preset: 'max', presetWhy: 'serve' } } as never }), parent, { card, engineRefusal: () => null });
    expect(card).toHaveBeenCalledWith('scout', { preset: 'max', presetWhy: 'serve' }, { role: 'strategist', model: 'm-parent' });
    card.mockClear();
    creditMove(chat(), undefined, { card, engineRefusal: () => null });
    expect(card).toHaveBeenCalledWith('scout', {}, undefined);
  });
  it('another engine: the work goes on in a new chat there, unless its parent may not start that engine (told once)', () => {
    const card = cardOf({ engine: 'opencode', model: 'openai/gpt-x' });
    expect(creditMove(chat(), undefined, { card, engineRefusal: () => null })).toEqual({ do: 'continue', on: { engine: 'opencode', model: 'openai/gpt-x', effort: null } });
    const parent = chat({ id: 'p', creditWait: undefined });
    expect(creditMove(chat({ parentId: 'p' }), parent, { card, engineRefusal: () => 'off' })).toEqual({ do: 'stay', engine: 'opencode' });
    expect(creditMove(chat({ parentId: 'p', creditWait: { at: 1, model: 'm-old', otherEngine: 'opencode' } }), parent, { card, engineRefusal: () => null })).toBeNull();
  });
  it('nothing for a chat that does not wait, works, is closed or continued, has no role, or whose card cannot start a chat', () => {
    const d = { card: cardOf({ model: 'm-new' }), engineRefusal: () => null };
    expect(creditMove(chat({ creditWait: undefined }), undefined, d)).toBeNull();
    expect(creditMove(chat({ state: 'running' }), undefined, d)).toBeNull();
    expect(creditMove(chat({ closedAt: 5 }), undefined, d)).toBeNull();
    expect(creditMove(chat({ continuedBy: { id: 'n', title: 'n' } }), undefined, d)).toBeNull();
    expect(creditMove(chat({ agent: { id: 'plain', name: 'Chat', purpose: '', engine: 'claude', model: null, revision: 1, source: 'plain' } }), undefined, d)).toBeNull();
    expect(creditMove(chat(), undefined, { card: () => { throw new Error('engine off'); }, engineRefusal: () => null })).toBeNull();
  });
});

describe('creditWaitWatch', () => {
  const deps = (all: ChatSummary[], card: CreditWaitDeps['card'], fails = false) => {
    const move = async (): Promise<boolean> => { if (fails) throw new Error('no'); return true; };
    const chats = { list: () => all, creditResume: vi.fn<CreditWaitDeps['chats']['creditResume']>(move), creditContinue: vi.fn<CreditWaitDeps['chats']['creditContinue']>(move), creditOtherEngine: vi.fn<CreditWaitDeps['chats']['creditOtherEngine']>() };
    return { chats, card, engineRefusal: () => null as string | null };
  };
  it('moves only the chats that wait, each as its card says', async () => {
    const all = [chat({ id: 'a' }), chat({ id: 'b', creditWait: undefined }), chat({ id: 'c', agent: { id: 'artisan', name: 'Artisan', purpose: '', engine: 'claude', model: null, revision: 1, source: 'catalog' } })];
    const d = deps(all, role => (role === 'scout' ? { engine: 'claude', model: 'm-new', effort: null } : { engine: 'opencode', model: 'x/y', effort: null }));
    creditWaitWatch(d)();
    await Promise.resolve();
    expect(d.chats.creditResume.mock.calls).toEqual([['a', { model: 'm-new', effort: null }]]);
    expect(d.chats.creditContinue.mock.calls).toEqual([['c', { engine: 'opencode', model: 'x/y', effort: null }]]);
  });
  it('a move that failed is not tried again for the same card, and is tried for a new one; a failed new chat is told', async () => {
    let model = 'm-new';
    const all = [chat({ id: 'a' })];
    const d = deps(all, () => ({ engine: 'claude', model, effort: null }), true);
    const watch = creditWaitWatch(d);
    watch();
    await new Promise<void>(r => setImmediate(r));
    watch();
    expect(d.chats.creditResume).toHaveBeenCalledTimes(1);
    model = 'm-newer';
    watch();
    expect(d.chats.creditResume).toHaveBeenCalledTimes(2);
    const e = deps([chat({ id: 'x' })], () => ({ engine: 'opencode', model: 'x/y', effort: null }), true);
    creditWaitWatch(e)();
    await new Promise<void>(r => setImmediate(r));
    expect(e.chats.creditOtherEngine).toHaveBeenCalledWith('x', 'opencode');
  });
});

describe('what the app shows for a chat that waits on its credits', () => {
  const waiting = chat({ lastResult: { at: 5, isError: true } });
  it('the work map says it waits for the user (a card to change), not that it failed', () => {
    expect(readingOf(waiting, [])).toEqual({ say: 'waiting', waits: 'credits' });
    expect(waitsOnUser('credits')).toBe(true);
    expect(readingOf({ ...waiting, creditWait: undefined }, [])).toEqual({ say: 'failed' });
    // a new turn ends the wait
    expect(readingOf({ ...waiting, state: 'running' }, []).say).toBe('working');
  });
  it('the project map holds its piece on the user, and the recap counts it among what waits for him', () => {
    expect(sayOf(waiting, [waiting], [])).toBe('wait');
    expect(sayOf({ ...waiting, creditWait: undefined }, [], [])).toBe('fail');
    expect(markOf(waiting, [])).toBe('wait');
    expect(markOf({ ...waiting, state: 'error' }, [])).toBe('wait');
    expect(markOf({ ...waiting, creditWait: undefined, state: 'error' }, [])).toBe('error');
  });
  it('the Orchestrator is told it waits, why, and that nothing is to be switched', () => {
    const line = wakeLine({ chatId: 'c1', title: 'Scout · Log', harness: 'claude', kind: 'error', detail: '', at: 1, child: { role: 'Scout', parent: 'Piano' }, credits: { role: 'Scout', model: 'm-old' } });
    expect(line).toMatch(/in attesa, non è un errore/);
    expect(line).toMatch(/crediti di m-old sono finiti/);
    expect(line).toMatch(/scheda di Scout/);
    expect(line).toMatch(/non scegliere tu un altro modello o preset/);
  });
});

// ---- on a real ChatManager with fake engines

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  try { for (const m of managers.splice(0)) await m.shutdown(); }
  finally { closeAppDbs(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

const catalog = (): AgentCatalog => ({ problem: null, archived: [], models: [], profiles: ROLE_IDS.map(id => {
  const r = ROLE_DEFAULTS[id];
  return { id, name: r.name, purpose: r.summary, scope: 'role', engine: 'claude', model: null, tier: r.tier, tierMax: r.tierMax, launches: [...r.launches], skills: r.skills, tools: { allow: [...r.tools] }, permissionCeiling: r.ceiling, activeVersion: 1, updatedAt: 1, instructions: r.instructions };
}) } as unknown as AgentCatalog);

function fixture(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-credit-wait-'))) {
  if (!roots.includes(dir)) roots.push(dir);
  const sinks = new Map<string, SessionSink>(), sent = new Map<string, string[]>(), models = new Map<string, (string | null)[]>(), engines = new Map<string, Harness>(), starts = new Map<string, SessionOptions>();
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0,
    resolveAgent: (req: NewChat) => {
      const id = req.roleId as RoleId | undefined;
      if (!id || !isWorkRole(id)) return { request: req, owner: { id: 'plain', name: 'Chat', purpose: '', engine: req.harness, model: null, revision: 0, source: 'plain' as const }, instructions: '', policy: null, skills: [], launches: [] };
      const r = ROLE_DEFAULTS[id];
      return { request: { ...req, model: 'm-old' }, owner: { id, name: r.name, purpose: r.summary, engine: 'claude', model: 'm-old', revision: 1, source: 'catalog' as const, version: 1 }, instructions: r.instructions,
        policy: { tools: { allow: [...r.tools] }, ceiling: r.ceiling }, skills: [...r.skills], launches: [...r.launches], assets: { pluginDir: path.join(dir, 'p'), skillRoot: path.join(dir, 'p', 'skills') } };
    },
    sessionFactory: (h, o, s) => {
      sinks.set(o.chatId, s); engines.set(o.chatId, h); starts.set(o.chatId, o);
      return { harness: h, sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { s.changed({ state: 'idle' }); }, send(text: string) { sent.set(o.chatId, [...(sent.get(o.chatId) ?? []), text]); },
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => true,
        rename: async () => {}, setModel: async (model: string | null) => { models.set(o.chatId, [...(models.get(o.chatId) ?? []), model]); }, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
  managers.push(m);
  const tools = delegationTools({ chats: m, roles: catalog, settings: () => DELEGATION_DEFAULTS, engineRefusal: () => null, label: '[agente]', runs: () => m.runs.list() });
  const call = async (name: string, chatId: string, args: Record<string, unknown>) => JSON.parse(await tools.find(t => t.name === name)!.run(args, { mount: 'chat', params: { chatId }, sessionId: '', signal: new AbortController().signal } as never) as string);
  const get = (id: string) => m.list().find(c => c.id === id)!;
  /** a turn of `id` that ends on an engine error with this text */
  const failTurn = (id: string, text: string) => {
    const s = sinks.get(id)!;
    s.changed({ state: 'running' });
    s.item({ kind: 'system', id: `e-${Math.random()}`, at: Date.now(), text, level: 'error' }, false);
    s.item({ kind: 'result', id: `r-${Math.random()}`, at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: true }, false);
    s.changed({ state: 'idle' });
  };
  const family = async () => {
    const parent = await m.create({ harness: 'claude', cwd: dir, roleId: 'strategist', title: 'Piano', prompt: 'x' }, 'user');
    await call('agent_delegate', parent.id, { tasks: [{ role: 'scout', title: 'Log', contract: { goal: 'Leggi i log', doneWhen: ['trovato'] } }] });
    const child = m.list().find(c => c.parentId === parent.id)!;
    return { parent, child };
  };
  return { m, dir, sinks, sent, models, engines, starts, call, get, failTurn, family };
}
const words = (m: ChatManager, id: string) => m.items(id).filter(i => i.kind === 'system').map(i => (i as { code?: string }).code);

describe('a delegated child out of credits (ChatManager)', () => {
  it('waits: no blocked result, its delegation stays open, the chat says why and its parent sees it waits', async () => {
    const f = fixture(), { parent, child } = await f.family();
    f.failTurn(child.id, LIMIT);
    const c = f.get(child.id);
    expect(c.creditWait).toMatchObject({ model: 'm-old' });
    expect(c.delegation!.result).toBeUndefined();
    expect(c.closedAt).toBeUndefined();
    expect(words(f.m, child.id)).toContain('creditWait');
    // a second idle changes nothing: it is never told to report, never closed without a report
    f.sinks.get(child.id)!.changed({ state: 'idle' });
    expect(f.get(child.id).delegation!.result).toBeUndefined();
    expect(f.sent.get(child.id)?.some(t => /agent_report/.test(t) && /turno è finito/.test(t)) ?? false).toBe(false);
    const kids = await f.call('agent_children', parent.id, {});
    expect(kids.children[0]).toMatchObject({ chatId: child.id, waitsOn: 'credits', creditWait: { model: 'm-old' }, result: null });
  });
  it('an engine that dies on the limit in the middle of a turn waits too, and nothing is retried', async () => {
    const f = fixture(), { child } = await f.family();
    const s = f.sinks.get(child.id)!, before = f.sent.get(child.id)?.length ?? 0;
    s.changed({ state: 'running' });
    s.exit({ code: 1, error: 'You have hit your usage limit. Upgrade to keep going.' });
    const c = f.get(child.id);
    expect(c.creditWait).toMatchObject({ model: 'm-old' });
    expect(c.delegation!.result).toBeUndefined();
    expect(f.sent.get(child.id)?.length ?? 0).toBe(before);
  });
  it('another error is no wait: the turn fails as before, and a dead engine still closes the delegation as blocked', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, 'API Error: 500 internal error');
    expect(f.get(child.id).creditWait).toBeUndefined();
    const s = f.sinks.get(child.id)!;
    s.changed({ state: 'running' });
    s.exit({ code: 1, error: 'spawn failed' });
    expect(f.get(child.id).delegation!.result).toMatchObject({ outcome: 'blocked', noReport: true });
  });
  it('a chat without a role does not wait (it has no card): its user changes its model', async () => {
    const f = fixture();
    const plain = await f.m.create({ harness: 'claude', cwd: f.dir, title: 'Libera', prompt: 'x' }, 'user');
    f.failTurn(plain.id, LIMIT);
    expect(f.get(plain.id).creditWait).toBeUndefined();
  });
  it('a new turn ends the wait (the user or its parent wrote to it)', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    f.sinks.get(child.id)!.changed({ state: 'running' });
    expect(f.get(child.id).creditWait).toBeUndefined();
  });
  it('creditResume: it switches to the card\'s model, is told to go on, and its run names the new model', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    expect(await f.m.creditResume(child.id, { model: 'm-new', effort: null })).toBe(true);
    const c = f.get(child.id);
    expect(c.model).toBe('m-new');
    expect(c.creditWait).toBeUndefined();
    expect(f.models.get(child.id)).toEqual(['m-new']);
    expect(c.run!.model).toBe('m-new');
    expect(words(f.m, child.id)).toContain('creditResumed');
    const told = f.sent.get(child.id)!.at(-1)!;
    expect(told).toMatch(/crediti di m-old erano finiti/);
    expect(told).toMatch(/ora giri su m-new/);
    expect(told).toMatch(/agent_report/);
    // a chat that does not wait is left alone
    expect(await f.m.creditResume(child.id, { model: 'm-other', effort: null })).toBe(false);
    expect(f.get(child.id).model).toBe('m-new');
  });
  it('creditContinue: the work goes on in a new chat on the card\'s engine, the same child of the same parent, with no turn asked of the old engine', async () => {
    // a Strategist with a plan the user approved, whose first step this child does
    const f = fixture();
    const parent = await f.m.create({ harness: 'claude', cwd: f.dir, roleId: 'strategist', title: 'Piano', prompt: 'Trova l\'errore nei log' }, 'agent');
    const plan = f.m.planPropose(parent.id, [{ title: 'Leggo i log', role: 'scout', state: 'todo' }, { title: 'Riassumo', state: 'todo' }]);
    await f.m.planDecide(parent.id, 'approve', plan.at);
    await f.call('agent_delegate', parent.id, { tasks: [{ role: 'scout', title: 'Log', step: 1, contract: { goal: 'Leggi i log', doneWhen: ['trovato'] } }] });
    const child = f.m.list().find(c => c.parentId === parent.id)!;
    expect(f.get(parent.id).plan!.steps[0]!.chatIds).toEqual([child.id]);
    f.failTurn(child.id, LIMIT);
    const asked = f.sent.get(child.id)?.length ?? 0;
    expect(await f.m.creditContinue(child.id, { engine: 'opencode', model: 'openai/gpt-x', effort: null })).toBe(true);
    const old = f.get(child.id), next = f.m.list().find(c => c.continuedFrom?.id === child.id)!;
    expect(f.sent.get(child.id)?.length ?? 0).toBe(asked); // the hand-off is the app's own note
    expect(old.continuedBy?.id).toBe(next.id);
    expect(old.creditWait).toBeUndefined();
    expect(next).toMatchObject({ harness: 'opencode', model: 'openai/gpt-x', parentId: parent.id });
    expect(f.engines.get(next.id)).toBe('opencode');
    expect(next.agent).toMatchObject({ id: 'scout', engine: 'opencode', model: 'openai/gpt-x' });
    expect(next.delegation).toMatchObject({ role: 'scout', goal: 'Leggi i log' });
    // the plan step follows the chat that goes on
    expect(f.get(parent.id).plan!.steps[0]!.chatIds).toEqual([next.id]);
  });
  it('creditOtherEngine: told once per engine, the wait goes on', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    f.m.creditOtherEngine(child.id, 'opencode');
    f.m.creditOtherEngine(child.id, 'opencode');
    expect(words(f.m, child.id).filter(w => w === 'creditOtherEngine')).toHaveLength(1);
    expect(f.get(child.id).creditWait).toMatchObject({ model: 'm-old', otherEngine: 'opencode' });
  });
  it('the wait is kept over a restart', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    await f.m.shutdown();
    managers.splice(managers.indexOf(f.m), 1);
    closeAppDbs();
    const again = fixture(f.dir);
    expect(again.get(child.id).creditWait).toMatchObject({ model: 'm-old' });
  });
});
