// A Strategist's plan with the user (ADR 0108) on a real ChatManager with fake engines: the Orchestrator's Strategist
// starts asking with the app's flow after its request (a user's or a child's does not); the user's answers become "already
// clear" lines; plan_propose puts the plan up for the user's ok and agent_delegate is refused until then; «Approva e
// parti» and «Cambia qualcosa» reach the Strategist as the user's messages; a delegated step is under way and done once its
// children reported; plan_update moves its own steps; the plan tools exist only on its chat and survive a restart. The
// app enforces the flow (ADR 0121): a first proposal before any question needs a reason, and every refusal of a
// delegation before the user's ok says what to do next.
// Pins shared/strategy.ts, agents/strategy-tools.ts and the plan part of chats/manager.ts and agents/delegation.ts.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { delegationTools } from '../../../src/main/agents/delegation';
import { strategyTools } from '../../../src/main/agents/strategy-tools';
import { ROLE_DEFAULTS, ROLE_IDS, DELEGATION_DEFAULTS, isWorkRole, type DelegationSettings, type RoleId } from '../../../src/shared/roles';
import type { AgentCatalog } from '../../../src/shared/agents';
import type { NewChat } from '../../../src/shared/contract';
import type { McpTool } from '../../../src/main/mcp/server';
import type { PermissionCeiling, ToolClass } from '../../../src/shared/agents';
import { finishPlan, afterReport, checkProposal, delegationGate, proposalGate, ENOUGH_QUESTIONS, PLAN_APPROVED, readPlan, STRATEGY_FLOW, withClarified, withDelegated, withStep, type StrategyPlan } from '../../../src/shared/strategy';

/** Roles a user narrowed: tools, ceiling and launches per role (the rest stays the default). */
type Narrowed = Partial<Record<RoleId, { tools: ToolClass[]; ceiling: PermissionCeiling | null; launches: string[] }>>;
/** Every role narrowed back to ADR 0083's restrictive defaults, as a user could set them on the cards. */
const shape = (id: RoleId, n: Narrowed = {}) => { const r = ROLE_DEFAULTS[id]; return n[id] ?? { tools: r.tools, ceiling: r.ceiling, launches: r.launches }; };

