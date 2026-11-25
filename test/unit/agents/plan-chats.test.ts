// Work maps on a real ChatManager with fake engines and the real store (ADR 0342): a Strategist has a map with no map call,
// plan_propose without a map cannot leave it without one, a plan approved and kept starts later, a replan of a running
// job keeps what started and starts nothing new before the approval, the removed step stops at that approval, stop and
// resume, a closed chat leaves its map stopped, a restart keeps maps and plans, an old plan gets its map once. The live
// status (plans/live.ts): a step whose chat is closed, removed or lost at a restart is not «now» for ever, and what its
// chat does shows on it. An open doubt holds the approval and the start on every path (ADR 0344): the map's buttons, the
// Orchestrator's actions and row, the phone, his typed words, night mode.
// Pins plans/service.ts with chats/manager-work.ts planDecide (keep), planStart, planStop, planResume, planReplan and
// planPutAway, shared/strategy.ts (approved, stopped, drop, remove) and manager.ts create (planId, resumePlan).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { appControlTools } from '../../../src/main/appctl/tools';
import { delegationTools } from '../../../src/main/agents/delegation';
import { strategyTools } from '../../../src/main/agents/strategy-tools';
import { CoordinationStore } from '../../../src/main/coordination/store';
import { Plans } from '../../../src/main/plans/service';
import { strategistStarter } from '../../../src/main/plans/start';
import { planAction } from '../../../src/main/plans/tools';
import { PlanStore } from '../../../src/main/plans/store';
import type { AgentCatalog } from '../../../src/shared/agents';
import type { NewChat } from '../../../src/shared/contract';
import { DELEGATION_DEFAULTS, isWorkRole, ROLE_DEFAULTS, ROLE_IDS, type RoleId } from '../../../src/shared/roles';
import type { PlanDoubt } from '../../../src/shared/plan-doubts';
import { ENOUGH_QUESTIONS, PLAN_APPROVED, PLAN_REPLAN, PLAN_REPROPOSE, PLAN_RESUMED, type StrategyPlan } from '../../../src/shared/strategy';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const catalog = (): AgentCatalog => ({ problem: null, archived: [], models: [], profiles: ROLE_IDS.map(id => {
  const r = ROLE_DEFAULTS[id];
  return { id, name: r.name, purpose: r.summary, scope: 'role', engine: 'claude', model: null, tier: r.tier, tierMax: r.tierMax, launches: [...r.launches], skills: r.skills, tools: { allow: [...r.tools] }, permissionCeiling: r.ceiling, activeVersion: 1, updatedAt: 1, instructions: r.instructions };
}) } as unknown as AgentCatalog);

