// The roles' improvement loop (ADR 0083: the app owns it, nothing changes without the user's click): a trial version is
// compared with its baseline over the same role × skill set and proposes keep or revert; the daily local rule proposes a
// model tier that does clearly better within a skill set; approving a tier opens a trial on it; a dismissal holds; a
// stale entry is dropped; nothing in the queue touches the catalog until agents:lifecycleDecide. Real catalog, run store
// and feedback store in temp folders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { AgentRunStore } from '../../../src/main/agents/runs';
import { RunFeedback } from '../../../src/main/agents/run-feedback';
import { createAgentLoop } from '../../../src/main/agents/loop';
import { evaluateTrial, TRIAL_DAYS } from '../../../src/main/agents/trials';
import { suggestTiers, TIER_MIN_KNOWN } from '../../../src/main/agents/suggestions';
import type { AgentModelChoice, AgentProfile, AgentRun } from '../../../src/shared/agents';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-role-loop-')); dirs.push(d); return d; };
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: null, authenticated: null }];
const DAY = 86_400_000, T0 = Date.UTC(2026, 9, 1, 12);

let seq = 0;
const run = (over: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${(++seq).toString(16).padStart(12, '0')}`, chatId: `c${seq}`, agentId: 'artisan', version: 1, goal: 'Fix', startedBy: 'orchestrator',
  startedAt: T0, endedAt: T0 + 1000, endReason: 'completed', costUsd: 1, tokens: null, tags: { skills: ['air-test'], app: null, repo: null }, tier: 'mid',
  outcome: { verdict: 'success', basis: 'human', by: 'user', at: T0 + 2000 }, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null },
  corrections: { tagged: 2, afterReport: 0 }, ...over });

function world(now = T0) {
  const userData = tmp(), clock = { now };
  const catalog = new AgentCatalogService({ userData, models, now: () => clock.now });
  const runs = new AgentRunStore(userData);
  const feedback = new RunFeedback({ userData, catalog, runs, publish: () => {}, send: async () => undefined, now: () => clock.now });
  const loop = createAgentLoop({ userData, catalog, runs, feedback, chats: { list: () => [] }, idle: () => true, now: () => clock.now });
  return { catalog, runs, feedback, loop, clock, role: (id: string) => catalog.list().profiles.find(p => p.id === id)! };
}

describe('trial evaluation', () => {
  const trialRole = (): AgentProfile => ({ id: 'artisan', scope: 'role', trial: { version: 2, baseline: 1, startedAt: T0 + 10_000 } } as AgentProfile);
  const baseline = () => Array.from({ length: 10 }, () => run());
  const better = () => Array.from({ length: 5 }, () => run({ version: 2, startedAt: T0 + 20_000, endedAt: T0 + 21_000, corrections: { tagged: 0, afterReport: 0 } }));
  it('waits for a sample, keeps a measured improvement, and goes back when it is worse', () => {
    expect(evaluateTrial(trialRole(), baseline(), T0 + 30_000).decision).toBe('wait');
    expect(evaluateTrial(trialRole(), [...baseline(), ...better()], T0 + 30_000)).toMatchObject({ decision: 'keep', comparable: 5 });
    const worse = Array.from({ length: 5 }, () => run({ version: 2, startedAt: T0 + 20_000, endedAt: T0 + 21_000, outcome: { verdict: 'fail', basis: 'human', by: 'user', at: 1 } }));
    expect(evaluateTrial(trialRole(), [...baseline(), ...worse], T0 + 30_000).decision).toBe('revert');
  });
  it('compares only the same skill set: other sets and untagged runs never count', () => {
    const other = Array.from({ length: 5 }, () => run({ version: 2, startedAt: T0 + 20_000, endedAt: T0 + 21_000, tags: { skills: ['other'], app: null, repo: null } }));
    const untagged = Array.from({ length: 2 }, () => { const r = run({ version: 2, startedAt: T0 + 20_000, endedAt: T0 + 21_000 }); delete r.tags; return r; });
    const r = evaluateTrial(trialRole(), [...baseline(), ...other, ...untagged], T0 + 30_000);
    expect(r).toMatchObject({ comparable: 0, otherRuns: 5, untagged: 2, decision: 'wait' });
    expect(evaluateTrial(trialRole(), [...baseline(), ...other], T0 + 10_000 + TRIAL_DAYS + 1).decision).toBe('revert'); // inconclusive at the window's end
  });
});

describe('tier suggestions (daily, local)', () => {
  const roles = [{ id: 'artisan', name: 'Artisan', scope: 'role', tier: 'mid', tierMax: 'top' } as AgentProfile];
  it('proposes the tier that does clearly better within the same skill set (Artisan + air-test: mid 40% vs top 100%)', () => {
    const mid = Array.from({ length: TIER_MIN_KNOWN }, (_, i) => run({ outcome: { verdict: i < 2 ? 'success' : 'fail', basis: 'human', by: 'user', at: 1 } }));
    const top = Array.from({ length: TIER_MIN_KNOWN }, () => run({ tier: 'top' }));
    const [p] = suggestTiers({ roles, runs: [...mid, ...top] }, T0 + DAY);
    expect(p).toMatchObject({ kind: 'tier', agentIds: ['artisan'], tier: 'top', skills: ['air-test'], state: 'pending' });
    expect(p!.reason).toMatch(/40%.*100%|100%.*40%/);
  });
  it('needs enough known outcomes on both sides; opinions and self-reports never count', () => {
    const mid = Array.from({ length: TIER_MIN_KNOWN }, () => run({ outcome: { verdict: 'fail', basis: 'human', by: 'user', at: 1 } }));
    const top = Array.from({ length: TIER_MIN_KNOWN }, () => run({ tier: 'top', outcome: { verdict: 'success', basis: 'orchestrator-opinion', by: 'o', at: 1 } }));
    expect(suggestTiers({ roles, runs: [...mid, ...top] }, T0 + DAY)).toEqual([]);
    expect(suggestTiers({ roles, runs: [...mid, ...top.slice(0, TIER_MIN_KNOWN - 1).map(r => ({ ...r, outcome: { ...r.outcome!, basis: 'human' as const } }))] }, T0 + DAY)).toEqual([]);
  });
});

describe('the queue: nothing is applied without the user', () => {
  it('a tier proposal waits; approving it opens a trial on that tier; the trial then proposes keep or revert', async () => {
    const w = world(T0 + DAY);
    const before = w.role('artisan');
    const mid = Array.from({ length: TIER_MIN_KNOWN }, (_, i) => run({ outcome: { verdict: i < 1 ? 'success' : 'fail', basis: 'human', by: 'user', at: 1 } }));
    const top = Array.from({ length: TIER_MIN_KNOWN }, () => run({ tier: 'top' }));
    const proposals = suggestTiers({ roles: [before], runs: [...mid, ...top] }, w.clock.now);
    expect(proposals).toHaveLength(1);
    for (const p of proposals) w.loop.lifecycle.propose(p);
    expect(w.role('artisan')).toMatchObject({ tier: 'mid', activeVersion: before.activeVersion }); // nothing applied yet
    const key = proposals[0]!.key;
    expect(w.loop.api.read({}).proposals.map(p => p.key)).toEqual([key]);
    await w.loop.api.decide({ key, decision: 'approve' });
    const after = w.role('artisan');
    expect(after).toMatchObject({ tier: 'top', activeVersion: before.activeVersion + 1, trial: { version: before.activeVersion + 1, baseline: before.activeVersion } });
    expect(w.loop.api.read({}).proposals).toEqual([]);
    await expect(w.loop.api.decide({ key, decision: 'approve' })).rejects.toThrow(/non trovata/);
  });
  it('a dismissed entry stays out; an entry that no longer matches its role is dropped', async () => {
    const w = world();
    const p = { key: 'tier:artisan:top:["air-test"]', kind: 'tier' as const, agentIds: ['artisan'], tier: 'top' as const, skills: ['air-test'], reason: 'r', evidence: [], at: T0, state: 'pending' as const };
    w.loop.lifecycle.propose(p);
    await w.loop.api.decide({ key: p.key, decision: 'dismiss' });
    w.loop.lifecycle.propose(p);
    expect(w.loop.lifecycle.proposals()).toEqual([]);
    expect(w.role('artisan').tier).toBe('mid');
    const stale = { ...p, key: 'tier:artisan:mid:[]', tier: 'mid' as const };
    w.loop.lifecycle.propose(stale);
    expect(w.loop.api.read({}).proposals).toEqual([]); // the role is already on mid
    await expect(w.loop.api.decide({ key: stale.key, decision: 'approve' })).rejects.toThrow(/non vale più/);
  });
  it('refuses a decision that is not approve or dismiss, and an unknown key', async () => {
    const w = world();
    await expect(w.loop.api.decide({ key: 'x', decision: 'apply' })).rejects.toThrow();
    await expect(w.loop.api.decide({ key: 'missing', decision: 'approve' })).rejects.toThrow(/non trovata/);
  });
});

describe('run feedback and Annulla', () => {
  it('an independent review (a Sentinel, or a Judge before ADR 0100) counts as reviewed evidence only when it ended verified, on any model (ADR 0091)', async () => {
    const w = world();
    const work = w.runs.start({ agentId: 'artisan', chatId: 'c_work', version: 1, goal: 'g', startedBy: 'orchestrator', startedAt: T0, costKnown: true });
    work.model = 'model-a';
    const judge = w.runs.start({ agentId: 'sentinel', chatId: 'c_judge', version: 1, goal: 'review', startedBy: 'app', startedAt: T0, costKnown: true, reviewOf: work.runId });
    judge.model = 'model-b'; judge.endedAt = T0 + 1; judge.endReason = 'completed';
    judge.report = { at: T0 + 1, outcome: 'done', verified: 'yes', summary: 'ok' };
    const opinion = await w.feedback.recordFeedback({ runId: work.runId, verdict: 'success', notes: 'fine', evidence: [] }, 'app:judge');
    expect(opinion.outcome.basis).toBe('orchestrator-opinion');
    const reviewed = await w.feedback.recordFeedback({ runId: work.runId, verdict: 'success', notes: 'verified', evidence: [{ kind: 'run', ref: judge.runId, at: T0 }] }, 'app:judge');
    expect(reviewed.outcome.basis).toBe('reviewed-evidence');
    judge.model = 'model-a';
    const same = await w.feedback.recordFeedback({ runId: work.runId, verdict: 'success', notes: 'same model', evidence: [{ kind: 'run', ref: judge.runId, at: T0 }] }, 'app:judge');
    expect(same.outcome.basis).toBe('reviewed-evidence'); // independence is the review's clean session, not another model
    judge.report = { at: T0 + 1, outcome: 'done', verified: 'no', summary: 'not checked' };
    const unverified = await w.feedback.recordFeedback({ runId: work.runId, verdict: 'fail', notes: 'unverified', evidence: [{ kind: 'run', ref: judge.runId, at: T0 }] }, 'app:judge');
    expect(unverified.outcome.basis).toBe('orchestrator-opinion');
    expect(w.runs.get(work.runId)!.outcome).toMatchObject({ verdict: 'success', basis: 'reviewed-evidence' }); // an opinion never overwrites it
    // a review a Judge ran before ADR 0100 still counts
    const old = w.runs.start({ agentId: 'judge', chatId: 'c_old_judge', version: 1, goal: 'review', startedBy: 'app', startedAt: T0, costKnown: true, reviewOf: work.runId });
    old.endedAt = T0 + 2; old.endReason = 'completed'; old.report = { at: T0 + 2, outcome: 'done', verified: 'yes', summary: 'ok' };
    expect((await w.feedback.recordFeedback({ runId: work.runId, verdict: 'success', notes: 'old', evidence: [{ kind: 'run', ref: old.runId, at: T0 }] }, 'app:judge')).outcome.basis).toBe('reviewed-evidence');
  });
  it('Annulla restores the version before an applied change, and a stale button is refused', () => {
    const w = world();
    const r = w.catalog.maintain('herald', { instructions: 'Write clearly. Cite the note.' }, 'lesson')!;
    expect(() => w.feedback.undo({ agentId: 'herald', expectedRevision: r.profile.updatedAt - 1, version: r.before })).toThrow(/cambiato/);
    const back = w.feedback.undo({ agentId: 'herald', expectedRevision: r.profile.updatedAt, version: r.before });
    expect(back.activeVersion).toBe(r.before);
  });
});
