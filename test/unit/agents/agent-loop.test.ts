// The whole agents' improvement loop with fakes around the real stores: a run ends → the gated, batched Orchestrator
// feedback request → feedback and metrics → proposals (repeated gap, Orchestrator draft) → the user approves → a trial
// version with routing snapshots → the trial evaluation against the baseline → a keep/rollback proposal → the user
// decides. Also: nothing applies without the user's decision, dismissals hold, probation verdicts are proposals, and a
// parent agent judges only its own sub-agent runs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { AgentRunStore } from '../../../src/main/agents/runs';
import { AgentAuthoring } from '../../../src/main/agents/authoring';
import { createAgentLoop, type AgentLoopDeps } from '../../../src/main/agents/loop';
import { childFeedbackTools } from '../../../src/main/agents/child-feedback';
import { feedbackGate, FEEDBACK_QUIET_MS } from '../../../src/main/agents/feedback-wake';
import { parentWins } from '../../../src/main/agents/routing-snapshot';
import { runMetrics } from '../../../src/main/agents/run-metrics';
import type { AgentDraft, AgentModelChoice, AgentProfile, AgentRun } from '../../../src/shared/agents';
import type { AgentClassification } from '../../../src/shared/agent-classifier';
import type { ChatSummary } from '../../../src/shared/contract';
import type { CallCtx } from '../../../src/main/mcp/server';

const dirs: string[] = [];
const tmp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-loop-')); dirs.push(p); return p; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed',
  models: [{ id: 'large', name: 'Large' }, { id: 'small', name: 'Small' }], installed: null, authenticated: null }];
const draft = (over: Partial<AgentDraft> = {}): AgentDraft => ({ name: 'Reader', purpose: 'Read files', instructions: 'Report observations.', engine: 'claude', model: 'large',
  avatar: { kind: 'symbol', value: 'eye' }, tools: { allow: ['read'] }, permissionCeiling: 'default', ...over });
const DAY = 86_400_000;

/** The Orchestrator chat as the gate reads it. */
const orchestrator = (over: Partial<ChatSummary> = {}): ChatSummary => ({ id: 'orch', title: 'Orchestrator', harness: 'claude', state: 'idle', pending: 0, isRegia: true, orchestrator: true,
  updatedAt: 0, createdAt: 0, cwd: '/', model: null, ...over } as unknown as ChatSummary);