/** A manager and the maps over it, on a folder: a second call on the same folder is a restart. */
function fixture(opts: { dir?: string; away?: boolean; withMaps?: boolean } = {}) {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-plans-'));
  if (!opts.dir) roots.push(dir);
  const sinks = new Map<string, SessionSink>(), sent = new Map<string, string[]>(), interrupted: string[] = [];
  let maps: Plans | undefined;
  const m = new ChatManager({ userData: dir, emitter: { emit: (ch: string, p: unknown) => maps?.observe(ch, p) } as never, coldEveryMs: 0, runEveryMs: 0, away: () => !!opts.away,
    resolveAgent: (req: NewChat) => {
      const id = req.orchestrator ? 'orchestrator' : req.roleId as RoleId | undefined;
      if (!id || (!isWorkRole(id) && id !== 'orchestrator')) return { request: req, owner: { id: 'plain', name: 'Chat', purpose: '', engine: req.harness, model: null, revision: 0, source: 'plain' as const }, instructions: '', policy: null, skills: [], launches: [] };
      const r = ROLE_DEFAULTS[id];
      return { request: req, owner: { id, name: r.name, purpose: r.summary, engine: 'claude', model: null, revision: 1, source: 'catalog' as const, version: 1 }, instructions: r.instructions, policy: { tools: { allow: [...r.tools] }, ceiling: r.ceiling },
        skills: [...r.skills, ...(req.skills ?? [])], launches: [...r.launches], assets: { pluginDir: path.join(dir, 'p'), skillRoot: path.join(dir, 'p', 'skills') } };
    },
    sessionFactory: (_h: unknown, o: SessionOptions, s: SessionSink) => {
      sinks.set(o.chatId, s);
      return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { s.changed({ state: 'idle' }); }, send(text: string) { sent.set(o.chatId, [...(sent.get(o.chatId) ?? []), text]); },
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => { interrupted.push(o.chatId); },
        answer: () => true, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
  managers.push(m);
  const attach = () => {
    maps = new Plans({ store: new PlanStore(path.join(dir, 'plans')), chats: m, emit: () => {}, startStrategist: strategistStarter({ chats: m, harness: () => 'claude', folderOf: () => dir }) });
    maps.adopt();
    return maps;
  };
  if (opts.withMaps !== false) attach();
  const tools = [...strategyTools(m), ...delegationTools({ chats: m, roles: catalog, settings: () => ({ ...DELEGATION_DEFAULTS }), engineRefusal: () => null, label: '[agente]', runs: () => m.runs.list(), now: () => Date.now() })];
  const call = async (name: string, chatId: string, args: Record<string, unknown>) => JSON.parse(await tools.find(t => t.name === name)!.run(args, { mount: 'chat', params: { chatId }, sessionId: '', signal: new AbortController().signal } as never) as string);
  const root = (by: 'user' | 'agent' = 'agent') => m.create({ harness: 'claude', cwd: dir, roleId: 'strategist', title: 'Sconti in percentuale', prompt: 'Porta gli sconti in percentuale' }, by);
  /** the user's answer that opens the way to a proposal today */
  const enough = async (chatId: string) => {
    const q = { question: 'Vuoi aggiungere vincoli?', options: [{ label: 'Sì' }, { label: 'No' }], multiSelect: false }, id = `q-${chatId}`;
    sinks.get(chatId)!.pending({ id, type: 'question', tool: 'AskUserQuestion', title: q.question, detail: '', input: {}, questions: [q], at: Date.now() });
    await m.answer(chatId, id, { kind: 'question', answers: { [q.question]: ENOUGH_QUESTIONS } }, 'pc');
  };
  const proposed = async () => { const s = await root(); await enough(s.id); await call('plan_propose', s.id, PLAN); return s; };
  const task = (role: string, title: string, step: number) => ({ tasks: [{ role, title, step, contract: { goal: `Goal of ${title}`, doneWhen: ['criterion A'] } }] });
  const kids = (id: string) => m.list().filter(c => c.parentId === id);
  const mapOf = (id: string) => maps!.ofChat(id)!;
  return { m, dir, sent, sinks, interrupted, call, root, enough, proposed, task, kids, mapOf, attach, maps: () => maps! };
}
const PLAN = { steps: [{ title: 'Trovo dove si calcola lo sconto', role: 'scout', after: [] }, { title: 'Applico lo sconto', role: 'artisan', after: [1] }, { title: 'Scrivo il riepilogo', after: [2] }], doneWhen: 'I test passano' };
type F = ReturnType<typeof fixture>;
const planAt = (f: F, id: string) => f.mapOf(id).plan!.at;
const act = (f: F, id: string, action: Parameters<Plans['act']>[1], text?: string) => f.maps().act(f.mapOf(id).id, action, { at: f.mapOf(id).plan?.at, text });

describe('a Strategist always has a work map', () => {
  it('started by the Orchestrator or by the user, with no map call', async () => {
    const f = fixture(), a = await f.root('agent'), u = await f.root('user');
    expect(f.mapOf(a.id)).toMatchObject({ title: 'Sconti in percentuale', idea: 'Porta gli sconti in percentuale', state: 'idea', plan: { phase: 'asking' } });
    expect(f.mapOf(u.id)).toMatchObject({ title: 'Sconti in percentuale · 2', idea: 'Porta gli sconti in percentuale', owner: { chatId: u.id } });
    expect(f.maps().list()).toHaveLength(2);
  });

  it('plan_propose without a map cannot leave it without one; a plan of one step has one too', async () => {
    const f = fixture(), s = await f.root();
    await f.enough(s.id);
    await f.call('plan_propose', s.id, { steps: [{ title: 'Un passo solo', role: 'artisan', preset: 'max', after: [] }] });
    expect(f.mapOf(s.id)).toMatchObject({ state: 'toApprove', plan: { steps: [{ id: 's1', title: 'Un passo solo', role: 'artisan', preset: 'max' }] } });
    expect(f.maps().view(f.mapOf(s.id).id)!.steps).toMatchObject([{ n: 1, title: 'Un passo solo', role: 'artisan', preset: 'max', state: 'todo' }]);
    expect(f.maps().list()).toHaveLength(1);
  });

  it('plan_update writes the map too', async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'approve');
    await f.call('plan_update', s.id, { step: 3, state: 'now' });
    expect(f.mapOf(s.id).plan!.steps.map(x => x.state)).toEqual(['todo', 'todo', 'now']);
    expect(f.maps().view(f.mapOf(s.id).id)!.history.at(-1)!.summary).toBe('Passo 3 in corso: Scrivo il riepilogo');
  });
});

describe('an idea', () => {
  it('has a map and no chat; started, a Strategist asks about it and owns the same map', async () => {
    const f = fixture(), idea = f.maps().idea({ title: 'Sconti a fasce', idea: 'Per quantità' });
    expect(f.m.list()).toEqual([]);
    const started = await f.maps().act(idea.id, 'start'), chat = f.m.list()[0]!;
    expect(started).toMatchObject({ id: idea.id, owner: { chatId: chat.id }, state: 'idea', plan: { phase: 'asking' } });
    expect(chat).toMatchObject({ planId: idea.id, agent: { id: 'strategist' } });
    expect(f.maps().list()).toHaveLength(1);
    // the usual gate: nothing is delegated before the user's ok
    await expect(f.call('agent_delegate', chat.id, f.task('scout', 'Sconti · Dove', 1))).rejects.toThrow(/refused/);
  });
});

describe('planned and started later', () => {
  it('keep approves and records it, sends nothing and starts nothing; start sends the approval', async () => {
    const f = fixture(), s = await f.proposed(), at = planAt(f, s.id), before = f.sent.get(s.id)?.length ?? 0;
    expect((await act(f, s.id, 'keep')).state).toBe('planned');
    expect(f.sent.get(s.id)?.length ?? 0).toBe(before);
    await expect(f.call('agent_delegate', s.id, f.task('scout', 'Sconti · Dove', 1))).rejects.toThrow(/keeps it for later/);
    await expect(f.call('plan_update', s.id, { step: 3, state: 'now' })).rejects.toThrow(/not approved/);
    expect((await act(f, s.id, 'start')).state).toBe('running');
    expect(f.sent.get(s.id)!.at(-1)).toBe(PLAN_APPROVED);
    await f.call('agent_delegate', s.id, f.task('scout', 'Sconti · Dove', 1));
    expect(f.mapOf(s.id).plan!.steps[0]!.state).toBe('now');
    await f.m.shutdown();
    const store = new CoordinationStore(path.join(f.dir, 'app.db'));
    try { expect(store.original(s.id, `plan:${at}`)).toMatchObject({ state: 'accepted', decision: { actor: { kind: 'user', channel: 'pc' }, answer: { decision: 'approve', keep: true } } }); } finally { store.close(); }
  });

  it('a plan the user did not see is refused, and a second approval too', async () => {
    const f = fixture(), s = await f.proposed(), id = f.mapOf(s.id).id, at = planAt(f, s.id);
    await expect(f.maps().act(id, 'keep', { at: at - 1 })).rejects.toThrow();
    expect(f.mapOf(s.id).state).toBe('toApprove');
    await f.maps().act(id, 'keep', { at });
    await expect(f.maps().act(id, 'approve', { at })).rejects.toThrow(/Non si può approvare/);
  });

  it('kept, then changed: the plan is proposed again', async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'keep');
    expect((await act(f, s.id, 'replan', 'Meno passi')).state).toBe('idea');
    expect(f.sent.get(s.id)!.at(-1)).toContain('Meno passi');
    await f.call('plan_propose', s.id, { steps: [{ title: 'Tutto insieme', role: 'artisan', after: [] }] });
    expect(f.mapOf(s.id)).toMatchObject({ state: 'toApprove', plan: { steps: [{ id: 's1', title: 'Tutto insieme' }] } });
  });

  it('a kept plan survives a restart and starts after it', async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'keep');
    await f.m.shutdown();
    const g = fixture({ dir: f.dir });
    expect(g.mapOf(s.id)).toMatchObject({ state: 'planned', owner: { chatId: s.id } });
    expect(g.m.planOf(s.id)).toMatchObject({ phase: 'approved' });
  });
});

