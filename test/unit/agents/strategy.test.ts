// A Strategist's plan with the user (ADR 0108) on a real ChatManager with fake engines: the Orchestrator's Strategist
// starts asking with the app's flow after its request (a user's or a child's does not); the user's answers become "already
// clear" lines; plan_propose puts the plan up for the user's ok and agent_delegate is refused until then; «Approva e
// parti» and «Cambia qualcosa» reach the Strategist as the user's messages; a delegated step is under way and done once its
// children reported; plan_update moves its own steps; the plan tools exist only on its chat and survive a restart. The
// app enforces the flow (ADR 0121): a first proposal before any question needs a reason, and every refusal of a
// delegation before the user's ok says what to do next.
// Pins shared/strategy.ts, agents/strategy-tools.ts and the plan part of chats/manager.ts and agents/delegation.ts.
import { withClarified } from '../../../src/main/chats/plan-interview';
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import { ChatStore } from '../../../src/main/chats/store';
import { CoordinationStore } from '../../../src/main/coordination/store';
import { Workflows } from '../../../src/main/workflows/service';
import { digest } from '../../../src/main/appctl/digest';
import { turnsOf } from '../../../src/shared/plan-steps';
import { isPlanApproval, checkProposal, delegationGate, proposalGate, ENOUGH_QUESTIONS, PLAN_APPROVED, readPlan, STRATEGY_FLOW, stopsQuestions, type StrategyPlan } from '../../../src/shared/strategy';

import { answerPanel, decide, fixture, managers, PLAN, planOf, STEPS3 } from './strategy-fixture';

/** Accepted consent survives transport failure and restart; the work projection exposes recovery, not a new approval. */
async function expectUnconfirmedPlan(f: ReturnType<typeof fixture>, chatId: string, proposal: StrategyPlan, delivery: 'uncertain' | 'dispatching') {
  expect(planOf(f, chatId)).toMatchObject({ phase: 'running', steps: proposal.steps });
  const sends = f.sent.get(chatId)?.length;
  await expect(f.m.planDecide(chatId, 'approve', proposal.at)).rejects.toThrow(/non aspetta/);
  expect(f.sent.get(chatId)).toHaveLength(sends!);
  await f.m.shutdown();
  const store = new CoordinationStore(path.join(f.dir, 'app.db'));
  try {
    const request = store.original(chatId, `plan:${proposal.at}`)!;
    expect(request).toMatchObject({ state: 'accepted', payload: proposal,
      decision: { actor: { kind: 'user', channel: 'pc' }, answer: { decision: 'approve' } }, delivery: { state: delivery } });
    expect(store.execution(request.decision!.id)).toEqual([]);
    const works = new Workflows(path.join(f.dir, 'work.json'), undefined, undefined, undefined, { store, chats: () => [], pending: () => [] }).projection();
    expect(works.find(w => w.id === request.key.jobId)).toMatchObject({ status: 'blocked', waitingOn: 'Consegna da verificare' });
    expect(digest({ works, chats: [], pending: [], runs: [], tasks: null, now: Date.now(), since: null, warnTokens: 1000 })).toContain('Consegna da verificare');
    expect(() => store.resolve(request.key, { kind: 'user', channel: 'pc' }, { decision: 'approve' })).toThrow(/already answered/);
    expect(() => store.beginDelivery(request.decision!.id)).toThrow(/already attempted/);
  } finally { store.close(); }
}

