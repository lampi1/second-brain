// A Strategist's work handed over (ADR 0356) on a real ChatManager with fake engines: an engine move carries its plan,
// plan_propose and the waiting approval to the chat that goes on (problem 2 of 2026-11-25), and a child's report pasted
// as JSON is delivered as an agent_report through the tool's own checks. Fixture: strategy-fixture.ts.
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { CoordinationStore } from '../../../src/main/coordination/store';
import { ENOUGH_QUESTIONS, PLAN_APPROVED } from '../../../src/shared/strategy';
import { answerPanel, decide, fixture, PLAN, planOf } from './strategy-fixture';

// problem 2 of 2026-11-25 (ADR 0356): a Strategist moved to another engine for a limit had no plan and no plan_propose;
// its approval stayed on the old, closed chat, and the auto-close closed the new one
describe('a Strategist that goes on in another chat keeps its plan with the user', () => {
  it('the plan, plan_propose and the waiting approval move to the new chat; «Approva» there starts the work', async () => {
    const f = fixture(), s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await f.call('plan_propose', s.id, PLAN);
    const proposal = planOf(f, s.id);
    const next = await f.m.continueChat(s.id, { ask: false, on: { harness: 'cursor', model: 'claude-opus-5-5', effort: null } });
    expect(next.id).not.toBe(s.id);
    expect(next.agent).toMatchObject({ id: 'strategist', source: 'catalog' });
    expect(planOf(f, next.id)).toMatchObject({ phase: 'proposed', at: proposal.at, steps: proposal.steps });
    expect(f.m.list().find(c => c.id === s.id)!.plan).toBeUndefined();
    for (const tool of ['plan_propose', 'plan_update', 'agent_delegate']) expect(f.m.chatToolShown(next.id, tool), tool).toBe(true);
    const store = new CoordinationStore(path.join(f.dir, 'app.db'));
    try {
      expect(store.original(s.id, `plan:${proposal.at}`)).toMatchObject({ state: 'cancelled' });
      expect(store.original(next.id, `plan:${proposal.at}`)).toMatchObject({ state: 'pending', key: { chatId: next.id } });
      expect(store.original(next.id, `plan:${proposal.at}`)!.key.jobId).toBe(store.original(s.id, `plan:${proposal.at}`)!.key.jobId);
    } finally { store.close(); }
    await expect(f.m.planDecide(s.id, 'approve', proposal.at)).rejects.toThrow();
    await f.m.planDecide(next.id, 'approve', proposal.at);
    expect(planOf(f, next.id).phase).toBe('running');
    expect(f.sent.get(next.id)?.at(-1)).toBe(PLAN_APPROVED);
  });
});

// to-do 4 of 2026-11-25 (ADR 0356): an Antigravity child without agent_report pasted its report as JSON and was closed
// «senza agent_report»; now the app reads it as the tool call, with the tool's own checks
describe('a report pasted as JSON in the last answer', () => {
  it('is delivered to the parent as an agent_report, criteria included', async () => {
    const f = fixture(), s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await f.call('plan_propose', s.id, PLAN);
    await decide(f, s.id, 'approve');
    await f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Ordini · Dove'), step: 1 }] });
    const kid = f.m.list().find(c => c.parentId === s.id)!;
    const sink = f.sinks.get(kid.id)!, json = { outcome: 'done', summary: 'Trovato in orders.ts', doneWhen: [{ criterion: 'criterion A', met: true }] };
    sink.changed({ state: 'running' });
    sink.item({ kind: 'assistant', id: 'a1', at: Date.now(), text: 'Ecco il report:\n```json\n' + JSON.stringify(json) + '\n```' }, false);
    sink.item({ kind: 'result', id: 'r1', at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false);
    sink.changed({ state: 'idle' });
    await vi.waitFor(() => expect(f.m.list().find(c => c.id === kid.id)!.delegation?.result).toMatchObject({ outcome: 'done', summary: 'Trovato in orders.ts' }));
    expect(f.m.list().find(c => c.id === kid.id)!.delegation!.result!.doneWhen).toEqual([{ criterion: 'criterion A', met: true }]);
  });
  it('a JSON the tool refuses (a criterion missing) is not taken: the usual reminder follows', async () => {
    const f = fixture(), s = await f.root('strategist');
    await answerPanel(f, s.id, 'Vuoi aggiungere vincoli?', ENOUGH_QUESTIONS);
    await f.call('plan_propose', s.id, PLAN);
    await decide(f, s.id, 'approve');
    await f.call('agent_delegate', s.id, { tasks: [{ ...f.task('scout', 'Ordini · Dove'), step: 1 }] });
    const kid = f.m.list().find(c => c.parentId === s.id)!;
    const sink = f.sinks.get(kid.id)!;
    sink.changed({ state: 'running' });
    sink.item({ kind: 'assistant', id: 'a1', at: Date.now(), text: JSON.stringify({ outcome: 'done', summary: 'x', doneWhen: [{ criterion: 'altro', met: true }] }) }, false);
    sink.item({ kind: 'result', id: 'r1', at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false);
    sink.changed({ state: 'idle' });
    await vi.waitFor(() => expect(f.sent.get(kid.id)?.some(t => t.includes('senza agent_report') && t.includes('sb-tool agent_report'))).toBe(true));
    expect(f.m.list().find(c => c.id === kid.id)!.delegation?.result).toBeUndefined();
  });
});
