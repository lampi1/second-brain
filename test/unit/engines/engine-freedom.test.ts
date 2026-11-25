// Full freedom across engines (ADR 0352): the Orchestrator and a Strategist assign, write, reopen and reuse a review
// chat on any engine that is on and allowed to the Orchestrators, whatever engine they run on themselves, with the chat
// active, stopped or closed by itself. What still refuses: an engine off, an engine not allowed to the Orchestrators, a
// chat the user closed with ✕. A chat whose engine cannot run goes on by itself on its card's engine (never a manual
// step). Pinned at the tools (appctl/tools.ts, agents/delegation.ts) and the review lookup (agents/one-review.ts); the
// card adoption inside ChatManager is pinned in test/unit/chats/adopt-card.test.ts.
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { appControlTools } from '../../../src/main/appctl/tools';
import { delegationTools, type DelegationChats } from '../../../src/main/agents/delegation';
import { rootReviewer, childReviewers } from '../../../src/main/agents/one-review';
import { openRefusal } from '../../../src/main/engines/policy';
import type { BrainService, BrowserService, ChatService } from '../../../src/main/services';
import type { ChatItem, ChatSummary, Harness } from '../../../src/shared/contract';
import type { AgentCatalog, AgentRun } from '../../../src/shared/agents';
import { DELEGATION_DEFAULTS } from '../../../src/shared/roles';

const ENGINES: Harness[] = ['claude', 'cursor', 'codex', 'opencode'];
const PAIRS = ENGINES.flatMap(from => ENGINES.map(to => [from, to] as const));
/** active = its engine runs; stopped = open, engine released; auto = closed by itself (the auto-close) */
const STATES = {
  active: { state: 'idle' },
  stopped: { state: 'closed' },
  auto: { state: 'closed', closedAt: 5, closedBy: 'auto' },
} as const;
type StateName = keyof typeof STATES;
const CASES = PAIRS.flatMap(([from, to]) => (Object.keys(STATES) as StateName[]).map(st => [from, to, st] as const));

const all = <T,>(v: T) => Object.fromEntries(ENGINES.map(e => [e, v]));
const settings = (o: { off?: Harness[]; denied?: Harness[] } = {}) => ({
  engineOn: { ...all(true), ...Object.fromEntries((o.off ?? []).map(e => [e, false])) },
  engines: { ...all(true), ...Object.fromEntries((o.denied ?? []).map(e => [e, false])) },
  contextWarnTokens: 150_000, orchestratorChats: { harness: 'claude' },
});
const CATALOG = { profiles: [
  { id: 'scout', name: 'Scout', activeVersion: 3, updatedAt: 30, engine: 'claude', tools: { allow: ['read'] }, skills: [], launches: [] },
  { id: 'sentinel', name: 'Sentinel', activeVersion: 1, updatedAt: 10, engine: 'claude', tools: { allow: ['read'] }, skills: [], launches: [] },
  { id: 'strategist', name: 'Strategist', activeVersion: 1, updatedAt: 1, engine: 'claude', tools: { allow: ['read'] }, skills: [], launches: ['scout', 'sentinel'] },
], models: [] } as unknown as AgentCatalog;

// ---- the Orchestrator's tools ----

