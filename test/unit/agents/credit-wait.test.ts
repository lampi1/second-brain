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
import { CreditMoveRefused, GRACE_MS, MAX_MOVING, RETRY_MS, STAGGER_MS, creditCardKey, creditMove, creditWaitWatch, type CardNow, type CreditWaitDeps } from '../../../src/main/agents/credit-wait';
import { delegationTools } from '../../../src/main/agents/delegation';
import { DELEGATION_DEFAULTS, ROLE_DEFAULTS, ROLE_IDS, isWorkRole, type RoleId } from '../../../src/shared/roles';
import type { AgentCatalog } from '../../../src/shared/agents';
import type { ChatSummary, Harness, NewChat } from '../../../src/shared/contract';
import { closeAppDbs } from '../../../src/main/app-db';
import { readingOf } from '../../../src/main/plans/live';
import { sayOf } from '../../../src/main/plans/chat-say';
import { markOf } from '../../../src/main/appctl/agents-recap';
import { wakeLine } from '../../../src/main/chats/orchestrator-wake';
import { waitsOnUser } from '../../../src/shared/plan';

const LIMIT = 'Claude AI usage limit reached|1764000000';

const chat = (p: Partial<ChatSummary> = {}): ChatSummary => ({ id: 'c1', harness: 'claude', origin: 'app', title: 'Scout · Log', cwd: '/repo', sessionId: null, model: 'm-old', effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [],
  agent: { id: 'scout', name: 'Scout', purpose: '', engine: 'claude', model: 'm-old', revision: 1, source: 'catalog' }, creditWait: { at: 1, model: 'm-old', card: 'claude:m-old' }, ...p });
const cardOf = (c: Partial<CardNow> = {}) => vi.fn((_r: string, _a: unknown, _o: { asker: string; skip: readonly string[] }): CardNow => ({ engine: 'claude', model: 'm-old', effort: null, preset: 'base', allOut: false, skipped: [], ...c }));
const free = (c: Partial<CardNow> = {}) => cardOf(c);

const none = (): undefined => undefined;
const chatsOf = (...all: ChatSummary[]) => (id: string) => all.find(c => c.id === id);
const at = (d: { card: ReturnType<typeof cardOf> }) => ({ card: d.card, now: () => 1000 });