function world() {
  let t = Date.UTC(2026, 9, 1, 9);
  const userData = tmp(), now = () => t;
  const catalog = new AgentCatalogService({ userData, models, now, approvedRoots: () => [userData] });
  const runs = new AgentRunStore(userData);
  const authoring = new AgentAuthoring({ userData, catalog, runs, items: () => [], now, suggestionSpend: () => 0, publish: vi.fn(), send: vi.fn(async () => undefined) });
  const chats: ChatSummary[] = [];
  const send = vi.fn(async (_id: string, _text: string, ..._rest: unknown[]) => undefined);
  /** the classifier: the agent whose instructions mention "observations" ranks first; anything else ranks second */
  let classify: AgentLoopDeps['classify'] = async (_q, profiles) => ({ mode: 'words', threshold: 60, noneCloseEnough: false, proposal: null,
    candidates: profiles.filter(p => p.status === 'active' && p.routable !== false).map(p => ({ id: p.id, score: /observations/.test(p.instructions) ? 80 : 20, why: { field: 'name' as const } }))
      .sort((a, b) => b.score - a.score) }) as AgentClassification;
  const deps: AgentLoopDeps = { userData, catalog, runs, authoring, classify: (...a) => classify(...a), chats: { list: () => chats, send },
    engineOn: () => true, userWaiting: () => false, wakeEnabled: () => true, idle: () => true, now, wakePolicy: { minBatch: 1, minAgeMs: 0 } };
  const loop = createAgentLoop(deps);
  // the authenticated agent_feedback path goes through the loop's facade, as in wiring.ts
  (authoring as unknown as { d: { feedback: unknown } }).d.feedback = (a: unknown, caller: string) => loop.api.feedback(a, caller);
  const agent = (id: string) => catalog.list().profiles.find(p => p.id === id) ?? catalog.list().archived.find(p => p.id === id)!;
  /** a run of `id` at its active version, through the hooks the ChatManager calls */
  const start = async (id: string, chatId: string, goal = 'Read the files', links: { parentRunId?: string } = {}): Promise<AgentRun> => {
    const run = runs.start({ agentId: id, version: agent(id).activeVersion, chatId, goal, startedBy: 'orchestrator', startedAt: t, costKnown: true, ...links });
    await loop.hooks.started(structuredClone(run));
    return run;
  };
  const end = (run: AgentRun, over: Partial<AgentRun> = {}) => {
    t += 60_000;
    Object.assign(run, { endedAt: t, endReason: 'completed', costUsd: 1, corrections: { tagged: 2, afterReport: 0 }, ...over });
    runs.save();
    loop.hooks.ended(structuredClone(run));
  };
  /** the user's verdict (run:outcome → ChatManager.markRun → onRunOutcome) */
  const verdict = (run: AgentRun, v: 'success' | 'fail' | 'partial') => { run.outcome = { verdict: v, basis: 'human', by: 'user', at: t }; runs.save(); loop.hooks.outcome(structuredClone(run)); };
  return { get t() { return t; }, set t(v) { t = v; }, userData, catalog, runs, authoring, chats, send, loop, agent, start, end, verdict, setClassify: (c: AgentLoopDeps['classify']) => { classify = c; } };
}