function app(from: Harness, target: Partial<ChatSummary>, o: { off?: Harness[]; denied?: Harness[]; card?: Harness; userWrote?: number } = {}) {
  const orchestrator = { id: 'o', title: 'Orchestrator', isOrchestrator: true, harness: from, cwd: '/repo', state: 'idle' } as ChatSummary;
  // the chat was started on an older card (version 1, revision 1): that never stops the work any more
  const work = { id: 'w', title: 'Lavoro', harness: 'claude', cwd: '/repo', state: 'idle', isOrchestrator: false, pending: 0, costUsd: 0, lastText: '',
    agent: { id: 'scout', name: 'Scout', source: 'catalog', version: 1, revision: 1 }, run: { runId: 'r1', taskId: 't1', taskVersion: 1 }, ...target } as ChatSummary;
  const chats = [orchestrator, work];
  const items: ChatItem[] = o.userWrote !== undefined ? [{ kind: 'user', id: 'u', at: o.userWrote, text: 'riapri la chat Lavoro' } as ChatItem] : [];
  const assignTask = vi.fn(async () => {}), send = vi.fn(async () => {});
  const reopen = vi.fn(async (id: string) => { const c = chats.find(x => x.id === id)!; delete c.closedAt; delete c.closedBy; return { ...c }; });
  const continueChat = vi.fn(async (_id: string, opts: { on?: { harness: Harness } }) => ({ ...work, id: 'w2', title: 'Lavoro 2', harness: opts.on!.harness, continuedFrom: { id: 'w', title: 'Lavoro' } }) as ChatSummary);
  const service = { list: () => chats, items: () => items, pending: () => [], assignTask, send, reopen, continueChat, userEvents: () => ({ events: [], latestSeq: 0, acknowledgedSeq: 0 }) } as unknown as ChatService;
  const brain = { settings: () => settings(o), info: () => ({ brainRoot: '/repo' }) } as unknown as BrainService;
  const resolveRole = vi.fn(() => ({ request: { harness: o.card ?? 'claude', model: 'card-model', effort: null, cwd: '/repo' } }));
  const tools = appControlTools({ chats: service, brain, browser: {} as BrowserService, window: () => null, emitUi: () => {}, version: '0', agents: () => CATALOG, resolveRole: resolveRole as never }, 'o');
  const run = (name: string, args: Record<string, unknown>) => Promise.resolve().then(() => tools.find(t => t.name === name)!.run(args));
  const assign = (extra: Record<string, unknown> = {}) => run('app_assign_task', { chatId: 'w', roleId: 'scout', cwd: '/repo', mode: 'continue', prompt: 'Approfondisci il punto due', ...extra });
  return { work, assignTask, send, reopen, continueChat, resolveRole, run, assign };
}

describe('the Orchestrator on any engine reaches a chat on any engine (ADR 0352)', () => {
  it.each(CASES)('%s → %s, chat %s: app_assign_task assigns it on its own engine', async (from, to, st) => {
    const f = app(from, { harness: to, ...STATES[st] });
    await expect(f.assign()).resolves.toMatchObject({ chatId: 'w' });
    expect(f.assignTask).toHaveBeenCalledOnce();
    expect(f.continueChat).not.toHaveBeenCalled();
  });

  it.each(CASES)('%s → %s, chat %s: app_send_to_chat writes to it', async (from, to, st) => {
    const f = app(from, { harness: to, ...STATES[st] });
    await expect(f.run('app_send_to_chat', { chatId: 'w', text: 'Una cosa in più' })).resolves.toMatch(/sent/);
    expect(f.send).toHaveBeenCalledOnce();
  });

  it.each(PAIRS)('%s → %s: app_reopen_chat really reopens a chat that closed by itself, and says so', async (from, to) => {
    const f = app(from, { harness: to, ...STATES.auto });
    const out = await f.run('app_reopen_chat', { chatId: 'w' }) as { reopened: boolean; state: string; harness: string };
    expect(out).toMatchObject({ reopened: true, harness: to, state: 'stopped' });
    expect(f.reopen).toHaveBeenCalledWith('w');
  });

  it('a card changed since the chat started (version and revision) no longer stops the work', async () => {
    const f = app('claude', { harness: 'cursor' });
    await expect(f.assign()).resolves.toMatchObject({ chatId: 'w' });
  });

  it('a chat whose engine is off goes on by itself in a new chat on its card\'s engine, linked to it', async () => {
    for (const st of ['active', 'stopped', 'auto'] as const) {
      const f = app('claude', { harness: 'cursor', ...STATES[st] }, { off: ['cursor'], card: 'codex' });
      const out = await f.assign() as { chatId: string; continuedFrom: string; harness: string; note: string };
      expect(out).toMatchObject({ chatId: 'w2', continuedFrom: 'w', harness: 'codex' });
      expect(out.note).toMatch(/Cursor cannot run now/);
      expect(f.assignTask).not.toHaveBeenCalled();
      const [id, opts] = f.continueChat.mock.calls[0]! as unknown as [string, { on: { harness: string; model: string }; ask: false; promptPrefix: string }];
      expect(id).toBe('w');
      expect(opts).toMatchObject({ ask: false, allowStart: false, on: { harness: 'codex', model: 'card-model' } });
      expect(opts.promptPrefix).toContain('Approfondisci il punto due');
    }
  });
});