describe('creditMove: where a chat stopped on its limit goes now (ADR 0354)', () => {
  it('17. another model of the same level on the same engine: the chat goes on there, with the card\'s effort', () => {
    expect(creditMove(chat(), none, at({ card: free({ model: 'm-new', effort: 'low' }) }))).toMatchObject({ do: 'resume', to: { model: 'm-new', effort: 'low' }, card: 'claude:m-new', note: { from: 'm-old (claude)', to: 'm-new (claude)', level: 'Base' } });
  });
  it('21a. the model it stopped on is free again: it goes on there (it was never moved before)', () => {
    expect(creditMove(chat(), none, at({ card: free() }))).toMatchObject({ do: 'resume', to: { model: 'm-old' }, note: { why: 'il suo limite è tornato libero' } });
  });
  it('20b. a wait that never knew its card follows the level now (no «already seen» card)', () => {
    expect(creditMove(chat({ creditWait: { at: 1, model: 'm-old' } }), none, at({ card: free({ engine: 'opencode', model: 'openai/x' }) }))?.do).toBe('continue');
  });
  it('19. the level is held: no delegator\'s ceiling is passed, the preset the chat runs on is asked', () => {
    const card = free({ model: 'm-top', preset: 'max' });
    const parent = chat({ id: 'p', model: 'cheap', agent: { id: 'strategist', name: 'Strategist', purpose: '', engine: 'claude', model: null, revision: 1, source: 'catalog' }, creditWait: undefined });
    expect(creditMove(chat({ parentId: 'p', run: { runId: 'r', presetChoice: { preset: 'max', presetWhy: 'serve' } } as never }), chatsOf(parent), at({ card }))).toMatchObject({ note: { level: 'Massimo' } });
    expect(card).toHaveBeenCalledWith('scout', { preset: 'max', presetWhy: 'serve' }, { asker: 'c1', skip: [] });
    card.mockClear();
    creditMove(chat({ run: { runId: 'r', presetChoice: { preset: 'min' } } as never }), none, at({ card }));
    expect(card.mock.calls[0]![1]).toEqual({ preset: 'min', presetWhy: 'the level the chat runs on' });
  });
  it('20a. a chat started with the user\'s own model follows the card\'s lists at the level its launch named', () => {
    const card = free({ model: 'm-next' });
    creditMove(chat({ userModel: { engine: 'claude', model: 'm-old' }, run: { runId: 'r', presetChoice: { preset: 'base' } } as never }), none, at({ card }));
    expect(card.mock.calls[0]![1]).toEqual({});
  });
  it('21b. the whole level is out: it waits, never moves onto a model with no room, and says which and when', () => {
    const m = creditMove(chat(), none, { card: free({ allOut: true, rooms: [{ engine: 'claude', model: 'm-old', why: '5h al 100%, torna alle 22:40', until: 5000 }, { engine: 'opencode', model: 'openai/x', why: 'pausa breve', until: 3000 }] }), now: () => 1000 });
    expect(m).toMatchObject({ do: 'wait', waiting: { out: ['m-old (claude): 5h al 100%, torna alle 22:40', 'openai/x (opencode): pausa breve'], first: 3000 } });
  });
  it('22a. a model refused for good is skipped; a temporary failure waits for its retry time', () => {
    const card = free({ model: 'm-new' });
    creditMove(chat({ creditWait: { at: 1, model: 'm-old', failed: [{ card: 'claude:m-bad', n: 1, at: 1, nextAt: null, permanent: true, error: 'x' }] } }), none, at({ card }));
    expect(card.mock.calls[0]![2]).toEqual({ asker: 'c1', skip: ['claude:m-bad'] });
    expect(creditMove(chat({ creditWait: { at: 1, model: 'm-old', failed: [{ card: 'claude:m-new', n: 1, at: 1, nextAt: 9000, permanent: false, error: 'x' }] } }), none, at({ card }))).toMatchObject({ do: 'later', at: 9000 });
  });
  it('25a. «Ferma» on its job, «Annulla» (until the levels change), a working or closed chat: nothing', () => {
    const d = { card: free({ model: 'm-new' }), now: () => 1000, levelsKey: () => 'L1' };
    const stopped = { phase: 'approved', stopped: true, steps: [], at: 1 } as never;
    expect(creditMove(chat({ plan: stopped }), none, d)).toBeNull();
    const top = chat({ id: 'top', creditWait: undefined, plan: stopped }), mid = chat({ id: 'mid', parentId: 'top', creditWait: undefined });
    expect(creditMove(chat({ parentId: 'mid' }), chatsOf(top, mid), d)).toBeNull();
    expect(creditMove(chat({ creditWait: { at: 1, model: 'm-old', stay: 'L1' } }), none, d)).toBeNull();
    expect(creditMove(chat({ creditWait: { at: 1, model: 'm-old', stay: 'L0' } }), none, d)?.do).toBe('resume');
    for (const p of [{ state: 'running' as const }, { closedAt: 5 }, { continuedBy: { id: 'n', title: 'n' } }, { isOrchestrator: true }, { creditWait: undefined }]) expect(creditMove(chat(p), none, d)).toBeNull();
    expect(creditMove(chat(), none, { card: () => { throw new Error('engine off'); } })).toBeNull();
  });
  it('creditCardKey: engine and model, an empty model for the engine default', () => {
    expect(creditCardKey({ engine: 'claude', model: null })).toBe('claude:');
    expect(creditCardKey({ engine: 'codex', model: 'gpt-x' })).toBe('codex:gpt-x');
  });
});