describe('the improvement loop, end to end', () => {
  it('run end → batched feedback request → gap proposal → Orchestrator draft → user approves → trial → keep proposal → user keeps', async () => {
    const w = world();
    const a = w.catalog.save(draft());
    // ten baseline runs judged by the user (corrections 2 each)
    for (let i = 0; i < 10; i++) { const r = await w.start(a.id, `base-${i}`); w.end(r); w.verdict(r, 'success'); }
    await w.loop.tick(); // the user judged them: no opinion needed, they leave the queue without a wake
    expect(w.loop.lifecycle.queuedRuns()).toEqual([]); expect(w.send).not.toHaveBeenCalled();
    // two runs end without a verdict: queued for the Orchestrator
    const r1 = await w.start(a.id, 'work-1'), r2 = await w.start(a.id, 'work-2');
    w.end(r1); w.end(r2, { outcome: undefined });
    expect(w.loop.lifecycle.queuedRuns()).toEqual([r1.runId, r2.runId]);
    // no Orchestrator: nothing goes, the batch waits
    await w.loop.tick();
    expect(w.send).not.toHaveBeenCalled();
    // an Orchestrator busy with the user: still nothing
    w.chats.push(orchestrator({ state: 'running', updatedAt: w.t }));
    await w.loop.tick(); expect(w.send).not.toHaveBeenCalled();
    // idle and quiet: ONE message for both runs, never resuming a closed engine (liveOnly)
    w.chats[0] = orchestrator({ updatedAt: w.t - FEEDBACK_QUIET_MS });
    await w.loop.tick();
    expect(w.send).toHaveBeenCalledTimes(1);
    const [to, text, , , , liveOnly] = w.send.mock.calls[0]!;
    expect(to).toBe('orch'); expect(liveOnly).toBe(true);
    expect(text).toContain(r1.runId); expect(text).toContain(r2.runId); expect(text).toContain('agent_feedback'); expect(text).toContain('agent_learn_propose');
    expect(w.loop.lifecycle.queuedRuns()).toEqual([]);
    // the Orchestrator answers: the same gap on both runs → one proposal; its opinion never counts in the success rate
    for (const r of [r1, r2]) await w.authoring.call('agent_feedback', { runId: r.runId, verdict: 'partial', notes: 'Missed the tests', evidence: [], gap: 'instructions', gapKey: 'test-contract' }, 'orch');
    let queue = w.loop.api.read({});
    expect(queue.proposals.map(p => p.key)).toEqual([`gap:${a.id}:1:instructions:test-contract`]);
    const metrics = runMetrics(w.runs.list(), {}).find(m => m.agentId === a.id)!.versions.find(v => v.version === 1)!;
    expect(metrics.successRate.n).toBe(10); expect(metrics.opinion.n).toBe(2);
    // the user approves the gap: the Orchestrator is asked for a concrete draft; nothing changes in the catalog
    const before = JSON.stringify(w.catalog.list().profiles);
    queue = await w.loop.api.decide({ key: queue.proposals[0]!.key, decision: 'approve' });
    expect(queue.proposals).toEqual([]);
    expect(w.send).toHaveBeenCalledTimes(2);
    expect(w.send.mock.calls[1]![1]).toMatch(/agent_propose/);
    expect(JSON.stringify(w.catalog.list().profiles)).toBe(before);
    // the draft: a queued proposal, applied only by the user's decision, as a trial against v1
    const proposal = await w.authoring.call('agent_update', { agentId: a.id, patch: { instructions: 'Report observations and run the tests.' }, reason: 'Missed the tests', expectedEffect: 'Fewer corrections' }, 'orch') as { id: string };
    expect(w.loop.api.read({}).drafts!.map(d => d.id)).toEqual([proposal.id]);
    expect(w.agent(a.id).activeVersion).toBe(1);
    w.t += 1000;
    expect(w.authoring.decide(proposal.id, true)).toMatchObject({ activeVersion: 2, trial: { version: 2, baseline: 1 } });
    // five trial runs: each with its routing snapshot (the parent v1 would also have won them), fewer corrections
    const trialRuns: AgentRun[] = [];
    for (let i = 0; i < 5; i++) { w.t += 1000; const r = await w.start(a.id, `trial-${i}`); trialRuns.push(r); w.end(r, { corrections: { tagged: 1, afterReport: 0 } }); }
    expect(trialRuns.every(r => r.routing?.trial?.baseline === 1 && r.routing.trial.parentWins === true && r.routing.rank === 1)).toBe(true);
    expect(trialRuns.every(r => parentWins(r, 1) === true)).toBe(true);
    expect(w.loop.api.read({}).proposals).toEqual([]); // no verdicts yet: coverage too low, it waits
    for (const r of trialRuns) w.verdict(r, 'success');
    queue = w.loop.api.read({});
    const key = `trial:${a.id}:2`;
    expect(queue.proposals.map(p => [p.key, p.kind])).toEqual([[key, 'keep']]);
    expect(queue.evaluations.find(e => e.version === 2)?.result).toMatchObject({ decision: 'keep', comparable: 5, unknownRouting: 0 });
    // still on trial until the user decides
    expect(w.agent(a.id).trial).toBeDefined();
    queue = await w.loop.api.decide({ key, decision: 'approve' });
    expect(w.agent(a.id).trial).toBeUndefined(); expect(w.agent(a.id).activeVersion).toBe(2);
    expect(w.catalog.history(a.id).find(v => v.version === 2)?.state).toBe('kept');
    expect(queue.proposals).toEqual([]);
  });

  it('a worse trial proposes the rollback; the user\'s approval restores the baseline definition cleanly', async () => {
    const w = world();
    const a = w.catalog.save(draft());
    for (let i = 0; i < 10; i++) { const r = await w.start(a.id, `base-${i}`); w.end(r); w.verdict(r, 'success'); }
    w.t += 1000;
    w.catalog.approveTrial(a.id, { ...a, instructions: 'Report observations tersely.' }, 'Shorter');
    for (let i = 0; i < 5; i++) { w.t += 1000; const r = await w.start(a.id, `trial-${i}`); w.end(r); w.verdict(r, 'fail'); }
    const key = `trial:${a.id}:2`;
    expect(w.loop.api.read({}).proposals.find(p => p.key === key)?.kind).toBe('revert');
    await w.loop.api.decide({ key, decision: 'approve' });
    const back = w.agent(a.id);
    expect(back).toMatchObject({ activeVersion: 1, instructions: 'Report observations.' });
    expect(back.trial).toBeUndefined();
    expect(w.catalog.history(a.id).find(v => v.version === 2)?.state).toBe('rejected');
    // the next run is on the baseline again
    const next = await w.start(a.id, 'after');
    expect(next.version).toBe(1); expect(next.routing?.trial).toBeUndefined();
  });

  it('unknown routing never counts as comparable work, and work the parent would not have won stays separate', async () => {
    const w = world();
    const a = w.catalog.save(draft()), other = w.catalog.save(draft({ name: 'Other', instructions: 'Write prose.' }));
    for (let i = 0; i < 10; i++) { const r = await w.start(a.id, `base-${i}`); w.end(r); w.verdict(r, 'success'); }
    w.t += 1000;
    w.catalog.approveTrial(a.id, { ...a, instructions: 'Read and summarise.' }, 'New scope');
    // the classifier fails on one run (unknown) and prefers the other agent once the parent definition is back for the rest
    let calls = 0;
    w.setClassify(async (_q, profiles) => {
      calls++;
      if (calls <= 2) throw new Error('model unavailable');
      const parent = profiles.find(p => p.id === a.id)!.instructions === 'Report observations.';
      return { mode: 'hybrid', threshold: 60, noneCloseEnough: false, proposal: null,
        candidates: [{ id: parent ? other.id : a.id, score: 90, why: { field: 'name' } }, { id: parent ? a.id : other.id, score: 40, why: { field: 'name' } }] };
    });
    for (let i = 0; i < 5; i++) { w.t += 1000; const r = await w.start(a.id, `trial-${i}`); w.end(r); w.verdict(r, 'success'); }
    const runs = w.runs.list().filter(r => r.version === 2);
    expect(runs.map(r => parentWins(r, 1))).toEqual([null, false, false, false, false]);
    expect(runs[1]!.routing).toMatchObject({ mode: 'hybrid', rank: 1, score: 90 });
    const result = w.loop.api.read({}).evaluations.find(e => e.agentId === a.id)!.result;
    expect(result).toMatchObject({ comparable: 0, otherRuns: 4, unknownRouting: 1, decision: 'wait' });
    // at the end of the trial window, no comparable evidence proposes going back (the user decides)
    w.t += 22 * DAY; w.loop.evaluate(a.id);
    expect(w.loop.api.read({}).proposals.find(p => p.key === `trial:${a.id}:2`)).toMatchObject({ kind: 'revert', reason: 'Campione comparabile insufficiente' });
  });

  it('dismiss drops an entry and keeps it out; a decision on a stale entry is refused; approvals need the decide call', async () => {
    const w = world();
    const a = w.catalog.save(draft());
    for (let i = 0; i < 10; i++) { const r = await w.start(a.id, `base-${i}`); w.end(r); w.verdict(r, 'success'); }
    w.t += 1000;
    w.catalog.approveTrial(a.id, { ...a, instructions: 'Report observations tersely.' }, 'Shorter');
    for (let i = 0; i < 5; i++) { w.t += 1000; const r = await w.start(a.id, `trial-${i}`); w.end(r); w.verdict(r, 'fail'); }
    const key = `trial:${a.id}:2`;
    await w.loop.api.decide({ key, decision: 'dismiss' });
    expect(w.agent(a.id).trial).toBeDefined(); // dismissing never decides the trial
    const r = await w.start(a.id, 'more'); w.end(r); w.verdict(r, 'fail');
    expect(w.loop.api.read({}).proposals.find(p => p.key === key)).toBeUndefined();
    w.t += 8 * DAY; w.loop.evaluate(a.id);
    expect(w.loop.api.read({}).proposals.find(p => p.key === key)?.kind).toBe('revert');
    // the user closes the trial on the agent page instead: the entry is gone and a late click is refused
    w.catalog.resolveTrial(a.id, 'keep');
    expect(w.loop.api.read({}).proposals.find(p => p.key === key)).toBeUndefined();
    await expect(w.loop.api.decide({ key, decision: 'approve' })).rejects.toThrow(/non vale più|non trovata/);
    await expect(w.loop.api.decide({ key, decision: 'yes' })).rejects.toThrow(/non valida/);
    await expect(w.loop.api.decide({ key, decision: 'approve', agentId: a.id })).rejects.toThrow(/non valida/);
  });

  it('probation verdicts and model trials are proposals; the user\'s approval applies them', async () => {
    const w = world();
    const a = w.catalog.save(draft());
    w.loop.hooks.probation(a, { decision: 'retire', reason: 'Esito negativo confermato' });
    // not in probation: the entry is not valid for this agent and is hidden
    expect(w.loop.api.read({}).proposals).toEqual([]);
    w.loop.lifecycle.propose({ key: `model:${a.id}:small`, kind: 'model-trial', agentIds: [a.id], model: 'small', reason: 'Cheaper per success', evidence: [], at: w.t, state: 'pending' });
    expect(w.agent(a.id).model).toBe('large');
    await w.loop.api.decide({ key: `model:${a.id}:small`, decision: 'approve' });
    expect(w.agent(a.id)).toMatchObject({ model: 'small', activeVersion: 2, trial: { version: 2, baseline: 1 } });
  });

  it('a drafting approval without an Orchestrator is refused and the entry stays', async () => {
    const w = world();
    w.loop.lifecycle.propose({ key: 'work:x', kind: 'create', agentIds: [], reason: '3 ricorrenze', evidence: [], at: w.t, state: 'pending' });
    await expect(w.loop.api.decide({ key: 'work:x', decision: 'approve' })).rejects.toThrow(/Orchestrator/);
    expect(w.loop.api.read({}).proposals.map(p => p.key)).toEqual(['work:x']);
  });

  it('the feedback wake is capped per day and spaced', async () => {
    const w = world();
    const a = w.catalog.save(draft());
    w.chats.push(orchestrator({ updatedAt: 0 }));
    let sent = 0;
    for (let i = 0; i < 6; i++) {
      const r = await w.start(a.id, `w-${i}`); w.end(r);
      await w.loop.tick(); sent = w.send.mock.calls.length;
      w.t += 30 * 60_000; // half an hour between runs
    }
    expect(sent).toBe(2); // 2 h apart within the same morning: at most every fourth half hour
    w.t += DAY;
    await w.loop.tick();
    expect(w.send.mock.calls.length).toBe(3);
  });
});