describe('what still refuses for the Orchestrator', () => {
  it('an engine off: a stopped chat there is not woken, and the refusal says why', async () => {
    for (const st of ['stopped', 'auto'] as const) {
      const f = app('claude', { harness: 'cursor', ...STATES[st] }, { off: ['cursor'] });
      await expect(f.run('app_send_to_chat', { chatId: 'w', text: 'x' })).rejects.toThrow(/Cursor è spento/);
      expect(f.send).not.toHaveBeenCalled();
    }
    const r = app('claude', { harness: 'cursor', ...STATES.auto }, { off: ['cursor'] });
    await expect(r.run('app_reopen_chat', { chatId: 'w' })).rejects.toThrow(/non riaperta: Cursor è spento/);
    expect(r.reopen).not.toHaveBeenCalled();
  });

  it('an engine not allowed to the Orchestrators: no wake, no reopen; an assignment refused when the card\'s engine is refused too', async () => {
    const f = app('claude', { harness: 'codex', ...STATES.stopped }, { denied: ['codex'], card: 'codex' });
    await expect(f.run('app_send_to_chat', { chatId: 'w', text: 'x' })).rejects.toThrow(/Gli Orchestrator possono usare Codex/);
    await expect(f.assign()).rejects.toThrow(/Gli Orchestrator possono usare Codex/);
    expect(f.continueChat).not.toHaveBeenCalled();
    expect(f.assignTask).not.toHaveBeenCalled();
    const g = app('claude', { harness: 'codex', ...STATES.auto }, { denied: ['codex'] });
    await expect(g.run('app_reopen_chat', { chatId: 'w' })).rejects.toThrow(/Gli Orchestrator possono usare Codex/);
  });

  it('a chat the user closed: no assignment, no message, a reopen only right after his own message', async () => {
    const closed = { harness: 'cursor', state: 'closed', closedAt: 5, closedBy: 'user' } as const;
    const f = app('claude', closed);
    await expect(f.assign()).rejects.toThrow(/closed this chat with ✕/);
    await expect(f.run('app_send_to_chat', { chatId: 'w', text: 'x' })).rejects.toThrow(/closed this chat with ✕/);
    await expect(f.run('app_reopen_chat', { chatId: 'w' })).rejects.toThrow(/only the Orchestrator reopens it/);
    expect(f.assignTask).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.reopen).not.toHaveBeenCalled();
    // he asked for it a moment ago (from his phone too): reopened
    const g = app('claude', closed, { userWrote: Date.now() - 1000 });
    await expect(g.run('app_reopen_chat', { chatId: 'w' })).resolves.toMatchObject({ reopened: true });
  });
});

// ---- the Strategist's tools ----