/** A fake chats side for the watch: records what it is asked and updates the wait as the manager would. */
function fakeChats(all: ChatSummary[], o: { fail?: () => Error | null } = {}) {
  const get = (id: string) => all.find(x => x.id === id)!;
  const move = async (id: string): Promise<boolean> => { const e = o.fail?.(); if (e) throw e; delete get(id).creditWait; return true; };
  return {
    list: () => all,
    creditResume: vi.fn<CreditWaitDeps['chats']['creditResume']>(id => move(id)),
    creditContinue: vi.fn<CreditWaitDeps['chats']['creditContinue']>(id => move(id)),
    creditPlan: vi.fn<CreditWaitDeps['chats']['creditPlan']>((id, next) => { const c = get(id); c.creditWait = { ...c.creditWait!, next }; }),
    creditWaiting: vi.fn<CreditWaitDeps['chats']['creditWaiting']>((id, waiting) => { const c = get(id); c.creditWait = { ...c.creditWait!, waiting }; }),
    creditHold: vi.fn<CreditWaitDeps['chats']['creditHold']>((id, key) => { const c = get(id); c.creditWait = { ...c.creditWait!, stay: key }; }),
    creditFailed: vi.fn<CreditWaitDeps['chats']['creditFailed']>((id, f) => { const c = get(id), was = c.creditWait!.failed?.find(x => x.card === f.card);
      const { next: _n, ...rest } = c.creditWait!; void _n;
      c.creditWait = { ...rest, failed: [...(c.creditWait!.failed ?? []).filter(x => x.card !== f.card), { card: f.card, n: (was?.n ?? 0) + 1, at: 1, nextAt: f.nextAt, permanent: f.permanent, error: f.error }] }; }),
  };
}
const flush = () => new Promise<void>(r => setImmediate(r));