describe('an open doubt holds the yes on every path (ADR 0344)', () => {
  const OPEN: PlanDoubt = { text: 'Vale anche sulle offerte?', state: 'open' };
  /** A plan saved as waiting, or kept, with a doubt open: plan_propose never leaves one like this, a damaged file can. */
  const plant = (f: F, id: string, doubts: PlanDoubt[]) => {
    const r = (f.m as unknown as { chats: Map<string, { s: { plan: StrategyPlan } }> }).chats.get(id)!;
    r.s.plan = { ...r.s.plan, doubts };
    f.maps().observe('chat:updated', f.m.list().find(c => c.id === id));
  };
  const orchestrator = async (f: F) => {
    const o = await f.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true, title: 'Orchestrator' }, 'user');
    const tool = appControlTools({ chats: f.m, browser: {} as never, brain: {} as never, window: () => null, emitUi: () => {}, version: '0' }, o.id).find(t => t.name === 'app_resolve_question')!;
    return { o, resolve: async (a: Record<string, unknown>) => tool.run(a) };
  };

  it('a plan that waits: the map, the Orchestrator, the phone and typed words are refused, and nothing starts', async () => {
    const f = fixture(), s = await f.proposed(), { o, resolve } = await orchestrator(f), at = planAt(f, s.id), job = f.mapOf(s.id).id;
    plant(f, s.id, [OPEN]);
    const info = f.maps().list().find(i => i.id === job)!, sent = f.sent.get(s.id)?.length ?? 0;
    expect(info.doubts).toEqual({ open: 1, total: 1, first: OPEN.text });
    const blocked = /dubbio aperto/;
    for (const action of ['approve', 'keep'] as const) {
      await expect(act(f, s.id, action)).rejects.toThrow(blocked);
      await expect(planAction(f.maps(), { kind: 'orchestrator' }, { action, plan: job })).rejects.toThrow(blocked);
    }
    for (const keep of [false, true]) await expect(f.m.planDecide(s.id, 'approve', at, undefined, 'pc', keep)).rejects.toThrow(blocked);
    await expect(f.m.planDecide(s.id, 'approve', at, undefined, 'phone')).rejects.toThrow(blocked);
    await expect(f.m.send(s.id, 'approvo')).rejects.toThrow(blocked);
    await expect(resolve({ chatId: s.id, requestId: 'plan', decision: 'approve' })).rejects.toThrow(blocked);
    await f.m.send(o.id, 'Approvo il piano');
    await expect(resolve({ chatId: s.id, requestId: 'plan', words: 'Approvo il piano' })).rejects.toThrow(blocked);
    expect(f.mapOf(s.id)).toMatchObject({ state: 'toApprove', plan: { phase: 'proposed' } });
    expect(f.sent.get(s.id)?.length ?? 0).toBe(sent);
    await expect(f.call('agent_delegate', s.id, f.task('scout', 'Sconti · Dove', 1))).rejects.toThrow(/refused/);
    // asking for a change is not a yes: it goes on
    await f.m.planDecide(s.id, 'change', at, 'Chiarisci le offerte');
    expect(f.mapOf(s.id).plan!.phase).toBe('revising');
  });

  it('closed, with the same plan, every path opens', async () => {
    const f = fixture(), s = await f.proposed();
    plant(f, s.id, [{ ...OPEN, state: 'closed', by: 'code', answer: 'No', source: 'src/offers.ts:4' }]);
    expect((await act(f, s.id, 'keep')).state).toBe('planned');
    expect((await act(f, s.id, 'start')).state).toBe('running');
  });

  it('a kept plan with a doubt that came up after: the start is refused, from the map, the Orchestrator and typed words', async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'keep');
    plant(f, s.id, [OPEN]);
    const sent = f.sent.get(s.id)?.length ?? 0;
    await expect(act(f, s.id, 'start')).rejects.toThrow(/dubbio aperto/);
    await expect(planAction(f.maps(), { kind: 'orchestrator' }, { action: 'start', plan: f.mapOf(s.id).id })).rejects.toThrow(/dubbio aperto/);
    await expect(f.m.planStart(s.id)).rejects.toThrow(/dubbio aperto/);
    await expect(f.m.send(s.id, 'parti')).rejects.toThrow(/dubbio aperto/);
    expect(f.mapOf(s.id).state).toBe('planned');
    expect(f.sent.get(s.id)?.length ?? 0).toBe(sent);
  });

  it('a job the Orchestrator resumes elsewhere gets that folder (review of ADR 0358)', async () => {
    const maps = { get: () => ({ id: 'pl_wm1', title: 'x', plan: { at: 3 } }), act: vi.fn(async () => ({ id: 'pl_wm1', state: 'running' })) };
    await planAction(maps as never, { kind: 'orchestrator' }, { action: 'resume', plan: 'pl_wm1', cwd: '/altra' });
    expect(maps.act).toHaveBeenCalledWith('pl_wm1', 'resume', { at: 3, cwd: '/altra' }, 'Orchestrator');
  });

  it('the map is told when a doubt opens and when it closes, with what closed it', async () => {
    const f = fixture(), s = await f.root();
    await f.call('plan_propose', s.id, { steps: PLAN.steps, doubts: [{ text: OPEN.text }, { text: 'Serve su mobile?', by: 'code', answer: 'Sì', source: 'src/mobile.ts:3' }] });
    const info = () => f.maps().list()[0]!;
    expect(info()).toMatchObject({ state: 'idea', doubts: { open: 1, total: 2, first: OPEN.text } });
    const v = f.mapOf(s.id).version;
    const q = { question: OPEN.text, options: [{ label: 'Sì' }, { label: 'No' }], multiSelect: false };
    f.sinks.get(s.id)!.pending({ id: 'q-d', type: 'question', tool: 'AskUserQuestion', title: q.question, detail: '', input: {}, questions: [q], at: Date.now() });
    expect(f.m.pending()).toHaveLength(1); // a Strategist's own question is his
    await f.m.answer(s.id, 'q-d', { kind: 'question', answers: { [q.question]: 'No' } }, 'pc');
    expect(info().doubts).toEqual({ open: 0, total: 2 });
    expect(f.mapOf(s.id).version).toBeGreaterThan(v);
    expect(f.maps().view(info().id)!.record.plan!.doubts).toMatchObject([{ state: 'closed', by: 'user', answer: 'No' }, { state: 'closed', by: 'code', source: 'src/mobile.ts:3' }]);
  });

  it('night mode: the plan waits with its doubt open, and starts once it is closed', async () => {
    const f = fixture({ away: true }), s = await f.root();
    await f.call('plan_propose', s.id, { steps: PLAN.steps, doubts: [{ text: OPEN.text }] });
    expect(f.mapOf(s.id)).toMatchObject({ state: 'idea', plan: { phase: 'asking' } });
    await f.call('plan_propose', s.id, { steps: PLAN.steps, doubts: [{ text: OPEN.text, by: 'choice', answer: 'No', source: 'più prudente' }] });
    expect(f.mapOf(s.id)).toMatchObject({ state: 'running', plan: { doubts: [{ by: 'choice' }] } });
  });
});