describe('a Strategist\'s plan with the user', () => {
  it('#492 point 3: agent_report is refused while the proposed plan waits for the user\'s approval; after it the report goes', async () => {
    const f = fixture(), s = await f.root('strategist');
    f.m.planPropose(s.id, [{ id: 's1', title: 'Trovo dove si calcola lo sconto', state: 'todo' }]);
    expect(planOf(f, s.id).phase).toBe('proposed');
    const report = { outcome: 'partial', summary: 'Piano proposto', output: 'Il piano è sulla sua pagina.', doneWhen: [] };
    // red before ADR 0371: the report closed the job while its plan waited for the user
    await expect(f.call('agent_report', s.id, report)).rejects.toThrow(/plan waits for the user's approval/);
    expect(planOf(f, s.id).phase).toBe('proposed');
    expect(f.m.list().find(c => c.id === s.id)!.run?.report).toBeUndefined();
    await decide(f, s.id, 'approve');
    expect(planOf(f, s.id).phase).toBe('running');
    await expect(f.call('agent_report', s.id, report)).resolves.toMatchObject({ reported: true });
  });
  it('accepts the original plan after a workflow link while retaining its original job scope', async () => {
    const f = fixture(), s = await f.root('strategist');
    const plan = f.m.planPropose(s.id, [{ id: 's1', title: 'Existing scoped work', state: 'todo' }]);
    const store = new CoordinationStore(path.join(f.dir, 'app.db'));
    try {
      const original = store.original(s.id, `plan:${plan.at}`)!;
      const works = new Workflows(path.join(f.dir, 'work.json'), undefined, undefined, undefined,
        { store, chats: () => f.m.list(), pending: () => f.m.pending() });
      const work = works.create({ title: 'Organize existing work', profile: 'investigation', priority: 'normal', chatIds: [s.id] });
      await f.m.planDecide(s.id, 'approve', plan.at);
      expect(store.original(s.id, `plan:${plan.at}`)).toMatchObject({ key: original.key, state: 'accepted',
        decision: { key: original.key, actor: { kind: 'user', channel: 'pc' } }, delivery: { state: 'delivered' } });
      expect(store.requests(work.id)).toEqual([]);
      expect(planOf(f, s.id).phase).toBe('running');
      expect(f.sent.get(s.id)?.at(-1)).toBe(PLAN_APPROVED);
    } finally { store.close(); }
  });
  it('cancels superseded plan A after B approval and a database restart', async () => {
    const f = fixture(), s = await f.root('strategist');
    const a = f.m.planPropose(s.id, [{ id: 's1', title: 'Plan A', state: 'todo' }]);
    const b = f.m.planPropose(s.id, [{ id: 's1', title: 'Plan B', state: 'todo' }]);
    await f.m.planDecide(s.id, 'approve', b.at);
    await f.m.shutdown();
    const store = new CoordinationStore(path.join(f.dir, 'app.db'));
    try {
      expect(store.original(s.id, `plan:${a.at}`)).toMatchObject({ state: 'cancelled', payload: a });
      expect(store.original(s.id, `plan:${b.at}`)).toMatchObject({ state: 'accepted' });
      expect(store.projectionRequests().filter(r => r.state === 'pending')).toEqual([]);
    } finally { store.close(); }
  });
  it('records night plan synchronous completion without a transport acknowledgement in list and digest', async () => {
    const f = fixture({}, undefined, undefined, {}, [], true), s = await f.root('strategist');
    const plan = f.m.planPropose(s.id, [{ id: 's1', title: 'Night plan', state: 'todo' }]);
    const store = new CoordinationStore(path.join(f.dir, 'app.db'));
    try {
      const request = store.original(s.id, `plan:${plan.at}`)!;
      expect(request).toMatchObject({ state: 'accepted', decision: { actor: { kind: 'policy', policy: 'away-plan' } }, delivery: { state: 'applied' } });
      const works = new Workflows(path.join(f.dir, 'work.json'), undefined, undefined, undefined, { store, chats: () => f.m.list(), pending: () => f.m.pending() }).projection();
      expect(works.some(w => w.waitingOn.includes('Consegna da verificare'))).toBe(false);
      expect(digest({ works, chats: f.m.list(), pending: [], runs: [], tasks: null, now: Date.now(), since: null, warnTokens: 1000 })).not.toContain('Consegna da verificare');
    } finally { store.close(); }
  });
  it('never confirms night application when the chat checkpoint fails', async () => {
    const f = fixture({}, undefined, undefined, {}, [], true), s = await f.root('strategist');
    const checkpoint = vi.spyOn(ChatStore.prototype, 'checkpoint').mockImplementationOnce(() => { throw new Error('Checkpoint failed'); });
    const store = new CoordinationStore(path.join(f.dir, 'app.db'));
    try {
      expect(() => f.m.planPropose(s.id, [{ id: 's1', title: 'Night plan', state: 'todo' }])).toThrow('Checkpoint failed');
      const request = store.requests().find(r => r.kind === 'plan')!;
      expect(request.state).toBe('accepted');
      expect(request.delivery).toBeUndefined();
      store.close();
      const restarted = new Workflows(path.join(f.dir, 'work.json'));
      try { expect(restarted.list().some(w => w.waitingOn === 'Consegna da verificare')).toBe(true); }
      finally { restarted.coordination.close(); }
    } finally { checkpoint.mockRestore(); store.close(); }
  });
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
    expect(planOf(f, s.id).clarified).toEqual([{ q: 'Lo sconto vale anche sui prodotti in offerta?', a: 'No' }]); // a yes/no answer keeps its question (ADR 0135)
    f.sinks.get(s.id)!.pending({ id: 'q2', type: 'question', tool: 'AskUserQuestion', title: 'Altro?', detail: '', input: {}, questions: [{ ...q, header: undefined, question: 'Altro?' }], at: 2 });
    await f.m.answer(s.id, 'q2', { kind: 'question', answers: { 'Altro?': ENOUGH_QUESTIONS } });
    expect(planOf(f, s.id).clarified).toHaveLength(1);
  });

  it('carries only the current selected human answer once and keeps plan approval separate', async () => {
    const f = fixture();
    const o = await f.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true, prompt: 'Pianifica uno sconto' });
    const start = async (chatId: string, question: string) => f.m.create({ harness: 'claude', roleId: 'strategist', cwd: f.dir, prompt: 'Sconto' }, 'agent', undefined, {}, { intake: f.m.bindPlanIntake(chatId, question) });
    const first = 'Vale anche sulle offerte?';
    await answerPanel(f, o.id, first, 'No', 'AskUserQuestion', 'phone');
    await expect(start(o.id, 'Altra domanda?')).rejects.toThrow(/exact question/);
    const s = await start(o.id, first);
    expect(s.plan?.clarified).toEqual([{ q: first, a: 'No' }]);
    expect(f.sent.get(s.id)?.[0]).toContain(JSON.stringify({ q: first, a: 'No' }));
    await expect(start(o.id, first)).rejects.toThrow(/exact question/);
    await answerPanel(f, s.id, first, 'No');
    await answerPanel(f, s.id, 'Serve anche su mobile?', 'Sì');
    const answered = f.answers.length;
    await expect(answerPanel(f, s.id, 'Posso proseguire?', ENOUGH_QUESTIONS, 'AskUserQuestion', 'relay')).rejects.toThrow(/non è una decisione/);
    expect(f.answers).toHaveLength(answered);
    expect(planOf(f, s.id).enough).not.toBe(true);
    await f.call('plan_propose', s.id, PLAN);
    expect(planOf(f, s.id).phase).toBe('proposed');
    await expect(start(s.id, first)).rejects.toThrow(/exact question/);
    await answerPanel(f, o.id, first, 'No');
    const oldIntake = f.m.bindPlanIntake(o.id, first);
    await f.m.send(o.id, 'Nuovo lavoro indipendente');
    await expect(start(o.id, first)).rejects.toThrow(/exact question/);
    await answerPanel(f, o.id, 'Campo connettore', 'dato privato', 'mcp__form');
    await expect(start(o.id, 'Campo connettore')).rejects.toThrow(/exact question/);
    await answerPanel(f, o.id, first, ENOUGH_QUESTIONS);
    // Finishing an earlier asynchronous route cannot acquire the new answer, even for identical question text.
    await expect(f.m.create({ harness: 'claude', roleId: 'strategist', cwd: f.dir, prompt: 'Sconto' }, 'agent', undefined, {}, { intake: oldIntake })).rejects.toThrow(/exact question/);
    const stopped = await start(o.id, first);
    expect(stopped.plan).toMatchObject({ enough: true, clarified: [] });
    await f.call('plan_propose', stopped.id, PLAN);
    expect(planOf(f, stopped.id).phase).toBe('proposed');
  });

  it('the Orchestrator\'s Skill calls are never refused; a granted bare name runs as its launch copy (ADR 0278)', async () => {
    const f = fixture();
    const o = await f.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true, prompt: 'Pianifica uno sconto' });
    const ask = (skill: string) => f.sinks.get(o.id)!.pending({ id: skill, type: 'permission', tool: 'Skill', title: 'Skill', detail: '', input: { skill }, at: Date.now() });
    ask('work-intake');
    expect(f.answers.at(-1)).toMatchObject({ answer: { allow: true }, patch: { skill: 'agent-p:work-intake' } });
    for (const name of ['foreign:work-intake', 'agent-p:draft-update']) {
      ask(name);
      expect(f.answers.at(-1)).toMatchObject({ id: name, answer: { allow: true } });
    }
  });

  it('plan_propose waits for the user: no delegation before «Approva e parti», which reaches the Strategist as the user\'s message', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'Ordini · Dove')] })).rejects.toThrow(/not approved your plan/);
    await expect(f.call('plan_propose', s.id, { steps: [] })).rejects.toThrow(/1 to 40/);
    await expect(f.call('plan_propose', s.id, { steps: [{ after: [], title: 'x', role: 'orchestrator' }] })).rejects.toThrow(/work roles/);
    const out = await f.call('plan_propose', s.id, PLAN);
    expect(out).toMatchObject({ shown: true, steps: 3 });
    expect(planOf(f, s.id)).toMatchObject({ phase: 'proposed', doneWhen: 'I test passano', steps: [{ title: 'Trovo dove si calcola lo sconto', role: 'scout', state: 'todo' }, { role: 'artisan' }, { title: 'Scrivo il riepilogo' }] });
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'Ordini · Dove')] })).rejects.toThrow(/not approved/);
    await expect(f.call('plan_update', s.id, { step: 1, state: 'now' })).rejects.toThrow(/not approved/);
    // «Cambia qualcosa»: revising, the change as the user's message; a new proposal is up again
    await expect(decide(f, s.id, 'change', '  ')).rejects.toThrow(/cosa cambiare/);
    // one proposal at a time, and only the one the user read can be approved
    const previousAt = planOf(f, s.id).at;
    await expect(f.call('plan_propose', s.id, PLAN)).resolves.toMatchObject({ shown: true });
    expect(planOf(f, s.id).at).toBeGreaterThan(previousAt);
    await expect(f.m.planDecide(s.id, 'approve', previousAt)).rejects.toThrow(/cambiato/);
    await expect(f.m.planDecide(s.id, 'approve', planOf(f, s.id).at - 1)).rejects.toThrow(/cambiato/);
    expect(planOf(f, s.id).phase).toBe('proposed');
    await decide(f, s.id, 'change', 'Prima i test');
    expect(planOf(f, s.id).phase).toBe('revising');
    expect(f.sent.get(s.id)!.at(-1)).toBe('Cambia il piano: Prima i test');
    await expect(decide(f, s.id, 'approve')).rejects.toThrow(/non aspetta/);
    await f.call('plan_propose', s.id, PLAN);
    await decide(f, s.id, 'approve');
    expect(planOf(f, s.id).phase).toBe('running');
    // the run keeps the plan's fate for the Orchestrator's decision signals (ADR 0131): three presentations, one change, approved
    const runId = f.m.list().find(c => c.id === s.id)!.run!.runId;
    expect(f.m.runs.get(runId)!.plan).toEqual({ proposals: 3, changes: 1, approvedAt: expect.any(Number) });
    expect(f.sent.get(s.id)!.at(-1)).toBe(PLAN_APPROVED);
    await expect(f.call('plan_propose', s.id, PLAN)).rejects.toThrow(/approved and under way/);
  });

  it('no minimum of questions: a first proposal lists its doubts, none included; «Basta domande» still ends the interview', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    const bare = { steps: STEPS3 };
    await expect(f.call('plan_propose', s.id, bare)).rejects.toThrow(/refused: pass .doubts./);
    expect(planOf(f, s.id).phase).toBe('asking');
    const free = await f.root('strategist');
    await f.call('plan_propose', free.id, { ...bare, doubts: [] });
    expect(planOf(f, free.id)).toMatchObject({ phase: 'proposed', clarified: [], doubts: [] });
    // the user chose to stop: the plan may come as it is
    const q = { question: 'Vale anche sulle offerte?', header: 'Offerte', multiSelect: false, options: [{ label: 'No' }, { label: 'Sì' }] };
    f.sinks.get(s.id)!.pending({ id: 'q1', type: 'question', tool: 'AskUserQuestion', title: q.question, detail: '', input: {}, questions: [q], at: 1 });
    await f.m.answer(s.id, 'q1', { kind: 'question', answers: { [q.question]: ENOUGH_QUESTIONS } });
    expect(planOf(f, s.id)).toMatchObject({ enough: true, clarified: [] });
    await f.call('plan_propose', s.id, { steps: [{ after: [], title: 'Trovo', role: 'scout', detail: '  carrello,   ordine e reso ' }, { ...STEPS3[1], after: [1] }] });
    expect(planOf(f, s.id)).toMatchObject({ phase: 'proposed', enough: true, steps: [{ id: 's1', title: 'Trovo', detail: 'carrello, ordine e reso' }, { id: 's2', after: ['s1'], title: 'Applico lo sconto' }] });
    // a change asked by the user: the new proposal needs no reason
    await decide(f, s.id, 'change', 'Aggiungi i test');
    await f.call('plan_propose', s.id, { steps: STEPS3 });
    expect(planOf(f, s.id).phase).toBe('proposed');
  });

  it('every refusal before the user\'s ok says what to do next; agent_assign_task is refused too', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'Ordini · Dove')] })).rejects.toThrow(/agent_delegate refused: the user has not approved your plan yet\. Finish your questions, propose the plan with plan_propose/);
    await f.call('plan_propose', s.id, PLAN);
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'Ordini · Dove')] })).rejects.toThrow(/waits for the user: end your turn now/);
    await decide(f, s.id, 'change', 'Prima i test');
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'Ordini · Dove')] })).rejects.toThrow(/propose the changed plan with plan_propose/);
    expect(f.m.list().filter(c => c.parentId === s.id)).toEqual([]);
  });



  it('never reuses a proposal token when a change and reproposal share the same clock tick', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      await f.call('plan_propose', s.id, PLAN);
      const stale = planOf(f, s.id).at;
      await decide(f, s.id, 'change', 'Prima i test');
      await f.call('plan_propose', s.id, PLAN);
      expect(planOf(f, s.id).at).toBeGreaterThan(stale);
      await expect(f.m.planDecide(s.id, 'approve', stale)).rejects.toThrow(/cambiato/);
    } finally { now.mockRestore(); }
  });

  it('accepts a direct typed approval, preserving its wording and unlocking delegation', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await f.call('plan_propose', s.id, PLAN);
    await f.m.send(s.id, 'Approvo, parti!');
    expect(planOf(f, s.id).phase).toBe('running');
    expect(f.sent.get(s.id)!.at(-1)).toBe('Approvo, parti!');
    expect(f.m.list().find(c => c.id === s.id)!.run!.plan!.approvedAt).toEqual(expect.any(Number));
    await expect(f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Dove'), step: 1 }] })).resolves.toBeDefined();
  });

  it('leaves the same proposal pending after unrelated, conditional, replayed or agent-authored text', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await f.call('plan_propose', s.id, PLAN);
    const pending = planOf(f, s.id);
    await f.m.send(s.id, 'Quanto dura?');
    await f.m.send(s.id, 'Approvo se prima aggiungi i test');
    await f.m.send(s.id, PLAN_APPROVED, undefined, false, 'Orchestrator', false, { kind: 'chat', chatId: 'other' });
    await f.m.send(s.id, PLAN_APPROVED, undefined, true);
    await f.m.send(s.id, PLAN_APPROVED, undefined, false, undefined, false, { kind: 'app' });
    expect(planOf(f, s.id)).toEqual(pending);
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'Dove')] })).rejects.toThrow(/not approved/);
  });

  it('keeps typed consent durable and exposes uncertain delivery when the engine rejects it', async () => {
    let fail = false;
    const f = fixture({}, undefined, () => { if (fail) throw new Error('engine offline'); });
    const s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await f.call('plan_propose', s.id, PLAN);
    const pending = planOf(f, s.id);
    fail = true;
    await expect(f.m.send(s.id, 'approvo parti')).rejects.toThrow(/engine offline/);
    expect(f.m.list().find(c => c.id === s.id)!.run!.plan!.approvedAt).toBeUndefined();
    await expectUnconfirmedPlan(f, s.id, pending, 'uncertain');
  });

  it('keeps consent without an ACK and exposes dispatching recovery instead of asking again', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await f.call('plan_propose', s.id, PLAN);
    const pending = planOf(f, s.id);
    const send = f.m.send.bind(f.m);
    f.m.send = async () => { throw new Error('motore spento'); };
    await expect(decide(f, s.id, 'approve')).rejects.toThrow(/motore spento/);
    f.m.send = send;
    await expectUnconfirmedPlan(f, s.id, pending, 'dispatching');
  });


  it('«aggiorna il piano»: plan_propose revise keeps the started steps and their chats, re-checks the groups, and waits for the user again', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await f.call('plan_propose', s.id, PLAN);
    await decide(f, s.id, 'approve');
    await f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Ordini · Dove'), step: 1 }] });
    const kid = f.m.list().find(c => c.parentId === s.id)!.id;
    // without revise a plan under way is never proposed again
    await expect(f.call('plan_propose', s.id, PLAN)).rejects.toThrow(/revise: true/);
    // a started step must come back with keep, a kept step only once, a step to do never beside a started one
    await expect(f.call('plan_propose', s.id, { revise: true, steps: [{ after: [], title: 'Nuovo', role: 'scout' }] })).rejects.toThrow(/step 1 «Trovo dove si calcola lo sconto» \(now\) already started: pass it as \{ keep: 1 \}/);
    await expect(f.call('plan_propose', s.id, { revise: true, steps: [{ keep: 1 }, { keep: 1 }] })).rejects.toThrow(/kept twice/);
    // a step to do may wait for a started one; a number out of range or a circle is refused (ADR 0359)
    await expect(f.call('plan_propose', s.id, { revise: true, steps: [{ keep: 1 }, { title: 'Insieme', role: 'scout', after: [5] }] })).rejects.toThrow(/after: the numbers of other steps/);
    await expect(f.call('plan_propose', s.id, { revise: true, steps: [{ keep: 1, title: 'altro' }] })).rejects.toThrow(/only keep and after/);
    const out = await f.call('plan_propose', s.id, { revise: true, steps: [{ keep: 1 }, { title: 'Applico lo sconto', role: 'artisan', preset: 'max', after: [1] }, { title: 'Controllo il codice', role: 'sentinel', after: [1] }] });
    expect(out).toMatchObject({ shown: true, steps: 3 });
    const plan = planOf(f, s.id);
    expect(plan.phase).toBe('proposed');
    expect(plan.doneWhen).toBe('I test passano'); // the old line when none is given
    expect(plan.steps[0]).toMatchObject({ title: 'Trovo dove si calcola lo sconto', role: 'scout', state: 'now', chatIds: [kid] });
    expect(plan.steps[1]).toMatchObject({ role: 'artisan', state: 'todo', preset: 'max' });
    expect(turnsOf(plan.steps)).toEqual([1, 2, 2]);
    // the user's approval is required again
    await expect(f.call('agent_delegate', s.id, { tasks: [{ ...f.task('artisan', 'Ordini · Sconto'), step: 2 }] })).rejects.toThrow(/not approved|waits for the user/);
    await decide(f, s.id, 'approve');
    expect(planOf(f, s.id)).toMatchObject({ phase: 'running', steps: [{ state: 'now', chatIds: [kid] }, { state: 'todo' }, { state: 'todo' }] });
  });

  it('the plan survives a restart, and its gate with it', async () => {
    const f = fixture();
    const s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
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
  it('recognizes complete approvals without interpreting quotations or changes as consent', () => {
    for (const text of [PLAN_APPROVED, 'approvo parti', 'ok vai', ' Approvo il piano! ']) expect(isPlanApproval(text)).toBe(true);
    for (const text of ['non approvo', 'approvo se aggiungi i test', '"approvo"', 'ok vai ma cambia il piano', 'approvo?', 'sì', 'ok']) expect(isPlanApproval(text)).toBe(false);
  });
  it('checks a proposal: steps, roles, lengths, unknown fields', () => {
    expect(checkProposal({ steps: [{ after: [], title: '  Due   spazi ' }] }).steps).toEqual([{ id: 's1', title: 'Due spazi', state: 'todo' }]);
    expect(() => checkProposal({ steps: Array(41).fill({ title: 'x', after: [] }) })).toThrow(/1 to 40/);
    expect(() => checkProposal({ steps: [{ after: [], title: 'x'.repeat(121) }] })).toThrow(/120/);
    expect(() => checkProposal({ steps: [{ after: [], title: 'x', owner: 'me' }] })).toThrow(/unknown field owner/);
    expect(() => checkProposal({ steps: [{ after: [], title: 'x' }], doneWhen: 3 })).toThrow(/doneWhen/);
  });
  it('one open doubt keeps the plan from being approved; his answer, the code or the brain closes it (ADR 0344)', async () => {
    const f = fixture(), s = await f.root('strategist');
    const doubts = [{ text: 'Vale anche sulle offerte?' }, { text: 'Serve su mobile?', by: 'code', answer: 'Sì', source: 'src/mobile.ts:3' }];
    // the list may come before any step
    expect(await f.call('plan_propose', s.id, { doubts })).toMatchObject({ shown: false, openDoubts: ['Vale anche sulle offerte?'] });
    expect(planOf(f, s.id)).toMatchObject({ phase: 'asking', steps: [], doubts: [{ state: 'open' }, { state: 'closed', by: 'code', source: 'src/mobile.ts:3' }] });
    // with its steps it is still not shown for approval, and nobody can approve it
    expect(await f.call('plan_propose', s.id, { steps: STEPS3, doubts })).toMatchObject({ shown: false });
    await expect(decide(f, s.id, 'approve')).rejects.toThrow(/non aspetta/);
    await expect(f.call('agent_delegate', s.id, { tasks: [f.task('scout', 'A', { step: 1 })] })).rejects.toThrow(/has not approved/);
    // it cannot be dropped, nor closed in his name
    await expect(f.call('plan_propose', s.id, PLAN)).rejects.toThrow(/still open/);
    await expect(f.call('plan_propose', s.id, { steps: STEPS3, doubts: [{ text: doubts[0]!.text, by: 'user', answer: 'Sì' }] })).rejects.toThrow(/did not answer/);
    // his answer, asked with the doubt's words, closes it at once
    await answerPanel(f, s.id, 'Vale anche sulle offerte?', 'No');
    expect(planOf(f, s.id).doubts![0]).toMatchObject({ state: 'closed', by: 'user', answer: 'No' });
    await f.call('plan_propose', s.id, { steps: STEPS3 });
    expect(planOf(f, s.id)).toMatchObject({ phase: 'proposed', doubts: [{ by: 'user' }, { by: 'code' }] });
    await decide(f, s.id, 'approve');
    expect(planOf(f, s.id)).toMatchObject({ phase: 'running', doubts: [{ by: 'user' }, { by: 'code' }] });
  });
  it('a new doubt takes a proposed plan back; his own typed words close it; an agent\'s message does not', async () => {
    const f = fixture(), s = await f.root('strategist');
    await f.call('plan_propose', s.id, PLAN);
    const at = planOf(f, s.id).at;
    await f.call('plan_propose', s.id, { doubts: [{ text: 'Solo online?' }] });
    expect(planOf(f, s.id).phase).toBe('revising');
    await expect(f.m.planDecide(s.id, 'approve', at)).rejects.toThrow(/non aspetta/);
    await f.m.send(s.id, 'lo sconto vale solo online', undefined, false, 'Orchestrator', false, { kind: 'app' });
    const close = { steps: STEPS3, doubts: [{ text: 'Solo online?', by: 'user', source: 'lo sconto vale solo online' }] };
    await expect(f.call('plan_propose', s.id, close)).rejects.toThrow(/did not answer/);
    await f.m.send(s.id, 'Guarda che lo sconto vale solo online.');
    await f.call('plan_propose', s.id, close);
    expect(planOf(f, s.id)).toMatchObject({ phase: 'proposed', doubts: [{ by: 'user', answer: 'lo sconto vale solo online' }] });
  });
  it('«Basta domande» ends the interview: a doubt left is closed by a declared choice, never in his name', async () => {
    const f = fixture(), s = await f.root('strategist');
    const doubt = { text: 'Vale anche sulle offerte?' }, choice = { ...doubt, by: 'choice', answer: 'No', source: 'più prudente' };
    await f.call('plan_propose', s.id, { doubts: [doubt] });
    await expect(f.call('plan_propose', s.id, { steps: STEPS3, doubts: [choice] })).rejects.toThrow(/Basta domande/);
    await answerPanel(f, s.id, doubt.text, ENOUGH_QUESTIONS);
    expect(planOf(f, s.id)).toMatchObject({ enough: true, clarified: [], doubts: [{ state: 'open' }] });
    expect(await f.call('plan_propose', s.id, { steps: STEPS3 })).toMatchObject({ shown: false, note: expect.stringMatching(/recommended choice/) });
    await f.call('plan_propose', s.id, { steps: STEPS3, doubts: [choice] });
    expect(planOf(f, s.id)).toMatchObject({ phase: 'proposed', doubts: [{ by: 'choice', answer: 'No', source: 'più prudente' }] });
  });
  it('the manager itself refuses an open doubt: the tool is not the only gate', async () => {
    const f = fixture(), s = await f.root('strategist');
    expect(() => f.m.planPropose(s.id, [{ id: 's1', title: 'x', state: 'todo' }], undefined, false, [{ text: 'Vale?', state: 'open' }])).toThrow(/dubbio aperto/);
    // a plan saved as proposed with a doubt open (an older or damaged file) is never approved, by him, the phone or the night
    const plan = f.m.planPropose(s.id, [{ id: 's1', title: 'x', state: 'todo' }]);
    const rec = (f.m as unknown as { chats: Map<string, { s: { plan: StrategyPlan } }> }).chats.get(s.id)!;
    rec.s.plan = { ...plan, doubts: [{ text: 'Vale?', state: 'open' }] };
    await expect(f.m.planDecide(s.id, 'approve', plan.at)).rejects.toThrow(/dubbio aperto/);
    await expect(f.m.planDecide(s.id, 'approve', plan.at, undefined, 'phone')).rejects.toThrow(/dubbio aperto/);
    await expect(f.m.send(s.id, 'approvo')).rejects.toThrow(/dubbio aperto/);
    expect(planOf(f, s.id).phase).toBe('proposed');
  });
  it('night mode: a plan with a doubt open does not start by itself; closed by a declared choice it does', async () => {
    const f = fixture({}, undefined, undefined, {}, [], true), s = await f.root('strategist');
    const doubt = { text: 'Vale anche sulle offerte?' };
    expect(await f.call('plan_propose', s.id, { steps: STEPS3, doubts: [doubt] })).toMatchObject({ shown: false });
    expect(planOf(f, s.id).phase).toBe('asking');
    await f.call('plan_propose', s.id, { steps: STEPS3, doubts: [{ ...doubt, by: 'choice', answer: 'No', source: 'più prudente' }] });
    expect(planOf(f, s.id).phase).toBe('running');
  });
  it('the gates, pure: proposal before any question, delegation before the ok', () => {
    const asking: StrategyPlan = { phase: 'asking', at: 1, clarified: [], steps: [] };
    expect(proposalGate(asking, false)).toMatch(/refused: pass .doubts./);
    expect(proposalGate({ ...asking, asked: 3 }, false)).toMatch(/refused/); // a count of questions opens nothing
    expect(proposalGate(asking, true)).toBeNull();
    expect(proposalGate({ ...asking, doubts: [] }, false)).toBeNull(); // listed before
    expect(proposalGate({ ...asking, asked: 1, enough: true }, false)).toBeNull();
    expect(proposalGate({ ...asking, phase: 'revising' }, false)).toBeNull();
    expect(delegationGate(null, 'agent_delegate')).toBeNull();
    expect(delegationGate({ ...asking, phase: 'running' }, 'agent_delegate')).toBeNull();
    expect(delegationGate({ ...asking, phase: 'done' }, 'agent_delegate')).toBeNull();
    for (const phase of ['asking', 'proposed', 'revising'] as const) expect(delegationGate({ ...asking, phase }, 'agent_assign_task')).toMatch(new RegExp(`^agent_assign_task refused: .*«${PLAN_APPROVED}»`));
  });
  it('a step may carry a short detail, checked and kept across a restart; the questions asked are counted', () => {
    expect(() => checkProposal({ steps: [{ after: [], title: 'x', detail: 'y'.repeat(401) }] })).toThrow(/detail: at most 400/);
    expect(() => checkProposal({ steps: [{ after: [], title: 'x', detail: 3 }] })).toThrow(/detail: required text/);
    expect(checkProposal({ steps: [{ after: [], title: 'x', detail: '' }] }).steps[0]).toEqual({ id: 's1', title: 'x', state: 'todo' });
    const p: StrategyPlan = { phase: 'proposed', at: 1, asked: 2, clarified: [], steps: checkProposal({ steps: [{ after: [], title: 'x', role: 'scout', detail: 'carrello e reso' }] }).steps };
    expect(readPlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(readPlan({ ...p, asked: -1 })).toBeNull();
    expect(readPlan({ ...p, steps: [{ id: 's1', title: 'x', state: 'todo', detail: 'y'.repeat(1201) }] })).toBeNull();
    const q = { question: 'Dove?' };
    expect(withClarified(p, [q], { 'Dove?': ENOUGH_QUESTIONS })).toMatchObject({ asked: 2, enough: true, clarified: [] });
    expect(withClarified(p, [q], { 'Dove?': 'basta domande, vai' })).toMatchObject({ asked: 2, enough: true, clarified: [] });
    expect(withClarified(p, [], {})).toBe(p);
    // the user's own words stop the questions too (ADR 0209), in it/en/de
    for (const x of ['Basta domande', 'niente più domande per ora', 'no more questions please', 'genug Fragen', 'proponi ora il piano']) expect(stopsQuestions(x)).toBe(true);
    for (const x of ['Il cliente fa troppe domande, basta?', 'Quali domande mancano?', 'Milano']) expect(stopsQuestions(x)).toBe(false);
    // a yes/no answer (ADR 0135) keeps its question, not its header
    const yn = { question: 'Tocco solo il carrello?', header: 'Ambito' };
    expect(withClarified(p, [yn], { 'Tocco solo il carrello?': 'Sì (consigliato)' }).clarified).toEqual([{ q: 'Tocco solo il carrello?', a: 'Sì' }]);
    expect(withClarified(p, [{ question: 'Dove?', header: 'Luogo' }], { 'Dove?': 'Milano' }).clarified).toEqual([{ q: 'Dove?', a: 'Milano' }]);
  });
  it('keeps the latest 8 answers, cut to 120 characters', () => {
    let p = plan();
    for (let i = 0; i < 10; i++) p = withClarified(p, [{ question: `q${i}` }], { [`q${i}`]: i === 9 ? 'x'.repeat(200) : ['a', 'b'] });
    expect(p.clarified).toHaveLength(8);
    expect(p.clarified[0]).toEqual({ q: 'q2', a: 'a, b' });
    expect(p.clarified[7]!.a).toHaveLength(120);
  });
});