describe('the feedback gate', () => {
  const at = 10 * FEEDBACK_QUIET_MS;
  it.each([
    [[], 'no Orchestrator'],
    [[orchestrator({ closedAt: 1 })], 'no Orchestrator'],
    [[orchestrator({ state: 'closed' })], 'Orchestrator closed'],
    [[orchestrator({ state: 'waiting' })], 'Orchestrator waiting'],
    [[orchestrator({ pending: 1 })], 'Orchestrator waits for the user'],
    [[orchestrator({ updatedAt: at - 1000 })], 'Orchestrator active in the last minutes'],
  ] as [ChatSummary[], string][])('holds: %s', (chats, reason) => expect(feedbackGate(chats, at, () => true, false)).toEqual({ refused: reason }));
  it('holds while the user is waiting elsewhere or the engine is off; passes otherwise', () => {
    expect(feedbackGate([orchestrator()], at, () => true, true)).toEqual({ refused: 'a request waits for the user' });
    expect(feedbackGate([orchestrator()], at, () => false, false)).toEqual({ refused: 'Orchestrator engine switched off' });
    expect(feedbackGate([orchestrator()], at, () => true, false)).toMatchObject({ chat: { id: 'orch' } });
  });
});

describe('sub-agent runs', () => {
  const ctx = (chatId?: string) => ({ params: chatId ? { chatId } : {} } as unknown as CallCtx);
  it('a parent judges only its own sub-agent runs; the opinion feeds the store, the metrics and the gap proposals', async () => {
    const w = world();
    const parent = w.catalog.save(draft({ name: 'Lead' })), child = w.catalog.save(draft({ name: 'Helper' }));
    const p = await w.start(parent.id, 'lead-chat', 'Plan the work');
    const c1 = await w.start(child.id, 'helper-1', 'Read part one', { parentRunId: p.runId });
    const c2 = await w.start(child.id, 'helper-2', 'Read part two', { parentRunId: p.runId });
    const stranger = await w.start(child.id, 'helper-3', 'Unrelated');
    // the sub-agent's request is a run like any other: goal, pinned version, routing snapshot
    expect(c1).toMatchObject({ parentRunId: p.runId, version: 1, goal: 'Read part one' }); expect(c1.routing).toMatchObject({ agentId: child.id, version: 1 });
    w.end(c1); w.end(c2);
    const tools = childFeedbackTools(w.loop.api, () => w.runs.list());
    const list = tools.find(t => t.name === 'agent_children')!, judge = tools.find(t => t.name === 'agent_child_feedback')!;
    const seen = JSON.parse(await list.run({}, ctx('lead-chat')) as string) as { yourRuns: { runId: string }[]; children: { runId: string }[] };
    expect(seen.yourRuns.map(r => r.runId)).toEqual([p.runId]);
    expect(seen.children.map(r => r.runId).sort()).toEqual([c1.runId, c2.runId].sort());
    const args = (runId: string) => ({ runId, verdict: 'partial', notes: 'Skipped the appendix', evidence: [], gap: 'instructions', gapKey: 'appendix' });
    await judge.run(args(c1.runId), ctx('lead-chat'));
    expect(w.runs.get(c1.runId)!.outcome).toMatchObject({ basis: 'orchestrator-opinion', by: 'lead-chat', verdict: 'partial' });
    // never on another run, on its own run, from the sub-agent itself, nor without a chat
    await expect(judge.run(args(stranger.runId), ctx('lead-chat'))).rejects.toThrow(/your own sub-agents/);
    await expect(judge.run(args(p.runId), ctx('lead-chat'))).rejects.toThrow(/your own sub-agents/);
    await expect(judge.run(args(c2.runId), ctx('helper-1'))).rejects.toThrow(/your own sub-agents/);
    await expect(judge.run(args(c2.runId), ctx())).rejects.toThrow(/own endpoint/);
    await expect(judge.run({ ...args(c2.runId), agentId: parent.id }, ctx('lead-chat'))).rejects.toThrow(/unknown argument/);
    await expect(judge.run({ ...args(c2.runId), sendToRun: true }, ctx('lead-chat'))).rejects.toThrow();
    expect(w.authoring.feedbackOf(child.id).map(f => f.runId)).toEqual([c1.runId]);
    // the same gap on the second child → the same proposal chain as the Orchestrator's feedback
    await judge.run(args(c2.runId), ctx('lead-chat'));
    expect(w.loop.api.read({}).proposals.map(x => x.key)).toEqual([`gap:${child.id}:1:instructions:appendix`]);
    expect(runMetrics(w.runs.list(), {}).find(m => m.agentId === child.id)!.versions[0]!.opinion.n).toBe(2);
    // judged: the Orchestrator's batch skips them
    expect(w.loop.lifecycle.queuedRuns()).toEqual([c1.runId, c2.runId]);
    w.chats.push(orchestrator());
    await w.loop.tick();
    expect(w.send).not.toHaveBeenCalled();
    expect(w.loop.lifecycle.queuedRuns()).toEqual([]);
  });
});