const roots: string[] = [], managers: ChatManager[] = [];
/** the delegation tools' clock (the stall check); undefined = Date.now */
let clock: (() => number) | undefined;
afterEach(async () => { clock = undefined; for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const catalog = (n: Narrowed = {}): AgentCatalog => ({ problem: null, archived: [], models: [], profiles: ROLE_IDS.map(id => {
  const r = ROLE_DEFAULTS[id], x = shape(id, n);
  return { id, name: r.name, purpose: r.summary, scope: 'role', engine: 'claude', model: null, tier: r.tier, tierMax: r.tierMax,
    launches: [...x.launches], skills: r.skills, tools: { allow: [...x.tools] }, permissionCeiling: x.ceiling, activeVersion: 1, updatedAt: 1, instructions: r.instructions };
}) } as unknown as AgentCatalog);

function fixture(limits: Partial<DelegationSettings> = {}, worktrees?: (cwd: string) => Promise<string[]>, roles?: () => AgentCatalog, onSend?: (chatId: string) => void, narrowed: Narrowed = {}, remembered: [string, string][] = []) {
  roles ??= () => catalog(narrowed);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-delegation-'));
  roots.push(dir);
  const starts = new Map<string, SessionOptions>(), sinks = new Map<string, SessionSink>(), sent = new Map<string, string[]>(), answers: { chat: string; id: string; answer: { allow?: boolean; message?: string }; patch?: Record<string, string> }[] = [];
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, ...(worktrees ? { worktrees } : {}),
    resolveAgent: (req: NewChat) => {
      const id = req.roleId as RoleId | undefined;
      if (!id || !isWorkRole(id)) return { request: req, owner: { id: 'plain', name: 'Chat', purpose: '', engine: req.harness, model: null, revision: 0, source: 'plain' as const }, instructions: '', policy: null, skills: [], launches: [] };
      const r = ROLE_DEFAULTS[id], x = shape(id, narrowed);
      return { request: req, owner: { id, name: r.name, purpose: r.summary, engine: 'claude', model: null, revision: 1, source: 'catalog' as const, version: 1 }, instructions: r.instructions,
        policy: { tools: { allow: [...x.tools] }, ceiling: x.ceiling }, skills: [...r.skills, ...(req.skills ?? [])], launches: [...x.launches], assets: { pluginDir: path.join(dir, 'p'), skillRoot: path.join(dir, 'p', 'skills') } };
    },
    sessionFactory: (_h, o, s) => {
      starts.set(o.chatId, o); sinks.set(o.chatId, s);
      return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { s.changed({ state: 'idle' }); }, send(text: string) { sent.set(o.chatId, [...(sent.get(o.chatId) ?? []), text]); onSend?.(o.chatId); },
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
        answer: (id: string, answer: { allow?: boolean; message?: string }, patch?: Record<string, string>) => { answers.push({ chat: o.chatId, id, answer, ...(patch ? { patch } : {}) }); return true; },
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
  managers.push(m);
  const tools = [...strategyTools(m), ...delegationTools({ chats: m, roles, settings: () => ({ ...DELEGATION_DEFAULTS, ...limits }), engineRefusal: () => null, label: '[agente]', runs: () => m.runs.list(), ...(worktrees ? { worktrees } : {}), now: () => (clock ?? Date.now)(),
    remember: (role, line) => { remembered.push([role, line]); } })];
  const tool = (name: string): McpTool => tools.find(t => t.name === name)!;
  const call = async (name: string, chatId: string, args: Record<string, unknown>) => JSON.parse(await tool(name).run(args, { mount: 'chat', params: { chatId }, sessionId: '', signal: new AbortController().signal } as never) as string);
  const root = (role: RoleId, cwd = dir, by: 'user' | 'agent' = 'agent') => m.create({ harness: 'claude', cwd, roleId: role, title: `${ROLE_DEFAULTS[role].name} root`, prompt: 'Porta gli sconti in percentuale' }, by);
  const task = (role: string, title: string, extra: Record<string, unknown> = {}) => ({ role, title, contract: { goal: `Goal of ${title}`, doneWhen: ['criterion A'], ...extra } });
  return { m, dir, starts, sinks, sent, answers, call, root, task };
}

const STEPS3 = [{ title: 'Trovo dove si calcola lo sconto', role: 'scout' }, { title: 'Applico lo sconto', role: 'artisan' }, { title: 'Scrivo il riepilogo' }];
/** a proposal with the reason no question was needed (the gate of ADR 0121 is pinned in its own test below) */
const PLAN = { steps: STEPS3, doneWhen: 'I test passano', noQuestionReason: 'La richiesta dice già cosa, dove e quando è finito' };
const tick = () => new Promise(res => setTimeout(res, 20));
const planOf = (f: ReturnType<typeof fixture>, id: string) => f.m.list().find(c => c.id === id)!.plan!;
/** the user's click on the plan they see now */
const decide = (f: ReturnType<typeof fixture>, id: string, d: 'approve' | 'change', text?: string) => f.m.planDecide(id, d, planOf(f, id).at, text);

describe('a Strategist\'s plan with the user', () => {
  it('the Orchestrator\'s Strategist starts asking, with the app\'s flow after the request; a user\'s or a child\'s does not', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    expect(s.plan).toMatchObject({ phase: 'asking', clarified: [], steps: [] });
    const first = f.sent.get(s.id)![0]!;
    expect(first).toContain(STRATEGY_FLOW);
    expect(first.indexOf('Porta gli sconti in percentuale')).toBeGreaterThanOrEqual(0);
    expect(first.indexOf('Porta gli sconti in percentuale')).toBeLessThan(first.indexOf(STRATEGY_FLOW));
    const mine = await f.root('strategist', f.dir, 'user');
    expect(mine.plan).toBeUndefined();
    expect(f.sent.get(mine.id)![0]).not.toContain('plan_propose');
    const artisan = await f.root('artisan');
    expect(artisan.plan).toBeUndefined();
    // the plan tools: only where a plan exists
    expect(f.m.chatToolShown(s.id, 'plan_propose')).toBe(true);
    expect(f.m.chatToolShown(mine.id, 'plan_propose')).toBe(false);
    expect(f.m.chatToolShown(artisan.id, 'plan_update')).toBe(false);
  });

  it('the user\'s answers become "already clear"; «Basta domande» does not', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    const q = { question: 'Lo sconto vale anche sui prodotti in offerta?', header: 'Offerte', multiSelect: false, options: [{ label: 'No' }, { label: 'Sì' }] };
    f.sinks.get(s.id)!.pending({ id: 'q1', type: 'question', tool: 'AskUserQuestion', title: q.question, detail: '', input: {}, questions: [q], at: 1 });
    await f.m.answer(s.id, 'q1', { kind: 'question', answers: { [q.question]: 'No' } });
    expect(planOf(f, s.id).clarified).toEqual([{ q: 'Offerte', a: 'No' }]);
    f.sinks.get(s.id)!.pending({ id: 'q2', type: 'question', tool: 'AskUserQuestion', title: 'Altro?', detail: '', input: {}, questions: [{ ...q, header: undefined, question: 'Altro?' }], at: 2 });
    await f.m.answer(s.id, 'q2', { kind: 'question', answers: { 'Altro?': ENOUGH_QUESTIONS } });
    expect(planOf(f, s.id).clarified).toHaveLength(1);
  });

  it('plan_propose waits for the user: no delegation before «Approva e parti», which reaches the Strategist as the user\'s message', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'Ordini · Dove')] })).rejects.toThrow(/not approved your plan/);
    await expect(f.call('plan_propose', s.id, { steps: [] })).rejects.toThrow(/1 to 8/);
    await expect(f.call('plan_propose', s.id, { steps: [{ title: 'x', role: 'orchestrator' }] })).rejects.toThrow(/work roles/);
    const out = await f.call('plan_propose', s.id, PLAN);
    expect(out).toMatchObject({ shown: true, steps: 3 });
    expect(planOf(f, s.id)).toMatchObject({ phase: 'proposed', doneWhen: 'I test passano', steps: [{ title: 'Trovo dove si calcola lo sconto', role: 'scout', state: 'todo' }, { role: 'artisan' }, { title: 'Scrivo il riepilogo' }] });
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'Ordini · Dove')] })).rejects.toThrow(/not approved/);
    await expect(f.call('plan_update', s.id, { step: 1, state: 'now' })).rejects.toThrow(/not approved/);
    // «Cambia qualcosa»: revising, the change as the user's message; a new proposal is up again
    await expect(decide(f, s.id, 'change', '  ')).rejects.toThrow(/cosa cambiare/);
    // one proposal at a time, and only the one the user read can be approved
    await expect(f.call('plan_propose', s.id, PLAN)).rejects.toThrow(/already waits/);
    await expect(f.m.planDecide(s.id, 'approve', planOf(f, s.id).at - 1)).rejects.toThrow(/cambiato/);
    expect(planOf(f, s.id).phase).toBe('proposed');
    await decide(f, s.id, 'change', 'Prima i test');
    expect(planOf(f, s.id).phase).toBe('revising');
    expect(f.sent.get(s.id)!.at(-1)).toBe('Cambia il piano: Prima i test');
    await expect(decide(f, s.id, 'approve')).rejects.toThrow(/non aspetta/);
    await f.call('plan_propose', s.id, PLAN);
    await decide(f, s.id, 'approve');
    expect(planOf(f, s.id).phase).toBe('running');
    // the run keeps the plan's fate for the Orchestrator's decision signals (ADR 0131): two proposals, one change, approved
    const runId = f.m.list().find(c => c.id === s.id)!.run!.runId;
    expect(f.m.runs.get(runId)!.plan).toEqual({ proposals: 2, changes: 1, approvedAt: expect.any(Number) });
    expect(f.sent.get(s.id)!.at(-1)).toBe(PLAN_APPROVED);
    await expect(f.call('plan_propose', s.id, PLAN)).rejects.toThrow(/approved and under way/);
  });

  it('it really asks: a first proposal before any question is refused unless it says why none was needed (ADR 0121)', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    const bare = { steps: STEPS3 };
    await expect(f.call('plan_propose', s.id, bare)).rejects.toThrow(/not asked the user anything yet.*AskUserQuestion.*noQuestionReason/s);
    await expect(f.call('plan_propose', s.id, { ...bare, noQuestionReason: '   ' })).rejects.toThrow(/not asked/);
    await expect(f.call('plan_propose', s.id, { ...bare, noQuestionReason: 'x'.repeat(201) })).rejects.toThrow(/not asked/);
    expect(planOf(f, s.id).phase).toBe('asking');
    // one answered question («Basta domande» counts: the user chose to stop) opens the way
    const q = { question: 'Vale anche sulle offerte?', header: 'Offerte', multiSelect: false, options: [{ label: 'No' }, { label: 'Sì' }] };
    f.sinks.get(s.id)!.pending({ id: 'q1', type: 'question', tool: 'AskUserQuestion', title: q.question, detail: '', input: {}, questions: [q], at: 1 });
    await f.m.answer(s.id, 'q1', { kind: 'question', answers: { [q.question]: ENOUGH_QUESTIONS } });
    expect(planOf(f, s.id)).toMatchObject({ asked: 1, clarified: [] });
    await f.call('plan_propose', s.id, { steps: [{ title: 'Trovo', role: 'scout', detail: '  carrello,   ordine e reso ' }, STEPS3[1]] });
    expect(planOf(f, s.id)).toMatchObject({ phase: 'proposed', asked: 1, steps: [{ title: 'Trovo', detail: 'carrello, ordine e reso' }, { title: 'Applico lo sconto' }] });
    // a change asked by the user: the new proposal needs no reason
    await decide(f, s.id, 'change', 'Aggiungi i test');
    await f.call('plan_propose', s.id, { steps: STEPS3 });
    expect(planOf(f, s.id).phase).toBe('proposed');
  });

  it('every refusal before the user\'s ok says what to do next; agent_assign_task is refused too', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'Ordini · Dove')] })).rejects.toThrow(/agent_delegate refused: the user has not approved your plan yet\. Finish your questions, propose the plan with plan_propose/);
    await f.call('plan_propose', s.id, PLAN);
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'Ordini · Dove')] })).rejects.toThrow(/waits for the user: end your turn now/);
    await decide(f, s.id, 'change', 'Prima i test');
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'Ordini · Dove')] })).rejects.toThrow(/propose the changed plan with plan_propose/);
    expect(f.m.list().filter(c => c.parentId === s.id)).toEqual([]);
  });

  it('a delegated step is under way, done once its children reported done, blocked when one did not; plan_update moves its own steps', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await f.call('plan_propose', s.id, PLAN);
    await decide(f, s.id, 'approve');
    await expect(f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Ordini · Dove'), step: 4 }] })).rejects.toThrow(/1 to 3/);
    await f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Ordini · Dove'), step: 1 }, { ...f.task('scout', 'Resi · Dove'), step: 1 }, { ...f.task('artisan', 'Ordini · Sconto'), step: 2 }] });
    const kids = f.m.list().filter(c => c.parentId === s.id);
    let plan = planOf(f, s.id);
    expect(plan.steps.map(x => x.state)).toEqual(['now', 'now', 'todo']);
    expect(plan.steps[0]!.chatIds).toEqual([kids[0]!.id, kids[1]!.id]);
    expect(plan.steps[0]!.startedAt).toBeGreaterThan(0);
    const report = (id: string, outcome: string) => f.call('agent_report', id, { outcome, summary: 'ok', output: 'o', doneWhen: [{ criterion: 'criterion A', met: outcome === 'done' }] });
    await report(kids[0]!.id, 'done');
    expect(planOf(f, s.id).steps[0]!.state).toBe('now'); // its sibling still works
    await report(kids[1]!.id, 'done');
    plan = planOf(f, s.id);
    expect(plan.steps[0]).toMatchObject({ state: 'done' });
    expect(plan.steps[0]!.endedAt).toBeGreaterThan(0);
    await report(kids[2]!.id, 'blocked');
    expect(planOf(f, s.id).steps[1]!.state).toBe('blocked');
    await f.call('plan_update', s.id, { step: 2, state: 'done' });
    await expect(f.call('plan_update', s.id, { step: 3, state: 'finished' })).rejects.toThrow(/state/);
    const out = await f.call('plan_update', s.id, { step: 3, state: 'done' });
    expect(out).toMatchObject({ done: 3, of: 3, finished: true });
    expect(planOf(f, s.id).phase).toBe('done');
    await tick();
  });

  it('a step whose sibling chat was closed without a result shows blocked, never stuck', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await f.call('plan_propose', s.id, PLAN);
    await decide(f, s.id, 'approve');
    await f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Ordini · Dove'), step: 1 }, { ...f.task('scout', 'Resi · Dove'), step: 1 }] });
    const kids = f.m.list().filter(c => c.parentId === s.id);
    await f.m.close(kids[1]!.id);
    await f.call('agent_report', kids[0]!.id, { outcome: 'done', summary: 'ok', output: 'o', doneWhen: [{ criterion: 'criterion A', met: true }] });
    expect(planOf(f, s.id).steps[0]!.state).toBe('blocked');
  });

  it('a decision whose message does not reach the Strategist leaves the plan waiting', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await f.call('plan_propose', s.id, PLAN);
    const send = f.m.send.bind(f.m);
    f.m.send = async () => { throw new Error('motore spento'); };
    await expect(decide(f, s.id, 'approve')).rejects.toThrow(/motore spento/);
    expect(planOf(f, s.id).phase).toBe('proposed');
    f.m.send = send;
  });

  it('the plan survives a restart, and its gate with it', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await f.call('plan_propose', s.id, PLAN);
    await f.m.shutdown();
    const saved = JSON.parse(fs.readFileSync(path.join(f.dir, 'chats.json'), 'utf8')) as { chats: { id: string; plan?: unknown }[] };
    expect(readPlan(saved.chats.find(c => c.id === s.id)?.plan)).toMatchObject({ phase: 'proposed', steps: [{ state: 'todo' }, { state: 'todo' }, { state: 'todo' }] });
    const again = new ChatManager({ userData: f.dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0 });
    managers.push(again);
    expect(again.planOf(s.id)).toMatchObject({ phase: 'proposed' });
    expect(again.list().find(c => c.id === s.id)?.plan?.steps).toHaveLength(3);
    expect(again.chatToolShown(s.id, 'plan_propose')).toBe(true);
  });
});