describe('who answered, on the map', () => {
  it('a question goes up: asked, passed on with its reason, his; then who answered and why', async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'approve');
    await f.call('agent_delegate', s.id, f.task('scout', 'Sconti · Dove', 1));
    const kid = f.kids(s.id)[0]!.id, asks = () => f.maps().view(f.mapOf(s.id).id)!.questions, versions = f.mapOf(s.id).version;
    f.sinks.get(kid)!.changed({ state: 'idle' });
    f.m.ladderAsk(kid, { question: 'Anche i resi?', options: [] });
    expect(asks()).toMatchObject([{ chatId: kid, n: 1, question: { level: 'strategist', trail: [{ level: 'strategist', action: 'asked' }] } }]);
    await f.m.ladderReply(s.id, { chatId: kid, askUser: true, why: 'non è nella richiesta' });
    expect(asks()[0]!.question).toMatchObject({ level: 'user', trail: [{ action: 'asked' }, { action: 'passed', why: 'non è nella richiesta' }, { level: 'user' }] });
    f.m.ladderAsk(kid, { question: 'Anche gli omaggi?', options: [] });
    await f.call('agent_answer_child', s.id, { chatId: kid, answer: 'No', why: 'lo dice la richiesta' });
    const answered = asks().find(a => a.question.answered)!;
    expect(answered.question.answered).toMatchObject({ by: 'strategist', answer: 'No', why: 'lo dice la richiesta' });
    // a question is not a version of the map
    expect(f.mapOf(s.id).version).toBe(versions);
  });
});