function strategist(from: Harness, child: Partial<ChatSummary>, o: { off?: Harness[]; denied?: Harness[]; level?: Harness; policy?: string[] } = {}) {
  const cwd = path.resolve('/repo');
  const parent = { id: 'p', title: 'Piano', cwd, harness: from, state: 'idle', permissionMode: null, pending: 0, agent: { id: 'strategist', source: 'catalog', version: 1 }, run: { runId: 'pr', taskVersion: 1 } } as ChatSummary;
  const kid = { id: 'k', title: 'Scout · ricerca', cwd, harness: 'claude', state: 'idle', permissionMode: null, pending: 0, parentId: 'p',
    agent: { id: 'scout', source: 'catalog', version: 1, revision: 1 }, run: { runId: 'kr', taskId: 'kt', taskVersion: 1 },
    delegation: { role: 'scout', goal: 'Prima', doneWhen: ['Fatto'], at: 1, result: { outcome: 'done', summary: 'ok', at: 2 } }, ...child } as ChatSummary;
  const chats = [parent, kid];
  const assignTask = vi.fn(async () => {});
  const continueChat = vi.fn(async (_id: string, opts: { on?: { harness: Harness } }) => ({ ...kid, id: 'k2', title: 'Scout · ricerca 2', harness: opts.on!.harness }) as ChatSummary);
  const allowed = (h: Harness) => openRefusal(settings(o) as never, h);
  const deps: DelegationChats = { list: () => chats, create: vi.fn(), assignTask, continueChat, userEvents: () => ({ events: [], latestSeq: 0, acknowledgedSeq: 0 }),
    agentPolicy: () => ({ tools: { allow: o.policy ?? ['read'] }, ceiling: null }), reportDelegation: () => ({ parentId: 'p', delivered: true }), limitNotice: vi.fn(), send: async () => {},
    ladderAsk: () => ({ asked: 'x' }), ladderReply: async () => ({ answered: 'x', askUser: false }) } as unknown as DelegationChats;
  const tools = delegationTools({ chats: deps, roles: () => CATALOG, settings: () => DELEGATION_DEFAULTS, engineRefusal: allowed, label: '[agent]', runs: () => [],
    presetChoice: () => ({ preset: 'base', model: 'level-model', ...(o.level ? { engine: o.level } : {}), warnings: [] }) });
  const call = async (args: Record<string, unknown> = {}) => JSON.parse(await tools.find(t => t.name === 'agent_assign_task')!.run({ chatId: 'k', roleId: 'scout', mode: 'continue', contract: { goal: 'Poi', output: 'Prove', context: 'c', doneWhen: ['Nuovo'] }, ...args }, { params: { chatId: 'p' } } as never) as string);
  return { kid, assignTask, continueChat, call };
}

describe('a Strategist on any engine reuses its child on any engine (ADR 0352)', () => {
  it.each(CASES)('%s → %s, child %s: agent_assign_task assigns it', async (from, to, st) => {
    const f = strategist(from, { harness: to, ...STATES[st] });
    await expect(f.call()).resolves.toMatchObject({ chatId: 'k' });
    expect(f.assignTask).toHaveBeenCalledOnce();
  });

  it('a card changed since the child started, or a level that now starts on another engine: the child goes on where it is', async () => {
    const f = strategist('claude', { harness: 'cursor', model: 'own-model' }, { level: 'codex' });
    const out = await f.call();
    expect(out.chatId).toBe('k');
    expect(out.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/stays on cursor/)]));
    // no model of another engine forced on it
    const options = (f.assignTask.mock.calls[0] as unknown as [string, string, { preset?: { switchTo?: unknown } }])[2];
    expect(options.preset?.switchTo).toBeUndefined();
    expect(f.continueChat).not.toHaveBeenCalled();
  });

  it('a child whose engine is off goes on by itself on the level\'s engine, with the new task', async () => {
    const f = strategist('claude', { harness: 'cursor', ...STATES.auto }, { off: ['cursor'], level: 'codex' });
    const out = await f.call();
    expect(out).toMatchObject({ chatId: 'k2', continuedFrom: 'k', harness: 'codex' });
    expect(f.assignTask).not.toHaveBeenCalled();
    const opts = (f.continueChat.mock.calls[0] as unknown as [string, { on: unknown; assignment: unknown; ask: false }])[1];
    expect(opts).toMatchObject({ ask: false, on: { harness: 'codex', model: 'level-model' }, assignment: { goal: 'Poi', doneWhen: ['Nuovo'] } });
  });
});

