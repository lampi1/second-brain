// The question ladder (ADR 0344, main/chats/manager-ladder.ts) on a real ChatManager with fake engines: a worker's
// question goes to its Strategist and not to the panel, then to the Orchestrator, then to the user; the answer reaches
// the still open request; a level closed, in error or silent never hangs it; a restart keeps it; permissions, commands
// and plans are never held; who answered and why stays in the chat and on the record. Time is the test's (fake timers).
import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Answer, ChatSummary, PendingRequest } from '../../../src/shared/contract';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import { LADDER_TOOL } from '../../../src/main/chats/manager-ladder';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { LADDER_SILENT_MS, openQuestions } from '../../../src/shared/question-ladder';
import { closeAppDbs } from '../../../src/main/app-db';
import { isWorkRole, ROLE_DEFAULTS } from '../../../src/shared/roles';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const m of managers.splice(0)) await m.shutdown();
  closeAppDbs();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ladder-'))); roots.push(d); return d; };

interface World { dir: string; cwd: string; sent: Map<string, string[]>; answers: { chat: string; id: string; answer: Answer }[]; sinks: Map<string, SessionSink>; shown: PendingRequest[]; away: { on: boolean }; deaf: Set<string> }
const world = (): World => ({ dir: tmp(), cwd: tmp(), sent: new Map(), answers: [], sinks: new Map(), shown: [], away: { on: false }, deaf: new Set() });
function manager(w: World, extra: Partial<ChatManagerOptions> = {}): ChatManager {
  const m = new ChatManager({ userData: w.dir, emitter: { emit: (ch: string, p: unknown) => { if (ch === 'pending:added') w.shown.push(p as PendingRequest); } } as never, coldEveryMs: 0, runEveryMs: 0, away: () => w.away.on, ...extra,
    // a role's chat has a run, as in the app: the Orchestrator's own chats are known by it
    resolveAgent: ((req: { harness: string; roleId?: string }) => req.roleId && isWorkRole(req.roleId)
      ? { request: req, owner: { id: req.roleId, name: ROLE_DEFAULTS[req.roleId].name, purpose: '', engine: 'claude', model: null, revision: 1, source: 'catalog', version: 1 }, instructions: '', policy: null }
      : { request: req, owner: { id: 'plain', name: 'Chat', purpose: '', engine: req.harness, model: null, revision: 0, source: 'plain' }, instructions: '', policy: null }) as never,
    sessionFactory: (_h, o, s: SessionSink) => {
      w.sinks.set(o.chatId, s);
      return {
        harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { if (!o.sessionId) s.changed({ sessionId: crypto.randomUUID() }); s.changed({ state: 'idle' }); },
        send(text: string) { if (w.deaf.has(o.chatId)) throw new Error('engine down'); w.sent.set(o.chatId, [...(w.sent.get(o.chatId) ?? []), text]); },
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
        answer: (id: string, answer: Answer) => { w.answers.push({ chat: o.chatId, id, answer }); s.resolved(id); return true; },
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
  managers.push(m);
  return m;
}

const ask = (id: string, question = 'Uso il nome nuovo?', options = ['Sì (consigliato)', 'No'], tool = 'AskUserQuestion'): Omit<PendingRequest, 'chatId'> =>
  ({ id, type: 'question', tool, title: question, detail: '', input: {}, at: Date.now(), questions: [{ question, multiSelect: false, options: options.map(label => ({ label })) }] });
const chat = (m: ChatManager, id: string): ChatSummary => m.list().find(c => c.id === id)!;
const q = (m: ChatManager, id: string) => chat(m, id).questions!.at(-1)!;
const codes = (m: ChatManager, id: string) => m.items(id).filter(i => i.kind === 'system').map(i => (i as { code?: string }).code).filter(c => c?.startsWith('ladder'));
/** Promises and setImmediate callbacks settle (real ones: only setTimeout and Date are faked). */
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>(r => setImmediate(r)); };
const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
const last = (w: World, id: string) => w.sent.get(id)?.at(-1) ?? '';

/** The Orchestrator, a Strategist it started, and a worker of the Strategist. */
async function team(w: World, o: { orchestrator?: boolean; harness?: string } = {}) {
  const m = manager(w);
  const orch = o.orchestrator === false ? null : await m.create({ harness: 'claude', cwd: w.cwd, orchestrator: true });
  const strategist = await m.create({ harness: 'claude', cwd: w.cwd, title: 'Ordini', ...(orch ? { roleId: 'strategist' } : {}) } as never, orch ? 'agent' : 'user');
  const worker = await m.create({ harness: o.harness ?? 'claude', cwd: w.cwd, parentId: strategist.id, title: 'Ordini · Log', delegation: { role: 'scout', goal: 'Leggi i log', doneWhen: ['fatto'], at: Date.now() } } as never, 'agent');
  w.sinks.get(worker.id)!.changed({ state: 'running' });
  return { m, orch: orch!, s: strategist, k: worker };
}
const pend = (w: World, id: string, req: Omit<PendingRequest, 'chatId'>) => { const s = w.sinks.get(id)!; s.pending(req); s.changed({ state: 'waiting' }); };

describe('one level at a time', () => {
  it('a worker\'s question goes to its Strategist and not to the panel; its answer reaches the open request', async () => {
    const w = world(), { m, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    expect(m.pending()).toEqual([]);
    expect(w.shown).toEqual([]);
    expect(chat(m, k.id)).toMatchObject({ state: 'running', pending: 0 });
    expect(q(m, k.id)).toMatchObject({ level: 'strategist', holder: s.id, via: 'request', asks: [{ question: 'Uso il nome nuovo?' }] });
    await flush();
    expect(last(w, s.id)).toContain(`chatId ${k.id} · requestId ${q(m, k.id).id}] Uso il nome nuovo?`);
    const r = await m.ladderReply(s.id, { chatId: k.id, answer: 'Sì', why: 'è nella richiesta' });
    expect(r.askUser).toBe(false);
    expect(w.answers).toHaveLength(1);
    expect(w.answers[0]).toMatchObject({ chat: k.id, id: 'r1' });
    const given = (w.answers[0]!.answer as { answers: Record<string, string> }).answers['Uso il nome nuovo?']!;
    expect(given).toMatch(/^Sì\n\[risposta di .*«Ordini», un agente, non dell’utente · perché: è nella richiesta/);
    expect(w.shown).toEqual([]);
    expect(openQuestions(chat(m, k.id).questions)).toEqual([]);
  });

  it('askUser goes to the Orchestrator, then to the user with the same words; his answer reaches the open request', async () => {
    const w = world(), { m, orch, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    await m.ladderReply(s.id, { chatId: k.id, askUser: true, why: 'non è scritto' });
    expect(q(m, k.id)).toMatchObject({ level: 'orchestrator', holder: orch.id });
    expect(m.pending()).toEqual([]);
    await flush();
    expect(last(w, orch.id)).toContain('app_resolve_question');
    // only who holds it now may answer
    await expect(m.ladderReply(s.id, { chatId: k.id, answer: 'Sì', why: 'x' })).rejects.toThrow(/Nessuna domanda/);
    await m.ladderReply(orch.id, { chatId: k.id, requestId: q(m, k.id).id, askUser: true });
    expect(m.pending().map(p => [p.chatId, p.id, p.title])).toEqual([[k.id, 'r1', 'Uso il nome nuovo?']]);
    expect(w.shown.map(p => p.id)).toEqual(['r1']);
    expect(chat(m, k.id)).toMatchObject({ state: 'waiting', pending: 1 });
    await m.answer(k.id, 'r1', { kind: 'question', answers: { 'Uso il nome nuovo?': 'No' } });
    expect(w.answers.at(-1)).toMatchObject({ chat: k.id, id: 'r1', answer: { answers: { 'Uso il nome nuovo?': 'No' } } });
    expect(q(m, k.id).answered).toMatchObject({ by: 'user', name: 'utente', answer: 'No' });
    expect(q(m, k.id).trail.map(t => [t.level, t.action])).toEqual([['strategist', 'asked'], ['strategist', 'passed'], ['orchestrator', 'asked'], ['orchestrator', 'passed'], ['user', 'asked'], ['user', 'answered']]);
  });

  it('a worker the Orchestrator started asks the Orchestrator; its Strategist\'s own question too', async () => {
    const w = world(), { m, orch, s } = await team(w);
    pend(w, s.id, ask('r1'));
    expect(q(m, s.id)).toMatchObject({ level: 'orchestrator', holder: orch.id });
    const scout = await m.create({ harness: 'claude', cwd: w.cwd, title: 'Log', roleId: 'scout' } as never, 'agent');
    pend(w, scout.id, ask('r2', 'Quale file leggo?'));
    expect(q(m, scout.id)).toMatchObject({ level: 'orchestrator', holder: orch.id });
    expect(m.pending()).toEqual([]);
    expect(m.ladderHeldBy(orch.id).map(h => h.chatId).sort()).toEqual([s.id, scout.id].sort());
    await m.ladderReply(orch.id, { chatId: scout.id, answer: 'main.log', why: 'è nella richiesta' });
    expect(w.answers.at(-1)).toMatchObject({ chat: scout.id, id: 'r2' });
  });

  it('a chat the user opened asks him directly; the Orchestrator too', async () => {
    const w = world(), m = manager(w);
    const orch = await m.create({ harness: 'claude', cwd: w.cwd, orchestrator: true });
    const own = await m.create({ harness: 'claude', cwd: w.cwd, title: 'Mia' });
    pend(w, own.id, ask('r1'));
    pend(w, orch.id, ask('r2', 'Parto?'));
    expect(m.pending().map(p => p.id).sort()).toEqual(['r1', 'r2']);
    expect(chat(m, own.id).questions ?? []).toEqual([]);
  });

  it('asked once: the same question again, in either shape, is the same question', async () => {
    const w = world(), { m, s, k } = await team(w);
    expect(m.ladderAsk(k.id, { question: 'Uso il nome nuovo?', options: [] }).asked).toContain('«Ordini»');
    m.ladderAsk(k.id, { question: 'Uso il nome nuovo?', options: [] });
    pend(w, k.id, ask('r1')); // now it can not go on without it: the request takes the question's place
    await flush();
    expect(chat(m, k.id).questions).toHaveLength(1);
    expect(q(m, k.id)).toMatchObject({ via: 'request', requestId: 'r1' });
    expect((w.sent.get(s.id) ?? []).filter(t => t.includes('[domanda ·'))).toHaveLength(1);
    await m.ladderReply(s.id, { chatId: k.id, answer: 'Sì', why: 'codice: src/x.ts' });
    expect(w.answers.map(a => a.id)).toEqual(['r1']);
  });

  it('the Orchestrator asking a held question as its own sends that one to the user: never two', async () => {
    const w = world(), { m, orch, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    await m.ladderReply(s.id, { chatId: k.id, askUser: true });
    pend(w, orch.id, ask('o1'));
    expect(m.pending().map(p => [p.chatId, p.id])).toEqual([[k.id, 'r1']]);
    expect(w.answers.find(a => a.id === 'o1')).toBeDefined(); // told by the app that it is already in his row
  });

  it('agent_ask_parent: the answer arrives as a message, the worker goes on meanwhile; the user\'s too', async () => {
    const w = world(), { m, orch, s, k } = await team(w);
    m.ladderAsk(k.id, { question: 'Quanti giorni?', options: ['7', '30'], why: 'cambia i log' });
    await flush();
    expect(last(w, s.id)).toContain('Perché: cambia i log');
    await m.ladderReply(s.id, { chatId: k.id, answer: '7', why: 'è nella richiesta' });
    expect(last(w, k.id)).toContain('[risposta alla tua domanda «Quanti giorni?»]\n7\n[risposta di');
    m.ladderAsk(k.id, { question: 'Anche i resi?', options: [] });
    await m.ladderReply(s.id, { chatId: k.id, askUser: true });
    await m.ladderReply(orch.id, { chatId: k.id, askUser: true });
    const card = m.pending()[0]!;
    expect(card).toMatchObject({ chatId: k.id, tool: LADDER_TOOL, title: 'Anche i resi?' });
    await m.answer(k.id, card.id, { kind: 'question', answers: { 'Anche i resi?': 'Sì' } });
    await flush();
    expect(last(w, k.id)).toContain('[risposta dell’utente alla tua domanda «Anche i resi?», data nell’app]\nSì');
    expect(m.pending()).toEqual([]);
  });
});

describe('a level that can not answer never hangs the question', () => {
  it('silent 10 minutes: up to the Orchestrator, 10 more: to the user', async () => {
    const w = world(), { m, orch, k } = await team(w);
    fake();
    pend(w, k.id, ask('r1'));
    await vi.advanceTimersByTimeAsync(LADDER_SILENT_MS - 1);
    expect(q(m, k.id).level).toBe('strategist');
    await vi.advanceTimersByTimeAsync(1);
    expect(q(m, k.id)).toMatchObject({ level: 'orchestrator', holder: orch.id });
    await vi.advanceTimersByTimeAsync(LADDER_SILENT_MS);
    expect(q(m, k.id).level).toBe('user');
    expect(m.pending().map(p => p.id)).toEqual(['r1']);
    expect(q(m, k.id).trail.filter(t => t.action === 'skipped').map(t => t.why)).toEqual(['silenziosa da 10 minuti', 'silenziosa da 10 minuti']);
    expect(codes(m, k.id)).toEqual(['ladderAsked', 'ladderPassed', 'ladderPassed']);
  });

  it('parent closed: it skips to the Orchestrator, whether closed before or while it holds the question', async () => {
    const w = world(), { m, orch, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    // closed by itself (its worker goes on; the user's own ✕ cancels the worker too)
    const rec = (m as unknown as { chats: Map<string, { s: ChatSummary }> }).chats.get(s.id)!;
    rec.s.closedAt = Date.now(); rec.s.closedBy = 'auto';
    w.sinks.get(s.id)!.changed({ state: 'closed' });
    await flush();
    expect(q(m, k.id)).toMatchObject({ level: 'orchestrator', holder: orch.id });
    await m.ladderReply(orch.id, { chatId: k.id, answer: 'Sì', why: 'richiesta' });
    pend(w, k.id, ask('r2', 'Quale file leggo?'));
    expect(q(m, k.id)).toMatchObject({ level: 'orchestrator', holder: orch.id });
    expect(q(m, k.id).trail[0]).toMatchObject({ level: 'strategist', action: 'skipped', why: 'chat chiusa' });
  });

  it('parent in error, or out of turns: up at once', async () => {
    const w = world(), { m, orch, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    w.sinks.get(s.id)!.changed({ state: 'error', lastError: 'boom' } as never);
    expect(q(m, k.id)).toMatchObject({ level: 'orchestrator', holder: orch.id });
    const w2 = world(), t2 = await team(w2);
    w2.sinks.get(t2.s.id)!.item({ kind: 'result', id: 'x', at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: true } as never, false);
    w2.sinks.get(t2.s.id)!.changed({ state: 'idle' });
    pend(w2, t2.k.id, ask('r1'));
    expect(q(t2.m, t2.k.id).level).not.toBe('strategist');
  });

  it('parent that can not be woken: up', async () => {
    const w = world(), { m, orch, s, k } = await team(w);
    w.deaf.add(s.id);
    pend(w, k.id, ask('r1'));
    await vi.waitFor(() => expect(q(m, k.id)).toMatchObject({ holder: orch.id }));
  });

  it('no Orchestrator open: the Strategist, then the user', async () => {
    const w = world(), { m, s, k } = await team(w, { orchestrator: false });
    pend(w, k.id, ask('r1'));
    expect(q(m, k.id).holder).toBe(s.id);
    await m.ladderReply(s.id, { chatId: k.id, askUser: true });
    expect(m.pending().map(p => p.id)).toEqual(['r1']);
  });

  it('withdrawn by its engine: nobody waits for it; the worker closed: the same', async () => {
    const w = world(), { m, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    w.sinks.get(k.id)!.resolved('r1');
    await flush();
    expect(q(m, k.id).answered).toMatchObject({ by: 'app', why: 'domanda ritirata dal suo motore' });
    await expect(m.ladderReply(s.id, { chatId: k.id, answer: 'Sì', why: 'x' })).rejects.toThrow(/Nessuna domanda/);
    expect(m.pending()).toEqual([]);
  });
});

describe('a restart keeps the open question', () => {
  const restart = async (w: World, m: ChatManager): Promise<ChatManager> => {
    await m.shutdown(); closeAppDbs();
    w.sinks.clear(); w.sent.clear(); w.answers.length = 0; w.shown.length = 0;
    const next = manager(w);
    next.resumeInterrupted();
    await flush();
    return next;
  };
  it('held by the Strategist: it is woken again, its answer reaches the worker as a message', async () => {
    const w = world(), { m, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    const id = q(m, k.id).id, next = await restart(w, m);
    expect(q(next, k.id)).toMatchObject({ id, level: 'strategist', holder: s.id, via: 'message' });
    await vi.waitFor(() => expect(last(w, s.id)).toContain(`requestId ${id}`));
    await next.ladderReply(s.id, { chatId: k.id, answer: 'Sì', why: 'è nella richiesta' });
    expect(w.sent.get(k.id)!.join('\n')).toContain('[risposta alla tua domanda «Uso il nome nuovo?»]\nSì');
    expect(q(next, k.id).answered).toMatchObject({ by: 'strategist' });
  });
  it('held by the Orchestrator: woken again and silent 10 minutes after the start: the user', async () => {
    const w = world(), { m, orch, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    await m.ladderReply(s.id, { chatId: k.id, askUser: true });
    await m.shutdown(); closeAppDbs(); w.sinks.clear(); w.sent.clear(); w.shown.length = 0;
    fake();
    const next = manager(w);
    next.resumeInterrupted();
    await flush();
    expect(q(next, k.id)).toMatchObject({ level: 'orchestrator', holder: orch.id });
    await vi.advanceTimersByTimeAsync(LADDER_SILENT_MS);
    await flush();
    expect(q(next, k.id).level).toBe('user');
    expect(next.pending().filter(p => p.chatId === k.id)).toHaveLength(1);
  });
  it('already the user\'s: the app shows it again with the same words; the engine asking it again takes its place', async () => {
    const w = world(), { m, orch, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    await m.ladderReply(s.id, { chatId: k.id, askUser: true });
    await m.ladderReply(orch.id, { chatId: k.id, askUser: true });
    const next = await restart(w, m);
    expect(next.pending().map(p => [p.tool, p.title])).toEqual([[LADDER_TOOL, 'Uso il nome nuovo?']]);
    await vi.waitFor(() => expect(w.sinks.has(k.id)).toBe(true)); // its cut turn resumed
    pend(w, k.id, ask('r9'));
    expect(next.pending().map(p => [p.tool, p.id])).toEqual([['AskUserQuestion', 'r9']]);
    expect(chat(next, k.id).questions).toHaveLength(1);
  });
});

describe('what is never held or answered by an agent', () => {
  it('a permission, an MCP form and a plan to approve of a worker are never held', async () => {
    const w = world(), { m, k } = await team(w);
    const s = w.sinks.get(k.id)!;
    s.pending({ id: 'plan', type: 'permission', tool: 'ExitPlanMode', title: 'Piano', detail: '', input: {}, at: Date.now() });
    s.pending(ask('cursor', 'Piano pronto: approvi?', ['Sì', 'No'], 'CreatePlan'));
    s.pending(ask('form', 'Quale campo?', ['Sì', 'No'], 'mcp__fixture'));
    expect(m.pending().filter(p => p.ladder)).toEqual([]);
    expect(chat(m, k.id).questions ?? []).toEqual([]);
    expect(m.pending().map(p => p.id)).toEqual(expect.arrayContaining(['cursor', 'form']));
  });
  it('a permission request is in the user\'s row while a question of the same worker is held, and no holder can answer it', async () => {
    const w = world(), { m, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    const recs = (m as unknown as { chats: Map<string, { pending: Map<string, PendingRequest> }> }).chats;
    // put straight in its list: the default rules would allow it by themselves (auto-permit)
    recs.get(k.id)!.pending.set('p1', { id: 'p1', chatId: k.id, type: 'permission', tool: 'Bash', title: 'az webapp restart', detail: '', input: {}, at: Date.now() });
    expect(m.pending().map(p => p.id)).toEqual(['p1']);
    await expect(m.ladderReply(s.id, { chatId: k.id, requestId: 'p1', answer: 'Sì', why: 'x' })).rejects.toThrow(/Nessuna domanda/);
    expect(w.answers).toEqual([]);
  });
  it('a held question about production, a database or Azure reaches the user: no level answers it', async () => {
    for (const question of ['Faccio il deploy in produzione?', 'Aggiorno la tabella nel database?', 'Riavvio la risorsa Azure?', 'Lo diciamo ai clienti?']) {
      const w = world(), { m, orch, s, k } = await team(w);
      pend(w, k.id, ask('r1', question));
      await expect(m.ladderReply(s.id, { chatId: k.id, answer: 'Sì', why: 'è nella richiesta' })).rejects.toThrow(/solo l’utente/);
      await m.ladderReply(s.id, { chatId: k.id, askUser: true });
      await expect(m.ladderReply(orch.id, { chatId: k.id, answer: 'Sì', why: 'è nella richiesta' })).rejects.toThrow(/solo l’utente/);
      await m.ladderReply(orch.id, { chatId: k.id, askUser: true });
      expect(m.pending().map(p => p.id)).toEqual(['r1']);
      expect(() => m.answerForUser(k.id, 'r1', { kind: 'question', answers: { [question]: 'Sì' } })).toThrow(/solo l’utente/);
      expect(w.answers).toEqual([]);
      await m.answer(k.id, 'r1', { kind: 'question', answers: { [question]: 'Sì' } });
      expect(w.answers.map(a => a.id)).toEqual(['r1']);
    }
  });
  it('the Orchestrator may not answer for the user what an agent still holds; an answer needs its source', async () => {
    const w = world(), { m, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    expect(() => m.answerForUser(k.id, 'r1', { kind: 'question', answers: { 'Uso il nome nuovo?': 'Sì' } })).toThrow(/ancora di un agente/);
    await expect(m.ladderReply(s.id, { chatId: k.id, answer: 'Sì' })).rejects.toThrow(/why/);
    await expect(m.ladderReply(s.id, { chatId: k.id, why: 'x' })).rejects.toThrow(/answer/);
    expect(w.answers).toEqual([]);
  });
  it('night mode is as before: the app answers first, nothing is held; switched on later it answers the held one at the user\'s level', async () => {
    const w = world(), { m, orch, s, k } = await team(w);
    w.away.on = true;
    pend(w, k.id, ask('r1'));
    expect(w.answers).toMatchObject([{ id: 'r1', answer: { answers: { 'Uso il nome nuovo?': 'Sì (consigliato)' } } }]);
    expect(chat(m, k.id).questions ?? []).toEqual([]);
    w.away.on = false;
    pend(w, k.id, ask('r2', 'Quale file leggo?', ['Il primo (consigliato)', 'Il secondo']));
    await m.ladderReply(s.id, { chatId: k.id, askUser: true });
    w.away.on = true;
    await m.ladderReply(orch.id, { chatId: k.id, askUser: true });
    expect(w.answers.at(-1)).toMatchObject({ id: 'r2' });
    expect(q(m, k.id).answered).toMatchObject({ by: 'app', name: 'Modalità notte' });
  });
});

describe('who answered and why', () => {
  it('a line in the worker\'s chat and the field the map reads', async () => {
    const w = world(), { m, s, k } = await team(w);
    pend(w, k.id, ask('r1'));
    await m.ladderReply(s.id, { chatId: k.id, answer: 'Sì', why: 'decisione del 12/11' });
    const line = m.items(k.id).find(i => i.kind === 'system' && i.code === 'ladderAnswered') as { params: Record<string, string> };
    expect(line.params).toMatchObject({ question: 'Uso il nome nuovo?', answer: 'Sì', why: 'decisione del 12/11' });
    expect(line.params.who).toContain('«Ordini»');
    expect(q(m, k.id)).toMatchObject({ level: 'strategist', answered: { by: 'strategist', chatId: s.id, answer: 'Sì', why: 'decisione del 12/11' }, trail: [{ level: 'strategist', chatId: s.id, action: 'asked' }, { level: 'strategist', action: 'answered' }] });
    expect(q(m, k.id).answered!.name).toContain('«Ordini»');
    // kept across a restart
    await m.shutdown(); closeAppDbs();
    const next = manager(w);
    expect(q(next, k.id).answered).toMatchObject({ by: 'strategist', why: 'decisione del 12/11' });
  });
  it('a Strategist\'s interview answered by the Orchestrator is an agent\'s answer, never one of the user\'s', async () => {
    const w = world(), { m, orch, s } = await team(w);
    pend(w, s.id, ask('r1'));
    await m.ladderReply(orch.id, { chatId: s.id, answer: 'Sì', why: 'codice' });
    expect(chat(m, s.id).plan?.clarified ?? []).toEqual([]);
    expect(q(m, s.id).answered).toMatchObject({ by: 'orchestrator', name: 'Orchestrator' });
  });
});

describe('every engine\'s question passes by the same gate', () => {
  // the tool name each engine's adapter gives its question: claude.ts, codex.ts, acp.ts (cursor/ask_question, ask_user)
  for (const [harness, tool] of [['claude', 'AskUserQuestion'], ['codex', 'AskQuestion'], ['cursor', 'AskQuestion'], ['cursor', 'AskUser'], ['opencode', 'AskUser'], ['antigravity', 'AskUser']] as const) {
    it(`${harness} · ${tool}: held, answered into its request`, async () => {
      const w = world(), { m, s, k } = await team(w, { harness });
      pend(w, k.id, ask('r1', 'Uso il nome nuovo?', ['Sì', 'No'], tool));
      expect(q(m, k.id)).toMatchObject({ holder: s.id, level: 'strategist' });
      expect(m.pending()).toEqual([]);
      await m.ladderReply(s.id, { chatId: k.id, answer: 'Sì', why: 'richiesta' });
      expect(w.answers.map(a => [a.chat, a.id])).toEqual([[k.id, 'r1']]);
      expect(openQuestions(chat(m, k.id).questions)).toEqual([]);
    });
  }
});