describe('replanning a running job', () => {
  const running = async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'approve');
    await f.call('agent_delegate', s.id, f.task('scout', 'Sconti · Dove', 1));
    return { f, s, kid: f.kids(s.id)[0]!.id };
  };

  it('keeps the started step and starts no new one before the approval', async () => {
    const { f, s, kid } = await running();
    expect(await act(f, s.id, 'replan', 'Aggiungi i resi')).toMatchObject({ state: 'running', plan: { phase: 'revising' } });
    expect(f.sent.get(s.id)!.at(-1)).toContain(PLAN_REPLAN);
    // between the request and the ok: nothing new, before the proposal and after it
    await expect(f.call('agent_delegate', s.id, f.task('artisan', 'Sconti · Faccio', 2))).rejects.toThrow(/refused/);
    await f.call('plan_propose', s.id, { revise: true, steps: [{ keep: 1 }, { title: 'Tolgo i resi', role: 'artisan', after: [] }] });
    expect(f.mapOf(s.id)).toMatchObject({ state: 'toApprove', plan: { steps: [{ state: 'now', chatIds: [kid] }, { title: 'Tolgo i resi', state: 'todo' }] } });
    expect(f.maps().list()[0]).toMatchObject({ replanned: true, can: ['approve', 'keep', 'replan', 'stop'] });
    await expect(f.call('agent_delegate', s.id, f.task('artisan', 'Sconti · Resi', 2))).rejects.toThrow(/refused|waits for the user/);
    expect(f.kids(s.id).map(k => k.id)).toEqual([kid]);
    // the started step goes on meanwhile, and its end does not need the ok
    await f.call('agent_report', kid, { outcome: 'done', summary: 'ok', output: 'o', doneWhen: [{ criterion: 'criterion A', met: true }] });
    expect(f.mapOf(s.id)).toMatchObject({ state: 'toApprove', plan: { steps: [{ state: 'done' }, { state: 'todo' }] } });
    expect((await act(f, s.id, 'approve')).state).toBe('running');
    await f.call('agent_delegate', s.id, f.task('artisan', 'Sconti · Resi', 2));
    expect(f.kids(s.id)).toHaveLength(2);
  });

  it('a request that does not reach the Strategist leaves the plan as it was', async () => {
    const { f, s, kid } = await running(), send = f.m.send.bind(f.m);
    f.m.send = async () => { throw new Error('engine down'); };
    await expect(act(f, s.id, 'replan', 'Aggiungi i resi')).rejects.toThrow('engine down');
    f.m.send = send;
    expect(f.mapOf(s.id)).toMatchObject({ state: 'running', plan: { phase: 'running', steps: [{ state: 'now', chatIds: [kid] }, {}, {}] } });
    expect(f.maps().list()[0]!.planning).toBeFalsy();
    // and it can be asked again
    expect(await act(f, s.id, 'replan', 'Aggiungi i resi')).toMatchObject({ plan: { phase: 'revising' } });
    expect(f.sent.get(s.id)!.at(-1)).toContain('Aggiungi i resi');
  });

  it('a request that does not go out never undoes what changed meanwhile', async () => {
    const { f, s } = await running();
    f.m.send = async () => { await f.m.planStop(s.id); throw new Error('engine down'); };
    await expect(act(f, s.id, 'replan', 'Aggiungi i resi')).rejects.toThrow('engine down');
    expect(f.m.planOf(s.id)).toMatchObject({ phase: 'revising', stopped: true });
  });

  it('a removed step goes on until the approval, and its chat stops then', async () => {
    const { f, s, kid } = await running();
    await act(f, s.id, 'replan', 'Senza la ricerca');
    await expect(f.call('plan_propose', s.id, { revise: true, steps: [{ title: 'Applico', role: 'artisan', after: [] }], remove: [2] })).rejects.toThrow(/has not started/);
    await f.call('plan_propose', s.id, { revise: true, steps: [{ title: 'Applico', role: 'artisan', after: [] }], remove: [1] });
    expect(f.mapOf(s.id).plan!.steps).toMatchObject([{ title: 'Applico', state: 'todo' }, { title: 'Trovo dove si calcola lo sconto', state: 'now', drop: true }]);
    expect(f.m.list().find(c => c.id === kid)!.run?.endedAt).toBeUndefined();
    await act(f, s.id, 'approve');
    expect(f.mapOf(s.id)).toMatchObject({ state: 'running', plan: { steps: [{ id: 's2', title: 'Applico', state: 'todo' }] } });
    const gone = f.m.list().find(c => c.id === kid);
    expect(!gone || gone.closedAt !== undefined || gone.run?.endedAt !== undefined).toBe(true);
  });
});