describe('what still refuses for a Strategist', () => {
  it('its child\'s engine off or not allowed, with no other engine of the level that can run', async () => {
    const f = strategist('claude', { harness: 'cursor', ...STATES.stopped }, { off: ['cursor'] , level: 'cursor' });
    await expect(f.call()).rejects.toThrow(/Cursor è spento/);
    const g = strategist('claude', { harness: 'codex', ...STATES.stopped }, { denied: ['codex', 'claude'], level: 'claude' });
    await expect(g.call()).rejects.toThrow(/Gli Orchestrator possono usare Codex.*Gli Orchestrator possono usare Claude/);
    expect(f.assignTask).not.toHaveBeenCalled();
    expect(g.continueChat).not.toHaveBeenCalled();
  });
  it('a child role whose tools are beyond the parent\'s is still refused', async () => {
    const scout = CATALOG.profiles.find(p => p.id === 'scout')!, before = scout.tools;
    scout.tools = { allow: ['read', 'write'] } as typeof scout.tools;
    try {
      const f = strategist('claude', { harness: 'cursor' }, { policy: ['read'] });
      await expect(f.call()).rejects.toThrow(/permissions your current policy does not allow/);
    } finally { scout.tools = before; }
  });
});

// ---- one review chat per piece of work ----

describe('a review chat is reused on any engine (ADR 0352)', () => {
  const impl = { runId: 'i1', chatId: 'impl', agentId: 'artisan', version: 1, goal: '', startedBy: 'orchestrator', startedAt: 1 } as AgentRun;
  const rev = { runId: 'r1', chatId: 'rev', agentId: 'sentinel', version: 1, goal: '', startedBy: 'orchestrator', startedAt: 2, reviewOf: 'i1', report: { summary: 'ok' } } as unknown as AgentRun;
  const chat = (p: Partial<ChatSummary>) => ({ id: 'rev', title: 'Review', harness: 'claude', cwd: '/repo', state: 'idle', isOrchestrator: false,
    agent: { id: 'sentinel', source: 'catalog', version: 1, revision: 1 }, run: rev, ...p }) as unknown as ChatSummary;
  const implChat = { id: 'impl', title: 'Impl', harness: 'claude', cwd: '/repo', state: 'idle', isOrchestrator: false, run: impl } as unknown as ChatSummary;

  it.each(ENGINES.flatMap(to => (Object.keys(STATES) as StateName[]).map(st => [to, st] as const)))('a review chat on %s, %s, is the work\'s review chat', (to, st) => {
    const w = { chats: [implChat, chat({ harness: to, ...STATES[st] })], runs: [impl, rev] };
    expect(rootReviewer(w, { role: 'sentinel', reviewOf: 'i1', cwd: '/repo' })?.id).toBe('rev');
  });
  it('closed by the user, or in another folder: not reused', () => {
    expect(rootReviewer({ chats: [implChat, chat({ state: 'closed', closedAt: 5, closedBy: 'user' })], runs: [impl, rev] }, { role: 'sentinel', reviewOf: 'i1', cwd: '/repo' })).toBeNull();
    expect(rootReviewer({ chats: [implChat, chat({})], runs: [impl, rev] }, { role: 'sentinel', reviewOf: 'i1', cwd: '/elsewhere' })).toBeNull();
  });
  it('a parent\'s Sentinel child on another engine, closed by itself, still counts', () => {
    const p = { id: 'p', run: { runId: 'pr', taskId: 'pt' } } as unknown as ChatSummary;
    const kid = { ...chat({ id: 'kid', harness: 'codex', ...STATES.auto, parentId: 'p' }), delegation: { role: 'sentinel', goal: '', doneWhen: [], at: 1, result: { outcome: 'done', summary: '', at: 2 } }, run: { ...rev, chatId: 'kid', parentRunId: 'pr' } } as unknown as ChatSummary;
    expect(childReviewers({ chats: [p, kid], runs: [] }, p, '/repo').map(c => c.id)).toEqual(['kid']);
  });
});
