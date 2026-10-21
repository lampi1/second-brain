// A Strategist's plan with the user (ADR 0108) on a real ChatManager with fake engines: the Orchestrator's Strategist
// starts asking with the app's flow after its request (a user's or a child's does not); the user's answers become "already
// clear" lines; plan_propose puts the plan up for the user's ok and agent_delegate is refused until then; «Approva e
// parti» and «Cambia qualcosa» reach the Strategist as the user's messages; a delegated step is under way and done once its
// children reported; plan_update moves its own steps; the plan tools exist only on its chat and survive a restart.
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
import { afterReport, checkProposal, ENOUGH_QUESTIONS, PLAN_APPROVED, readPlan, STRATEGY_FLOW, withClarified, withDelegated, withStep, type StrategyPlan } from '../../../src/shared/strategy';

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

const PLAN = { steps: [{ title: 'Trovo dove si calcola lo sconto', role: 'scout' }, { title: 'Applico lo sconto', role: 'artisan' }, { title: 'Scrivo il riepilogo' }], doneWhen: 'I test passano' };
const tick = () => new Promise(res => setTimeout(res, 20));
const planOf = (f: ReturnType<typeof fixture>, id: string) => f.m.list().find(c => c.id === id)!.plan!;

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
    await expect(f.m.planDecide(s.id, 'change', '  ')).rejects.toThrow(/cosa cambiare/);
    await f.m.planDecide(s.id, 'change', 'Prima i test');
    expect(planOf(f, s.id).phase).toBe('revising');
    expect(f.sent.get(s.id)!.at(-1)).toBe('Cambia il piano: Prima i test');
    await expect(f.m.planDecide(s.id, 'approve')).rejects.toThrow(/non aspetta/);
    await f.call('plan_propose', s.id, PLAN);
    await f.m.planDecide(s.id, 'approve');
    expect(planOf(f, s.id).phase).toBe('running');
    expect(f.sent.get(s.id)!.at(-1)).toBe(PLAN_APPROVED);
    await expect(f.call('plan_propose', s.id, PLAN)).rejects.toThrow(/approved and under way/);
  });

  it('a delegated step is under way, done once its children reported done, blocked when one did not; plan_update moves its own steps', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await f.call('plan_propose', s.id, PLAN);
    await f.m.planDecide(s.id, 'approve');
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

  it('the plan survives a restart', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await f.call('plan_propose', s.id, PLAN);
    await f.m.shutdown();
    const saved = JSON.parse(fs.readFileSync(path.join(f.dir, 'chats.json'), 'utf8')) as { chats: { id: string; plan?: unknown }[] };
    expect(readPlan(saved.chats.find(c => c.id === s.id)?.plan)).toMatchObject({ phase: 'proposed', steps: [{ state: 'todo' }, { state: 'todo' }, { state: 'todo' }] });
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
    expect(afterReport(p, 'a', id => (id === 'a' ? 'done' : 'partial'), 9).steps[1]!.state).toBe('blocked');
    expect(afterReport(p, 'a', () => 'done', 9).steps[1]!.state).toBe('done');
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