describe('approval surfaces', () => {
  it('the learned rules and the Orchestrator drafts are in the same read, and reading applies nothing', async () => {
    const w = world();
    const a = w.catalog.save(draft());
    const loop = createAgentLoop({ userData: w.userData, catalog: w.catalog, runs: w.runs, authoring: w.authoring, classify: async () => { throw new Error('none'); },
      learning: { pending: () => [{ id: 'l1', agentId: a.id, rule: 'Always cite files', evidence: 'r_000000000001', createdAt: 1, status: 'pending' }] },
      chats: { list: () => [], send: vi.fn() }, engineOn: () => true, userWaiting: () => false, wakeEnabled: () => false, idle: () => false });
    await w.authoring.call('agent_archive', { agentId: a.id, reason: 'Unused' }, 'orch');
    const snap = loop.api.read({ agentId: a.id });
    expect(snap.learned!.map(l => l.id)).toEqual(['l1']);
    expect(snap.drafts!.map(d => d.op)).toEqual(['archive']);
    expect(w.agent(a.id).status).toBe('active');
  });
  it('a stored run keeps its routing snapshot across restarts; a malformed one makes the file unreadable', async () => {
    const w = world();
    const a: AgentProfile = w.catalog.save(draft());
    const r = await w.start(a.id, 'c1');
    expect(new AgentRunStore(w.userData).get(r.runId)!.routing).toEqual(r.routing);
    expect(w.runs.setRouting(r.runId, { ...r.routing!, at: 2 })).toBe(false); // set once
    const file = path.join(w.userData, 'agent-runs.json'), body = JSON.parse(fs.readFileSync(file, 'utf8'));
    body.runs[0].routing.trial = { baseline: 0, parentWins: 'yes' };
    fs.writeFileSync(file, JSON.stringify(body));
    expect(new AgentRunStore(w.userData).problem).not.toBeNull();
  });
});