describe('shared/strategy.ts', () => {
  const plan = (): StrategyPlan => ({ phase: 'running', at: 1, clarified: [], steps: checkProposal(PLAN).steps });
  it('checks a proposal: steps, roles, lengths, unknown fields', () => {
    expect(checkProposal({ steps: [{ title: '  Due   spazi ' }] }).steps).toEqual([{ title: 'Due spazi', state: 'todo' }]);
    expect(() => checkProposal({ steps: Array(9).fill({ title: 'x' }) })).toThrow(/1 to 8/);
    expect(() => checkProposal({ steps: [{ title: 'x'.repeat(121) }] })).toThrow(/120/);
    expect(() => checkProposal({ steps: [{ title: 'x', owner: 'me' }] })).toThrow(/unknown field owner/);
    expect(() => checkProposal({ steps: [{ title: 'x' }], doneWhen: 3 })).toThrow(/doneWhen/);
  });
  it('the gates, pure: proposal before any question, delegation before the ok', () => {
    const asking: StrategyPlan = { phase: 'asking', at: 1, clarified: [], steps: [] };
    expect(proposalGate(asking, undefined)).toMatch(/not asked/);
    expect(proposalGate(asking, 'Dice già tutto')).toBeNull();
    expect(proposalGate({ ...asking, asked: 2 }, undefined)).toBeNull();
    expect(proposalGate({ ...asking, phase: 'revising' }, undefined)).toBeNull();
    expect(delegationGate(null, 'agent_delegate')).toBeNull();
    expect(delegationGate({ ...asking, phase: 'running' }, 'agent_delegate')).toBeNull();
    expect(delegationGate({ ...asking, phase: 'done' }, 'agent_delegate')).toBeNull();
    for (const phase of ['asking', 'proposed', 'revising'] as const) expect(delegationGate({ ...asking, phase }, 'agent_assign_task')).toMatch(new RegExp(`^agent_assign_task refused: .*«${PLAN_APPROVED}»`));
  });
  it('a step may carry a short detail, checked and kept across a restart; the questions asked are counted', () => {
    expect(() => checkProposal({ steps: [{ title: 'x', detail: 'y'.repeat(201) }] })).toThrow(/detail: at most 200/);
    expect(() => checkProposal({ steps: [{ title: 'x', detail: 3 }] })).toThrow(/detail: required text/);
    expect(checkProposal({ steps: [{ title: 'x', detail: '' }] }).steps[0]).toEqual({ title: 'x', state: 'todo' });
    const p: StrategyPlan = { phase: 'proposed', at: 1, asked: 2, clarified: [], steps: checkProposal({ steps: [{ title: 'x', role: 'scout', detail: 'carrello e reso' }] }).steps };
    expect(readPlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(readPlan({ ...p, asked: -1 })).toBeNull();
    expect(readPlan({ ...p, steps: [{ title: 'x', state: 'todo', detail: 'y'.repeat(201) }] })).toBeNull();
    const q = { question: 'Dove?' };
    expect(withClarified(p, [q], { 'Dove?': ENOUGH_QUESTIONS })).toMatchObject({ asked: 3, clarified: [] });
    expect(withClarified(p, [], {})).toBe(p);
  });
  it('moves steps: times kept, every step done ends the plan, a reopened step reopens it', () => {
    let p = withStep(plan(), 0, 'now', 10);
    expect(p.steps[0]).toMatchObject({ state: 'now', startedAt: 10 });
    p = withStep(p, 0, 'done', 20);
    expect(p.steps[0]).toMatchObject({ state: 'done', startedAt: 10, endedAt: 20 });
    p = withStep(withStep(p, 1, 'done', 30), 2, 'done', 40);
    expect(p.phase).toBe('done');
    p = withStep(p, 2, 'now', 50);
    expect(p.phase).toBe('running');
    expect(p.steps[2]!.endedAt).toBeUndefined();
  });
  it('a report moves only the step that delegated the chat', () => {
    const p = withDelegated(plan(), 1, ['a', 'b'], 5);
    expect(afterReport(p, 'zz', () => 'done', 9)).toBe(p);
    expect(afterReport(p, 'a', id => (id === 'a' ? 'done' : undefined), 9)).toBe(p);
    expect(afterReport(p, 'a', id => (id === 'a' ? 'done' : 'partial'), 9).steps[1]).toMatchObject({ state: 'done', outcome: 'partial' });
    expect(afterReport(p, 'a', () => 'done', 9).steps[1]!.state).toBe('done');
  });
  it('finishes execution with a partial result and preserves its quality across restart', () => {
    const p: StrategyPlan = { phase: 'running', at: 1, clarified: [], steps: [{ title: 'Research', state: 'now', chatIds: ['a'] }] };
    const done = afterReport(p, 'a', () => 'partial', 9);
    expect(done.phase).toBe('done');
    expect(done.steps[0]).toMatchObject({ state: 'done', outcome: 'partial', endedAt: 9 });
    expect(readPlan(JSON.parse(JSON.stringify(done)))).toEqual(done);
    expect(withStep(done, 0, 'now', 10).steps[0]?.outcome).toBeUndefined();
    expect(readPlan({ ...done, steps: [{ ...done.steps[0], outcome: 'unknown' }] })).toBeNull();
  });
  it('a terminal parent report ends execution without claiming unfinished criteria were met', () => {
    const p = plan();
    p.steps[0] = { ...p.steps[0]!, state: 'done' };
    p.steps[1] = { ...p.steps[1]!, state: 'blocked' };
    const done = finishPlan(p, 20);
    expect(done.phase).toBe('done');
    expect(done.steps.map(s => [s.state, s.outcome])).toEqual([['done', 'done'], ['done', 'blocked'], ['done', 'partial']]);
    expect(readPlan(done)).toEqual(done);
  });
  it('keeps the latest 8 answers, cut to 120 characters', () => {
    let p = plan();
    for (let i = 0; i < 10; i++) p = withClarified(p, [{ question: `q${i}` }], { [`q${i}`]: i === 9 ? 'x'.repeat(200) : ['a', 'b'] });
    expect(p.clarified).toHaveLength(8);
    expect(p.clarified[0]).toEqual({ q: 'q2', a: 'a, b' });
    expect(p.clarified[7]!.a).toHaveLength(120);
  });
  it('reads a saved plan only when it is whole', () => {
    const p = withDelegated(plan(), 0, ['c_1'], 5);
    expect(readPlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(readPlan({ ...p, phase: 'other' })).toBeNull();
    expect(readPlan({ ...p, steps: [{ title: 'x', state: 'now', role: 'judge' }] })).toBeNull();
    expect(readPlan({ ...p, steps: [{ title: 'x', state: 'now', chatIds: ['../x'] }] })).toBeNull();
    expect(readPlan(null)).toBeNull();
  });
});

// Reusing a conversation moves only the active plan association; previous run reports remain in the ledger.
describe('reused child plan steps', () => {
  it('moves a reused child to the new step and reopens finished execution', () => {
    const plan: StrategyPlan = {phase:'done',at:1,clarified:[],steps:[
      {title:'Original',state:'done',outcome:'done',chatIds:['child']},
      {title:'Follow-up',state:'done',outcome:'partial',endedAt:1},
    ]};
    const next=withDelegated(plan,1,['child'],2);
    expect(next.phase).toBe('running');
    expect(next.steps[0]).toMatchObject({state:'done',outcome:'done',chatIds:[]});
    expect(next.steps[1]).toMatchObject({state:'now',chatIds:['child']});
    expect(next.steps[1]?.endedAt).toBeUndefined();
    expect(next.steps[1]?.outcome).toBeUndefined();
    expect(afterReport(next,'child',()=> 'done',3).phase).toBe('done');
  });
});