describe('stop, resume and the owner chat', () => {
  it('stop interrupts and starts nothing more until resume', async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'approve');
    expect(await act(f, s.id, 'stop')).toMatchObject({ state: 'stopped', stopped: { by: 'user' } });
    await expect(f.call('agent_delegate', s.id, f.task('scout', 'Sconti · Dove', 1))).rejects.toThrow(/stopped this job/);
    expect((await act(f, s.id, 'resume')).state).toBe('running');
    expect(f.sent.get(s.id)!.at(-1)).toBe(PLAN_RESUMED);
    await f.call('agent_delegate', s.id, f.task('scout', 'Sconti · Dove', 1));
  });

  it.each([['one under way', false], ['one put away', true]])('a «Riprendi» that does not reach the Strategist leaves the job stopped: %s', async (_name, putAway) => {
    const f = fixture(), s = await f.proposed();
    if (putAway) { await act(f, s.id, 'archive'); await act(f, s.id, 'reopen'); }
    else { await act(f, s.id, 'approve'); await act(f, s.id, 'stop'); }
    const before = structuredClone(f.m.planOf(s.id)!), send = f.m.send.bind(f.m);
    f.m.send = async () => { throw new Error('engine down'); };
    await expect(act(f, s.id, 'resume')).rejects.toThrow('engine down');
    expect(f.m.planOf(s.id)).toEqual(before);
    expect(f.m.planOf(s.id)).toMatchObject({ stopped: true, ...(putAway ? { phase: 'revising', putAway: true } : { phase: 'running' }) });
    expect(f.mapOf(s.id)).toMatchObject({ state: 'stopped', stopped: { by: 'user' } });
    expect(f.maps().list()[0]!.can).toContain('resume');
    expect(f.maps().list()[0]!.planning).toBeFalsy();
    // and it can be resumed again, with the same words
    f.m.send = send;
    expect((await act(f, s.id, 'resume')).state).not.toBe('stopped');
    expect(f.sent.get(s.id)!.at(-1)).toContain(putAway ? PLAN_REPROPOSE : PLAN_RESUMED);
  });

  it('a kept plan whose chat does not open again stays stopped', async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'keep');
    await f.m.planStop(s.id);
    f.m.reopen = async () => { throw new Error('no engine'); };
    await expect(f.m.planResume(s.id)).rejects.toThrow('no engine');
    expect(f.m.planOf(s.id)).toMatchObject({ phase: 'approved', stopped: true });
  });

  it('a «Riprendi» that does not go out never undoes what changed meanwhile', async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'approve');
    await act(f, s.id, 'stop');
    f.m.send = async () => { await f.call('plan_update', s.id, { step: 3, state: 'now' }); throw new Error('engine down'); };
    await expect(act(f, s.id, 'resume')).rejects.toThrow('engine down');
    expect(f.m.planOf(s.id)!.steps.map(x => x.state)).toEqual(['todo', 'todo', 'now']);
  });

  it('closing the owner chat leaves the map stopped, not removed; resume opens it again', async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'approve');
    await f.m.archive(s.id);
    expect(f.mapOf(s.id)).toMatchObject({ state: 'stopped', stopped: { by: 'closed' }, plan: { phase: 'running', steps: [{}, {}, {}] } });
    expect((await act(f, s.id, 'resume')).state).toBe('running');
    expect(f.m.list().find(c => c.id === s.id)!.closedAt).toBeUndefined();
  });

  it('removed from the app for good: the map keeps the plan, and resume asks a new Strategist', async () => {
    const f = fixture(), s = await f.proposed(), id = f.mapOf(s.id).id;
    await f.m.archive(s.id);
    await f.m.close(s.id);
    expect(f.maps().get(id)).toMatchObject({ state: 'stopped', stopped: { by: 'gone' }, plan: { phase: 'proposed', steps: [{}, {}, {}] } });
    const back = await f.maps().act(id, 'resume'), chat = f.m.list().find(c => c.id === back.owner!.chatId)!;
    expect(back).toMatchObject({ id, past: [s.id], state: 'idea', plan: { phase: 'asking', steps: [{}, {}, {}] } });
    expect(chat.planId).toBe(id);
    await expect(f.call('agent_delegate', chat.id, f.task('scout', 'Sconti · Dove', 1))).rejects.toThrow(/refused/);
  });

  it('a plan that waits, put in the archive: answered, and the Strategist is not called', async () => {
    const f = fixture(), s = await f.proposed(), before = f.sent.get(s.id)?.length ?? 0;
    expect((await act(f, s.id, 'archive')).state).toBe('archived');
    expect(f.sent.get(s.id)?.length ?? 0).toBe(before);
    expect(f.m.planOf(s.id)!.phase).toBe('revising');
    // reopened, nobody works on it: it reads stopped by the user, and «Riprendi» asks for the plan again
    expect(await act(f, s.id, 'reopen')).toMatchObject({ state: 'stopped', stopped: { by: 'user' } });
    expect(f.maps().list()[0]).toMatchObject({ can: ['resume', 'archive'] });
    expect(f.maps().list()[0]!.planning).toBeFalsy();
    expect((await act(f, s.id, 'resume')).state).not.toBe('stopped');
    expect(f.sent.get(s.id)!.at(-1)).toContain(PLAN_REPROPOSE);
    await f.call('plan_propose', s.id, PLAN);
    expect(f.m.planOf(s.id)!.stopped).toBeUndefined();
    expect(f.mapOf(s.id)).toMatchObject({ state: 'toApprove', plan: { phase: 'proposed' } });
    expect(f.maps().list()[0]!.can).toEqual(expect.arrayContaining(['approve', 'keep']));
    expect((await act(f, s.id, 'approve')).state).toBe('running');
  });

  it('a plan put away and proposed again without «Riprendi» is in front of the user, not stopped', async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'archive');
    await f.m.send(s.id, 'Riproponi il piano');
    await f.call('plan_propose', s.id, PLAN);
    expect(f.m.planOf(s.id)!.stopped).toBeUndefined();
    expect(f.mapOf(s.id)).toMatchObject({ state: 'toApprove' });
    expect(f.maps().list()[0]!.can).toEqual(expect.arrayContaining(['approve', 'keep']));
  });

  it('a plan put away starts nothing at night when it is proposed again: it waits for the user', async () => {
    const opts = { away: false }, f = fixture(opts), s = await f.proposed();
    await act(f, s.id, 'archive');
    opts.away = true;
    await f.call('plan_propose', s.id, PLAN);
    expect(f.m.planOf(s.id)!.phase).toBe('proposed');
  });
});