describe('creditWaitWatch: moves, retries, staggering, no loops (ADR 0354)', () => {
  it('announces the move with where from, the level and why, then moves once after the grace', async () => {
    const clock = { t: 1000 }, later = vi.fn();
    const all = [chat({ id: 'a' })], chats = fakeChats(all);
    const watch = creditWaitWatch({ chats, card: () => ({ engine: 'claude', model: 'm-next', effort: null, preset: 'base' }), now: () => clock.t, later });
    watch(); watch();
    expect(chats.creditPlan).toHaveBeenCalledTimes(1);
    expect(chats.creditPlan.mock.calls[0]![1]).toEqual({ card: 'claude:m-next', at: 1000 + GRACE_MS });
    expect(chats.creditPlan.mock.calls[0]![3]).toMatchObject({ from: 'm-old (claude)', to: 'm-next (claude)', level: 'Base' });
    expect(chats.creditResume).not.toHaveBeenCalled();
    clock.t += GRACE_MS + 1; watch();
    expect(chats.creditResume).toHaveBeenCalledWith('a', { model: 'm-next', effort: null }, expect.objectContaining({ level: 'Base' }));
  });
  it('21. all out, then the same model frees: it goes on there; all out, then another frees: it goes there', async () => {
    for (const freed of ['m-old', 'm-two']) {
      const clock = { t: 1000 };
      const all = [chat({ id: 'a' })], chats = fakeChats(all);
      let out = true;
      const watch = creditWaitWatch({ chats, card: () => out ? { engine: 'claude', model: 'm-old', effort: null, allOut: true, rooms: [{ engine: 'claude', model: 'm-old', why: 'finito', until: 5000 }] } : { engine: 'claude', model: freed, effort: null }, now: () => clock.t, later: () => {} });
      watch();
      expect(chats.creditWaiting).toHaveBeenCalledTimes(1);
      expect(chats.creditPlan).not.toHaveBeenCalled();
      watch();
      expect(chats.creditWaiting).toHaveBeenCalledTimes(1); // said once per change
      out = false;
      watch(); clock.t += GRACE_MS + 1; watch();
      expect(chats.creditResume).toHaveBeenCalledWith('a', { model: freed, effort: null }, expect.anything());
    }
  });
  it('22. a refused engine: the next model of the level is tried; a temporary error is retried with longer waits, then skipped, with the reason written', async () => {
    const clock = { t: 1000 };
    const all = [chat({ id: 'a' })];
    let err: Error | null = new CreditMoveRefused('the engine refuses the model');
    const chats = fakeChats(all, { fail: () => err });
    const card = vi.fn((_r: string, _a: unknown, o: { skip: readonly string[] }): CardNow => o.skip.includes('opencode:x') ? { engine: 'claude', model: 'm-2', effort: null } : { engine: 'opencode', model: 'x', effort: null });
    const watch = creditWaitWatch({ chats, card, now: () => clock.t, later: () => {} });
    watch(); clock.t += GRACE_MS + 1; watch(); await flush();
    expect(chats.creditFailed).toHaveBeenLastCalledWith('a', expect.objectContaining({ card: 'opencode:x', permanent: true }));
    err = new Error('spawn EAGAIN');
    watch(); clock.t += GRACE_MS + 1; clock.t += STAGGER_MS; watch(); await flush();
    expect(chats.creditFailed).toHaveBeenLastCalledWith('a', expect.objectContaining({ card: 'claude:m-2', permanent: false, nextAt: clock.t + RETRY_MS[0]! }));
    // before its retry time nothing; after it, once more; after the last retry it is skipped for good
    watch(); expect(chats.creditResume).toHaveBeenCalledTimes(1);
    for (const w of RETRY_MS) { clock.t += w + STAGGER_MS + GRACE_MS + 2; watch(); clock.t += GRACE_MS + 1; watch(); await flush(); }
    expect(chats.creditResume.mock.calls.length).toBe(1 + RETRY_MS.length);
    expect(chats.creditFailed).toHaveBeenLastCalledWith('a', expect.objectContaining({ card: 'claude:m-2', permanent: true, last: true }));
  });
  it('23. two limits in a row never loop: a model the rule says out is never picked again', async () => {
    const clock = { t: 1000 };
    const outKeys = new Set<string>(['claude:m-old']);
    const levels = ['m-old', 'm-two'];
    const all = [chat({ id: 'a' })], chats = fakeChats(all);
    const card = () => { const free2 = levels.find(m => !outKeys.has(`claude:${m}`)); return free2 ? { engine: 'claude' as const, model: free2, effort: null } : { engine: 'claude' as const, model: 'm-old', effort: null, allOut: true, rooms: [] }; };
    const watch = creditWaitWatch({ chats, card, now: () => clock.t, later: () => {} });
    watch(); clock.t += GRACE_MS + 1; watch(); await flush();
    expect(chats.creditResume).toHaveBeenCalledWith('a', { model: 'm-two', effort: null }, expect.anything());
    // m-two hits its limit too: the chat waits again; both out, so no move at all
    outKeys.add('claude:m-two');
    all[0]!.creditWait = { at: clock.t, model: 'm-two', card: 'claude:m-two' };
    for (let i = 0; i < 5; i++) { clock.t += GRACE_MS + STAGGER_MS; watch(); }
    expect(chats.creditResume).toHaveBeenCalledTimes(1);
    expect(chats.creditWaiting).toHaveBeenCalledTimes(1);
  });
  it('24. ten chats freed together start staggered, a few at a time', async () => {
    const clock = { t: 1000 };
    const all = Array.from({ length: 10 }, (_, i) => chat({ id: `c${i}` }));
    let release: (() => void) | null = null;
    const chats = fakeChats(all);
    chats.creditResume.mockImplementation(id => new Promise(res => { release = () => { delete all.find(c => c.id === id)!.creditWait; res(true); }; }));
    const watch = creditWaitWatch({ chats, card: () => ({ engine: 'claude', model: 'm-next', effort: null }), now: () => clock.t, later: () => {} });
    watch(); clock.t += GRACE_MS + 1; watch();
    expect(chats.creditResume).toHaveBeenCalledTimes(1);
    clock.t += STAGGER_MS; watch();
    expect(chats.creditResume).toHaveBeenCalledTimes(MAX_MOVING);
    clock.t += STAGGER_MS; watch();
    expect(chats.creditResume).toHaveBeenCalledTimes(MAX_MOVING); // never more than MAX_MOVING at once
    release!(); await flush();
    clock.t += STAGGER_MS; watch();
    expect(chats.creditResume).toHaveBeenCalledTimes(MAX_MOVING + 1);
  });
  it('25b. «Annulla» holds until the role\'s levels change', () => {
    const clock = { t: 1000 };
    const all = [chat({ id: 'a', creditWait: { at: 1, model: 'm-old', stay: true } })], chats = fakeChats(all);
    let key = 'L1';
    const watch = creditWaitWatch({ chats, card: () => ({ engine: 'claude', model: 'm-next', effort: null }), levelsKey: () => key, now: () => clock.t, later: () => {} });
    watch(); watch();
    expect(chats.creditHold).toHaveBeenCalledWith('a', 'L1');
    expect(chats.creditPlan).not.toHaveBeenCalled();
    key = 'L2'; watch();
    expect(chats.creditPlan).toHaveBeenCalledTimes(1);
  });
});