describe('review hardening', () => {
  it('a double approval of a drafting entry sends the Orchestrator one request', async () => {
    const w = world();
    w.chats.push(orchestrator());
    let release!: () => void;
    w.send.mockImplementationOnce(() => new Promise<undefined>(r => { release = () => r(undefined); }));
    w.loop.lifecycle.propose({ key: 'work:x', kind: 'create', agentIds: [], reason: '3 ricorrenze', evidence: [], at: w.t, state: 'pending' });
    const first = w.loop.api.decide({ key: 'work:x', decision: 'approve' });
    const second = w.loop.api.decide({ key: 'work:x', decision: 'approve' });
    await expect(second).rejects.toThrow(/già/);
    release(); await first;
    expect(w.send).toHaveBeenCalledTimes(1);
    expect(w.loop.api.read({}).proposals).toEqual([]);
  });

  it('a failed feedback delivery is not retried at every heartbeat', async () => {
    const w = world();
    const a = w.catalog.save(draft());
    w.chats.push(orchestrator({ updatedAt: 0 }));
    w.send.mockRejectedValue(new Error('engine refused'));
    const r = await w.start(a.id, 'w-1'); w.end(r);
    await w.loop.tick(); w.t += 10_000; await w.loop.tick(); w.t += 10_000; await w.loop.tick();
    expect(w.send).toHaveBeenCalledTimes(1);
    expect(w.loop.lifecycle.queuedRuns()).toEqual([r.runId]);
    w.t += FEEDBACK_QUIET_MS; await w.loop.tick();
    expect(w.send).toHaveBeenCalledTimes(2);
  });

  it('pruning the feedback queue reads the catalog once per heartbeat, not once per queued run', async () => {
    const w = world();
    const a = w.catalog.save(draft());
    for (let i = 0; i < 20; i++) { const r = await w.start(a.id, `q-${i}`); w.end(r); }
    const list = vi.spyOn(w.catalog, 'list');
    await w.loop.tick(); // no Orchestrator: the gate holds, the queue is only pruned
    expect(w.loop.lifecycle.queuedRuns()).toHaveLength(20);
    expect(list.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