describe('a restart', () => {
  it('keeps every map and its plan', async () => {
    const f = fixture(), s = await f.proposed(), idea = f.maps().idea({ title: 'Poi', project: 'Casa' });
    const before = [f.mapOf(s.id), f.maps().get(idea.id)!];
    await f.m.shutdown();
    const g = fixture({ dir: f.dir });
    expect(g.maps().list()).toHaveLength(2);
    expect(g.maps().get(before[0]!.id)).toMatchObject({ state: 'toApprove', plan: before[0]!.plan!, owner: before[0]!.owner! });
    expect(g.maps().get(idea.id)).toEqual(before[1]);
  });

  it('a chat with an old plan gets a map once, not twice', async () => {
    const f = fixture({ withMaps: false }), s = await f.proposed();
    await f.m.shutdown();
    const g = fixture({ dir: f.dir });
    expect(g.maps().list()).toMatchObject([{ ownerChatId: s.id, state: 'toApprove', steps: 3 }]);
    const id = g.mapOf(s.id).id;
    await g.m.shutdown();
    const h = fixture({ dir: f.dir });
    expect(h.maps().list().map(i => i.id)).toEqual([id]);
  });
});

describe('a step is never «now» for ever (live status)', () => {
  const started = async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'approve');
    await f.call('agent_delegate', s.id, f.task('scout', 'Sconti · Dove', 1));
    return { f, s, kid: f.kids(s.id)[0]!.id, box: (g: F = f) => g.maps().view(g.mapOf(s.id).id)!.steps[0]! };
  };

  it('its chat closed without a report: the step keeps its state and says so; open again: it goes on', async () => {
    const { f, kid, box } = await started();
    expect(box()).toMatchObject({ state: 'now', live: { chats: [{ chatId: kid }] } });
    await f.m.archive(kid);
    expect(box()).toMatchObject({ state: 'now', live: { say: 'closed', chats: [{ chatId: kid, say: 'closed' }] } });
    await f.m.reopen(kid);
    expect(box()).toMatchObject({ state: 'now' });
    expect(box().live!.say).not.toBe('closed');
  });

  it('its chat removed without a report: the step keeps its state, its chat is gone', async () => {
    const { f, kid, box } = await started();
    await f.m.close(kid);
    expect(box()).toMatchObject({ state: 'now', live: { say: 'gone' } });
  });

  it('closed after its report: the report stays', async () => {
    const { f, kid, box } = await started();
    await f.call('agent_report', kid, { outcome: 'done', summary: 'ok', output: 'o', doneWhen: [{ criterion: 'criterion A', met: true }] });
    await f.m.archive(kid);
    expect(box()).toMatchObject({ state: 'done' });
  });

  it('its chat works, asks the user, fails: the step says it at once', async () => {
    const { f, s, kid, box } = await started(), sink = f.sinks.get(kid)!;
    sink.changed({ state: 'running' });
    expect(box().live).toMatchObject({ say: 'working' });
    sink.pending({ id: 'q1', type: 'question', tool: 'AskUserQuestion', title: '?', detail: '', input: {}, questions: [{ question: '?', options: [{ label: 'Sì' }, { label: 'No' }], multiSelect: false }], at: 1 });
    // its Strategist holds the question: nothing says it waits for the user (ADR 0344)
    sink.changed({ state: 'waiting' });
    expect(box().live).toMatchObject({ say: 'waiting', waits: 'parent' });
    expect(f.m.list().find(c => c.id === kid)).toMatchObject({ state: 'running', pending: 0 });
    expect(f.m.pending()).toEqual([]);
    expect(JSON.stringify(f.maps().view(f.mapOf(s.id).id)!.info.live ?? {})).not.toContain('"user"');
    await f.m.ladderReply(s.id, { chatId: kid, askUser: true, why: 'scelta sua' });
    expect(box().live).toMatchObject({ say: 'waiting', waits: 'user' });
    expect(f.m.pending()).toHaveLength(1);
    await f.m.answer(kid, 'q1', { kind: 'question', answers: { '?': 'Sì' } }, 'pc');
    sink.changed({ state: 'running' });
    expect(box().live!.waits).not.toBe('user');
    sink.changed({ state: 'error' });
    expect(box().live).toMatchObject({ say: 'failed' });
  });

  it('asks its parent: it waits for the parent until the answer', async () => {
    const { f, s, kid, box } = await started();
    f.sinks.get(kid)!.changed({ state: 'idle' });
    f.m.ladderAsk(kid, { question: 'Anche i resi?', options: [] });
    expect(box().live).toMatchObject({ say: 'waiting', waits: 'parent' });
    await f.call('agent_answer_child', s.id, { chatId: kid, answer: 'Sì, anche i resi', why: 'nella richiesta' });
    expect(f.m.list().find(c => c.id === kid)!.questions).toMatchObject([{ answered: { by: 'strategist', answer: 'Sì, anche i resi', why: 'nella richiesta' } }]);
    expect(box().live!.waits).toBeUndefined();
  });

  it('the app restarts with the step under way: still under way, nothing invented; its chat lost meanwhile: the state stays, the chat is gone', async () => {
    const { f, s, kid, box } = await started();
    await f.m.shutdown();
    const g = fixture({ dir: f.dir });
    expect(box(g)).toMatchObject({ state: 'now', live: { say: 'unknown', stale: expect.any(Number) } });
    await g.m.shutdown();
    // the chat's record did not survive, and no event said so
    const file = path.join(f.dir, 'chats.json'), raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    const drop = (v: unknown): unknown => (Array.isArray(v) ? v.filter(c => (c as { id?: string }).id !== kid) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Array.isArray(x) ? drop(x) : x])) : v);
    fs.writeFileSync(file, JSON.stringify(drop(raw)));
    const h = fixture({ dir: f.dir });
    expect(h.m.list().some(c => c.id === kid)).toBe(false);
    expect(h.m.planOf(s.id)!.steps[0]).toMatchObject({ state: 'now' });
    expect(box(h)).toMatchObject({ state: 'now', live: { say: 'gone' } });
  });

  it('the approval of a replan under way is not touched by a chat that closes', async () => {
    const { f, s, kid } = await started();
    await f.call('plan_propose', s.id, { revise: true, steps: [{ keep: 1 }, { title: 'Altro', role: 'artisan', after: [] }] });
    const at = planAt(f, s.id);
    await f.m.archive(kid);
    expect(f.mapOf(s.id)).toMatchObject({ state: 'toApprove', plan: { phase: 'proposed', at, steps: [{ state: 'now' }, { state: 'todo' }] } });
    expect((await act(f, s.id, 'approve')).state).toBe('running');
  });
});