describe('what the app shows for a chat that waits on its credits', () => {
  const waiting = chat({ lastResult: { at: 5, isError: true } });
  it('the plan says it waits for the user (a card to change), not that it failed', () => {
    expect(readingOf(waiting, [])).toEqual({ say: 'waiting', waits: 'credits' });
    expect(waitsOnUser('credits')).toBe(true);
    expect(readingOf({ ...waiting, creditWait: undefined }, [])).toEqual({ say: 'failed' });
    // a new turn ends the wait
    expect(readingOf({ ...waiting, state: 'running' }, []).say).toBe('working');
  });
  it('the plan holds its piece on the user, and the recap counts it among what waits for him', () => {
    expect(sayOf(waiting, [waiting], [])).toBe('wait');
    expect(sayOf({ ...waiting, creditWait: undefined }, [], [])).toBe('fail');
    expect(markOf(waiting, [])).toBe('wait');
    expect(markOf({ ...waiting, state: 'error' }, [])).toBe('wait');
    expect(markOf({ ...waiting, creditWait: undefined, state: 'error' }, [])).toBe('error');
  });
  it('the Orchestrator is told it waits, why, and that the app (not it) moves the chat', () => {
    const line = wakeLine({ chatId: 'c1', title: 'Scout · Log', harness: 'claude', kind: 'error', detail: '', at: 1, child: { role: 'Scout', parent: 'Piano' }, credits: { role: 'Scout', model: 'm-old' } });
    expect(line).toMatch(/in attesa, non è un errore/);
    expect(line).toMatch(/limite di m-old è finito/);
    expect(line).toMatch(/stesso livello di Scout/);
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
  it('a child that answered but never called agent_report goes up as partial, not blocked (#463)', async () => {
    const f = fixture(), { child } = await f.family();
    const s = f.sinks.get(child.id)!;
    const turn = (text: string) => {
      s.changed({ state: 'running' });
      s.item({ kind: 'assistant', id: `a-${Math.random()}`, at: Date.now(), text } as never, false);
      s.item({ kind: 'result', id: `r-${Math.random()}`, at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
      s.changed({ state: 'idle' });
    };
    turn('Ho trovato la causa nei log.');
    await new Promise(r => setTimeout(r, 10));
    expect(f.get(child.id).delegation!.result).toBeUndefined(); // told once first
    turn('Ho trovato la causa nei log: è il proxy.');
    await new Promise(r => setTimeout(r, 10));
    expect(f.get(child.id).delegation!.result).toMatchObject({ outcome: 'partial', noReport: true });
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
  const NOTE = { from: 'm-old (claude)', to: 'm-new (claude)', level: 'Base', why: 'm-old (claude) saltato: credito finito' };
  it('creditResume: it switches to the level\'s model, is told to go on, and its run names the new model', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    expect(await f.m.creditResume(child.id, { model: 'm-new', effort: null }, NOTE)).toBe(true);
    const c = f.get(child.id);
    expect(c.model).toBe('m-new');
    expect(c.creditWait).toBeUndefined();
    expect(f.models.get(child.id)).toEqual(['m-new']);
    expect(c.run!.model).toBe('m-new');
    expect(c.creditMoved).toMatchObject({ from: 'm-old (claude)', to: 'm-new (claude)', level: 'Base' });
    expect(words(f.m, child.id)).toContain('creditMoved');
    const told = f.sent.get(child.id)!.at(-1)!;
    expect(told).toMatch(/limite di m-old \(claude\) era finito/);
    expect(told).toMatch(/ripartire su m-new \(claude\)/);
    expect(told).toMatch(/stesso livello \(Base\)/);
    expect(told).toMatch(/agent_report/);
    // a chat that does not wait is left alone
    expect(await f.m.creditResume(child.id, { model: 'm-other', effort: null }, NOTE)).toBe(false);
    expect(f.get(child.id).model).toBe('m-new');
  });
  it('creditResume: a model the engine refuses is a refusal for good (the next model is tried), the chat keeps waiting', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    const set = vi.spyOn(f.m, 'set').mockRejectedValueOnce(new Error('model not allowed'));
    await expect(f.m.creditResume(child.id, { model: 'm-new', effort: null }, NOTE)).rejects.toBeInstanceOf(CreditMoveRefused);
    set.mockRestore();
    expect(f.get(child.id).creditWait).toMatchObject({ model: 'm-old' });
  });
  it('18. creditContinue: the work goes on in a new chat on another engine, the same child of the same parent, contract and folder, with no turn asked of the old engine', async () => {
    // a Strategist with a plan the user approved, whose first step this child does
    const f = fixture();
    const parent = await f.m.create({ harness: 'claude', cwd: f.dir, roleId: 'strategist', title: 'Piano', prompt: 'Trova l\'errore nei log' }, 'agent');
    const plan = f.m.planPropose(parent.id, [{ id: 's1', title: 'Leggo i log', role: 'scout', state: 'todo' }, { id: 's2', title: 'Riassumo', state: 'todo', after: ['s1'] }]);
    await f.m.planDecide(parent.id, 'approve', plan.at);
    await f.call('agent_delegate', parent.id, { tasks: [{ role: 'scout', title: 'Log', step: 1, contract: { goal: 'Leggi i log', doneWhen: ['trovato'] } }] });
    const child = f.m.list().find(c => c.parentId === parent.id)!;
    expect(f.get(parent.id).plan!.steps[0]!.chatIds).toEqual([child.id]);
    f.failTurn(child.id, LIMIT);
    const asked = f.sent.get(child.id)?.length ?? 0;
    const note = { ...NOTE, to: 'openai/gpt-x (opencode)' };
    expect(await f.m.creditContinue(child.id, { engine: 'opencode', model: 'openai/gpt-x', effort: null }, note)).toBe(true);
    const old = f.get(child.id), next = f.m.list().find(c => c.continuedFrom?.id === child.id)!;
    expect(f.sent.get(child.id)?.length ?? 0).toBe(asked); // the hand-off is the app's own note
    expect(old.continuedBy?.id).toBe(next.id);
    expect(old.creditWait).toBeUndefined();
    expect(next).toMatchObject({ harness: 'opencode', model: 'openai/gpt-x', parentId: parent.id, cwd: old.cwd });
    expect(next.creditMoved).toMatchObject({ from: 'm-old (claude)', to: 'openai/gpt-x (opencode)', level: 'Base' });
    expect(f.engines.get(next.id)).toBe('opencode');
    expect(f.starts.get(next.id)!.cwd).toBe(f.starts.get(child.id)!.cwd);
    expect(next.agent).toMatchObject({ id: 'scout', engine: 'opencode', model: 'openai/gpt-x' });
    expect(next.delegation).toMatchObject({ role: 'scout', goal: 'Leggi i log', doneWhen: ['trovato'] });
    expect(words(f.m, child.id)).toContain('creditMoved');
    // the plan step follows the chat that goes on
    expect(f.get(parent.id).plan!.steps[0]!.chatIds).toEqual([next.id]);
    // 26. the old chat owes nothing: its exit closes no delegation as blocked, and the result comes once, from the new one
    f.sinks.get(child.id)?.exit({ code: 1, error: 'gone' });
    expect(f.get(child.id).delegation!.result).toBeUndefined();
    expect(next.run?.presetChoice).toEqual(old.run?.presetChoice);
    const kids = await f.call('agent_children', parent.id, {});
    expect(kids.children.filter((k: { result: unknown }) => k.result)).toHaveLength(0);
  });
  it('the wait knows the card its chat started from, and an exit after a limit result writes no second line', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    expect(f.get(child.id).creditWait).toMatchObject({ card: 'claude:m-old' });
    f.sinks.get(child.id)!.exit({ code: 1, error: 'usage limit reached' });
    expect(words(f.m, child.id).filter(w => w === 'creditWait')).toHaveLength(1);
  });
  it('creditWaiting and creditFailed: the chat says which models are out and when the first is back, and what failed', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    f.m.creditWaiting(child.id, { out: ['m-old (claude): 5 ore finite'], first: null });
    expect(f.get(child.id).creditWait).toMatchObject({ model: 'm-old', waiting: { out: ['m-old (claude): 5 ore finite'] } });
    expect(words(f.m, child.id)).toContain('creditAllOut');
    f.m.creditFailed(child.id, { card: 'opencode:x', error: 'spawn EAGAIN', permanent: false, nextAt: Date.now() + 30e3, last: false });
    f.m.creditFailed(child.id, { card: 'opencode:x', error: 'spawn EAGAIN', permanent: false, nextAt: Date.now() + 60e3, last: false });
    expect(f.get(child.id).creditWait!.failed).toEqual([expect.objectContaining({ card: 'opencode:x', n: 2, permanent: false })]);
    expect(words(f.m, child.id).filter(w => w === 'creditMoveFailed')).toHaveLength(2);
  });
  it('a resume whose message cannot be sent keeps the chat waiting (the watch retries it)', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    const send = vi.spyOn(f.m, 'send').mockRejectedValueOnce(new Error('motore spento.'));
    const e = await f.m.creditResume(child.id, { model: 'm-new', effort: null }, NOTE).catch(x => x as Error);
    send.mockRestore();
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(CreditMoveRefused);
    expect(f.get(child.id).creditWait).toMatchObject({ model: 'm-old' });
  });
  it('the watch on a real manager: a level all out moves nothing and says so; a model that frees moves once, after the grace', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    let card: CardNow = { engine: 'claude', model: 'm-old', effort: null, preset: 'base', allOut: true, rooms: [{ engine: 'claude', model: 'm-old', why: '5 ore finite', until: null }] };
    const resume = vi.spyOn(f.m, 'creditResume');
    let t = Date.now();
    const watch = creditWaitWatch({ chats: f.m, card: () => card, now: () => t, later: () => {} });
    watch(); watch();
    expect(resume).not.toHaveBeenCalled();
    expect(words(f.m, child.id).filter(w => w === 'creditAllOut')).toHaveLength(1);
    card = { engine: 'claude', model: 'm-new', effort: null, preset: 'base' };
    // announced in the chat first (ADR 0348), then moved once
    watch();
    expect(f.get(child.id).creditWait?.next).toMatchObject({ card: 'claude:m-new' });
    expect(resume).not.toHaveBeenCalled();
    t += GRACE_MS + 1;
    watch(); watch();
    expect(resume).toHaveBeenCalledTimes(1);
  });
  it('«Annulla» on the announced move keeps the chat waiting on a real manager', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    const resume = vi.spyOn(f.m, 'creditResume');
    let t = Date.now();
    const watch = creditWaitWatch({ chats: f.m, card: () => ({ engine: 'claude', model: 'm-new', effort: null, preset: 'base' }), levelsKey: () => 'L1', now: () => t, later: () => {} });
    watch(); watch();
    expect(f.m.creditStay(child.id)).toBe(true);
    expect(f.get(child.id).creditWait).toMatchObject({ stay: true });
    expect(f.get(child.id).creditWait?.next).toBeUndefined();
    t += GRACE_MS + 1;
    watch();
    expect(f.get(child.id).creditWait).toMatchObject({ stay: 'L1' });
    expect(resume).not.toHaveBeenCalled();
  });
  it('25. a restart keeps the announced move, «Annulla» and the failures', async () => {
    const f = fixture(), { child } = await f.family();
    f.failTurn(child.id, LIMIT);
    f.m.creditFailed(child.id, { card: 'opencode:x', error: 'refused', permanent: true, nextAt: null, last: true });
    f.m.creditPlan(child.id, { card: 'claude:m-new', at: Date.now() + GRACE_MS }, { engine: 'claude', model: 'm-new' }, NOTE);
    f.m.creditStay(child.id);
    f.m.creditHold(child.id, 'L1');
    await f.m.shutdown();
    managers.splice(managers.indexOf(f.m), 1);
    closeAppDbs();
    const again = fixture(f.dir);
    expect(again.get(child.id).creditWait).toMatchObject({ model: 'm-old', stay: 'L1', failed: [expect.objectContaining({ card: 'opencode:x', permanent: true })] });
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