describe('night mode (ADR 0191)', () => {
  it('approves as proposed and starts; a job the user stopped stays stopped', async () => {
    const f = fixture({ away: true }), s = await f.root();
    await f.enough(s.id);
    await f.call('plan_propose', s.id, PLAN);
    expect(f.mapOf(s.id)).toMatchObject({ state: 'running', plan: { phase: 'running' } });
    await act(f, s.id, 'stop');
    await f.call('plan_propose', s.id, { revise: true, steps: [{ title: 'Altro', role: 'artisan', after: [] }] });
    expect(f.mapOf(s.id)).toMatchObject({ state: 'stopped', plan: { phase: 'proposed' } });
  });
});

describe('what a plan guarantees (ADR 0361)', () => {
  const SIX = { steps: Array.from({ length: 6 }, (_, i) => ({ title: `Passo ${i + 1}`, role: 'artisan', after: [] as number[] })) };
  const states = (f: F, id: string) => f.mapOf(id).plan!.steps.map(x => x.state);

  it('a plan of six steps, one blocked and five never started, that is closed in any way: none becomes done', async () => {
    const f = fixture(), s = await f.root();
    await f.enough(s.id);
    await f.call('plan_propose', s.id, SIX);
    await act(f, s.id, 'approve');
    await f.call('plan_update', s.id, { step: 1, state: 'blocked' });
    const want = ['blocked', 'todo', 'todo', 'todo', 'todo', 'todo'];
    expect(states(f, s.id)).toEqual(want);
    const id = f.mapOf(s.id).id;
    // its chat is closed, then gone for good, then the plan is put away and brought back: the steps are what they were
    await f.m.archive(s.id);
    expect(f.maps().get(id)!.plan!.steps.map(x => x.state)).toEqual(want);
    await f.m.close(s.id);
    expect(f.maps().get(id)!.state).toBe('stopped');
    expect(f.maps().get(id)!.plan!.steps.map(x => x.state)).toEqual(want);
    await f.maps().act(id, 'archive');
    expect(f.maps().get(id)!.plan!.steps.map(x => x.state)).toEqual(want);
    await f.maps().act(id, 'reopen');
    expect(f.maps().get(id)!.plan!.steps.map(x => x.state)).toEqual(want);
    expect(f.maps().list()[0]).toMatchObject({ done: 0, percent: 0, blocked: 1 });
  });

  it('every chat closed and the app restarted: the plan comes back at the step it was at, and «Riprendi» opens its own chat, not a second one', async () => {
    const f = fixture(), s = await f.proposed();
    await act(f, s.id, 'approve');
    await f.call('agent_delegate', s.id, f.task('scout', 'Sconti · Dove', 1));
    const kid = f.kids(s.id)[0]!.id;
    await f.call('agent_report', kid, { outcome: 'done', summary: 'trovato dove', output: 'o', doneWhen: [{ criterion: 'criterion A', met: true }] });
    await f.call('agent_delegate', s.id, f.task('artisan', 'Sconti · Applico', 2));
    const id = f.mapOf(s.id).id, before = f.mapOf(s.id).plan!.steps.map(x => x.state);
    expect(before).toEqual(['done', 'now', 'todo']);
    for (const c of f.m.list()) await f.m.archive(c.id);
    await f.m.shutdown();
    const g = fixture({ dir: f.dir });
    const view = g.maps().view(id)!;
    expect(view.steps.map(x => x.state)).toEqual(before);
    expect(view.info).toMatchObject({ done: 1, percent: 33 });
    expect(view.steps[0]!.proof).toBeDefined();
    const strategists = () => g.m.list().filter(c => c.agent?.id === 'strategist' && !c.parentId).length;
    const n = strategists();
    await g.maps().act(id, 'resume');
    expect(strategists()).toBe(n);
    expect(g.maps().get(id)!.plan!.steps.map(x => x.state)).toEqual(before);
    expect(g.maps().get(id)!.owner!.chatId).toBe(s.id);
  });
});
