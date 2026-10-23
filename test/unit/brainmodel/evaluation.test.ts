// Offline evaluation acceptance: imports cannot forge outcomes, holdout remains separate, measurements retain
// missing-data coverage, and replay/promotion receipts come from fresh recorded runs rather than model claims.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentRun } from '../../../src/shared/agents';
import { contentDigest, EvaluationStore, evaluationSummary, importEvaluationDataset, syntheticEvaluationDataset } from '../../../src/main/brainmodel/evaluation';
import { SkillCandidateService } from '../../../src/main/brainmodel/skill-candidates';
import { LearningReviewService } from '../../../src/main/brainmodel/learning-review';
import { ChangeLog } from '../../../src/main/brainmodel/changes';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-evaluation-')); dirs.push(d); return d; };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const NOW = 1000;
const dataset = () => ({ id: 'examples-v1', name: 'Anonymized annotated examples', anonymized: true, cases: [
  { id: 'draft', family: 'drafting', input: 'Write a synthetic draft from note A.', criteria: ['Uses note A'], split: 'tuning' },
  { id: 'check', family: 'checking', input: 'Check synthetic note B against its provided source.', criteria: ['Checks source B'], split: 'holdout' },
] });
let sequence = 0;
function recorded(criteria = ['Checks source B']): AgentRun {
  const runId = `r_${(++sequence).toString(16).padStart(12, '0')}`;
  return { runId, chatId: runId, agentId: 'scout', version: 1, goal: 'Replay task', startedBy: 'app', startedAt: NOW, endedAt: NOW + 10, endReason: 'completed',
    counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0.1, turns: 2,
    tokens: { input: 10, output: 5, cacheRead: 20, cacheWrite: 3 },
    outcome: { basis: 'reviewed-evidence', verdict: 'success', at: NOW + 10, by: 'sentinel' },
    report: { at: NOW + 10, outcome: 'done', verified: 'yes', summary: 'Checked', canonical: { runId, taskId: runId, taskVersion: 1, at: NOW + 10, outcome: 'done', summary: 'Checked', output: 'Full answer', doneWhen: criteria.map(criterion => ({ criterion, met: true, evidence: 'Synthetic source provided in case' })) } },
  };
}
async function finish(store: EvaluationStore, id: string) { await vi.waitFor(() => expect(store.replay(id)?.status).not.toBe('running')); }
function world(verified = true) {
  const root = tmp(), runs: AgentRun[] = [];
  const store = new EvaluationStore({ file: path.join(root, 'evaluations.json'), runs: () => runs, now: () => NOW, execute: async ({ test }) => {
    const run = recorded(test.criteria); if (!verified) delete run.outcome; runs.push(run); return run.runId;
  } });
  return { root, runs, store };
}

describe('evaluation imports and replay', () => {
  it('labels built-in examples synthetic and refuses forged proof, PII and leaked splits', () => {
    expect(syntheticEvaluationDataset().origin).toBe('synthetic');
    const data = dataset();
    expect(importEvaluationDataset(data, NOW).origin).toBe('anonymized');
    const long = dataset(); long.cases[0]!.criteria = ['x'.repeat(301)];
    expect(() => importEvaluationDataset(long, NOW)).toThrow('300 characters');
    expect(() => importEvaluationDataset({ ...data, verdict: 'success' }, NOW)).toThrow('Unsupported field');
    expect(() => importEvaluationDataset({ ...data, anonymized: false }, NOW)).toThrow('anonymized');
    data.cases[1]!.input = 'Contact person@example.com';
    expect(() => importEvaluationDataset(data, NOW)).toThrow('identifying');
    data.cases[1]!.input = data.cases[0]!.input;
    expect(() => importEvaluationDataset(data, NOW)).toThrow('leakage');
    data.cases[1]!.input = 'Different text'; data.cases[1]!.family = data.cases[0]!.family;
    expect(() => importEvaluationDataset(data, NOW)).toThrow('leakage');
  });
  it('keeps dataset versions immutable and prevents cross-version holdout reuse', () => {
    const { store } = world(); store.import(dataset());
    expect(() => store.import(dataset())).toThrow('already exists');
    const next = dataset(); next.id = 'examples-v2'; next.cases.reverse(); next.cases[0]!.split = 'tuning'; next.cases[1]!.split = 'holdout';
    expect(() => store.import(next)).toThrow('leakage');
  });
  it('requires independently verified outcomes; late review and later retraction update eligibility', async () => {
    const { store, runs } = world(false); store.import(dataset());
    const candidate = { name: 'check-source', text: 'concrete steps', digest: contentDigest('concrete steps') };
    const replay = store.startReplay('examples-v1', 'holdout', candidate); await finish(store, replay.id);
    expect(store.replay(replay.id)?.status).toBe('awaiting-review');
    expect(store.eligibleReplay(replay.id, candidate)).toBe(false);
    runs[0]!.outcome = { basis: 'reviewed-evidence', verdict: 'success', by: 'sentinel', at: NOW + 10 };
    expect(store.eligibleReplay(replay.id, candidate)).toBe(true);
    runs[0]!.outcome.verdict = 'fail';
    expect(store.replay(replay.id)?.status).toBe('failed');
    expect(store.eligibleReplay(replay.id, candidate)).toBe(false);
  });
  it('refuses recycled run evidence and never silently starts a provider without an executor', async () => {
    const root = tmp(), old = recorded();
    const unavailable = new EvaluationStore({ file: path.join(root, 'none.json'), runs: () => [old] });
    expect(() => unavailable.startReplay('synthetic-workflow-v1', 'holdout')).toThrow('unavailable');
    const store = new EvaluationStore({ file: path.join(root, 'old.json'), runs: () => [old], now: () => NOW, execute: async () => old.runId });
    const replay = store.startReplay('synthetic-workflow-v1', 'holdout'); await finish(store, replay.id);
    expect(store.replay(replay.id)?.status).toBe('failed');
    expect(store.replay(replay.id)?.cases[0]?.error).toContain('fresh');
  });
  it('compares only paired cases with explicit coverage and no causal claim', async () => {
    const { store, runs } = world(); store.import(dataset());
    const before = store.startReplay('examples-v1', 'holdout'); await finish(store, before.id);
    const after = store.startReplay('examples-v1', 'holdout'); await finish(store, after.id);
    runs[1]!.tokens = null; runs[1]!.costUsd = null; delete runs[1]!.turns;
    const comparison = store.compare(before.id, after.id);
    expect(comparison).toMatchObject({ comparable: true, pairedCases: 1, before: { tasks: 1, turns: { value: 2, n: 1 } }, after: { costUsd: { value: null, n: 0, total: 1 }, tokens: { input: { value: null, n: 0 } } } });
    expect(comparison.note).toBe('matched-retained-descriptive');
    runs.shift();
    expect(store.compare(before.id, after.id)).toMatchObject({ pairedCases: 0, before: { tasks: 0 }, after: { tasks: 0 } });
    expect(evaluationSummary([recorded(), { ...recorded(), costUsd: null }]).costUsd).toEqual({ value: 0.1, n: 1, total: 2 });
  });
});

const draft = '---\nname: check-source\ndescription: Check a source against a claim\n---\n\n## Steps\n1. Read the provided source and identify the exact claim.\n2. Compare the claim to the source and cite the difference.\n';
describe('candidate promotion', () => {
  function candidates() {
    const w = world(), source = recorded(); w.runs.push(source);
    const log = new ChangeLog(path.join(w.root, 'local'), () => NOW);
    log.apply({ job: 'repeated-task', kind: 'skill', action: 'create', target: 'check-source', summary: 'Candidate', reason: 'Repeated requests only', evidence: [source.runId] }, [{ file: path.join(w.root, 'memory/skill-candidates/check-source.md'), text: draft }]);
    const service = new SkillCandidateService({ root: w.root, log, evaluations: w.store, runs: () => w.runs });
    return { ...w, source, service };
  }
  it('refuses repeat-only and synthetic evidence, promotes exact replayed text, never auto-links roles', async () => {
    const { service, store, root, source } = candidates();
    const view = service.inspect('check-source');
    expect(view.stepsReady).toBe(true);
    expect(view.promotionProblems.join(' ')).toContain('holdout');
    expect(() => service.promote(view.name, view.digest, 'fake-replay', source.runId)).toThrow();
    const synthetic = store.startReplay('synthetic-workflow-v1', 'holdout', service.replayCandidate(view.name)); await finish(store, synthetic.id);
    expect(service.inspect(view.name).eligibleReplayIds).toEqual([]);
    store.import(dataset());
    const real = store.startReplay('examples-v1', 'holdout', service.replayCandidate(view.name)); await finish(store, real.id);
    expect(service.inspect(view.name).eligibleReplayIds).toEqual([real.id]);
    expect(service.promote(view.name, view.digest, real.id, source.runId).promoted).toBe(true);
    expect(fs.readFileSync(path.join(root, '.claude/skills/check-source/SKILL.md'), 'utf8')).toBe(draft);
    expect(() => service.promote(view.name, view.digest, real.id, source.runId)).toThrow('already-promoted');
  });
  it('invalidates replay eligibility on edits or revoked independent evidence and rejects path escapes', async () => {
    const { service, store, source } = candidates(); store.import(dataset());
    const view = service.inspect('check-source');
    const replay = store.startReplay('examples-v1', 'holdout', service.replayCandidate(view.name)); await finish(store, replay.id);
    source.outcome!.basis = 'self-report';
    expect(service.inspect(view.name).verifiedExampleRunIds).toEqual([]);
    source.outcome!.basis = 'human';
    const changed = service.save(view.name, draft + '\n3. Check the source date before reporting.\n', view.digest);
    expect(changed.eligibleReplayIds).toEqual([]);
    expect(() => service.save(view.name, draft, view.digest)).toThrow('changed');
    expect(() => service.save(view.name, draft.replace('name: check-source', 'name: another-name') + '\nname: check-source\n', changed.digest)).toThrow('same candidate name');
    expect(() => service.inspect('../outside')).toThrow('Invalid');
  });
  it('refuses a symlinked target before promotion can write outside the brain', () => {
    const { root, service } = candidates(), outside = tmp();
    fs.symlinkSync(outside, path.join(root, '.claude'), 'dir');
    expect(() => service.inspect('check-source')).toThrow('Linked');
  });
});


describe('learning facade isolation', () => {
  it('keeps datasets and receipts in the selected brain and captures execution scope', async () => {
    const a = tmp(), b = tmp(), userData = tmp(), runs: AgentRun[] = [];
    let root = a;
    const captured: string[] = [];
    const service = new LearningReviewService({ userData, root: () => root, log: new ChangeLog(userData), runs: () => runs, now: () => NOW,
      execute: async ({ test, brainRoot }) => { captured.push(brainRoot); const r = recorded(test.criteria); runs.push(r); return r.runId; } });
    service.import(dataset());
    const receipt = service.replay('examples-v1', 'holdout');
    root = b;
    expect(service.state().datasets.map(d => d.id)).toEqual(['synthetic-workflow-v1']);
    expect(service.state().replays).toEqual([]);
    root = a;
    await vi.waitFor(() => expect(service.state().replays.find(r => r.id === receipt.id)?.status).toBe('passed'));
    expect(captured).toEqual([a]);
    expect(new LearningReviewService({ userData, root: () => b, log: new ChangeLog(userData), runs: () => runs }).state().replays).toEqual([]);
  });
  it('includes retained descendant effort once per task and keeps missing child cost unknown', () => {
    const root = recorded(), child = { ...recorded(), parentRunId: root.runId }, review = { ...recorded(), reviewOf: root.runId };
    expect(evaluationSummary([root], [root, child, review]).turns).toEqual({ value: 4, n: 1, total: 1 });
    child.costUsd = null;
    expect(evaluationSummary([root], [root, child, review]).costUsd).toEqual({ value: null, n: 0, total: 1 });
  });
});


describe('learning evidence inspector', () => {
  it('returns complete referenced output and reviewer reports, and rejects unreferenced or other-brain runs', async () => {
    const a = tmp(), b = tmp(), userData = tmp(), runs: AgentRun[] = [];
    let root = a;
    const service = new LearningReviewService({ userData, root: () => root, log: new ChangeLog(userData), runs: () => runs, now: () => NOW,
      execute: async ({ test, brainRoot }) => { const r = recorded(test.criteria); r.scope = { brainRoot, projectRoot: brainRoot }; r.report!.canonical!.output = 'Complete output '.repeat(1000); runs.push(r); return r.runId; } });
    service.import(dataset());
    const replay = service.replay('examples-v1', 'holdout');
    await vi.waitFor(() => expect(service.state().replays.find(r => r.id === replay.id)?.status).toBe('passed'));
    const source = runs[0]!;
    const reviewer = { ...recorded(), agentId: 'sentinel', reviewOf: source.runId, scope: { brainRoot: a, projectRoot: a } };
    const unrelated = recorded();
    const wrongBrain = { ...recorded(), agentId: 'sentinel', reviewOf: source.runId, scope: { brainRoot: b, projectRoot: b } };
    runs.push(reviewer, unrelated, wrongBrain);
    const evidence = service.evidence(source.runId);
    expect(evidence.run.report!.canonical!.output).toBe(source.report!.canonical!.output);
    expect(evidence.run.report!.canonical!.doneWhen[0]?.criterion).toBe('Checks source B');
    expect(evidence.reviews.map(r => r.runId)).toEqual([reviewer.runId]);
    expect(service.evidence(reviewer.runId).run.reviewOf).toBe(source.runId);
    expect(() => service.evidence(unrelated.runId)).toThrow('selected brain');
    expect(() => service.evidence(wrongBrain.runId)).toThrow('selected brain');
    evidence.run.report!.canonical!.output = 'mutated view';
    expect(service.evidence(source.runId).run.report!.canonical!.output).not.toBe('mutated view');
    root = b;
    expect(() => service.evidence(source.runId)).toThrow('selected brain');
    expect(() => service.evidence(reviewer.runId)).toThrow('selected brain');
  });
  it('allows only currently linked lesson sources and keeps the brain scope guard', () => {
    const root = tmp(), other = tmp(), data = tmp(), source = recorded();
    source.scope = { brainRoot: root, projectRoot: root };
    let refs = [source.runId], currentRoot = root;
    const service = new LearningReviewService({ userData: data, root: () => currentRoot, log: new ChangeLog(data), runs: () => [source], lessonSources: () => refs });
    expect(service.evidence(source.runId).run.runId).toBe(source.runId);
    refs = []; expect(() => service.evidence(source.runId)).toThrow('selected brain');
    refs = [source.runId]; currentRoot = other; expect(() => service.evidence(source.runId)).toThrow('selected brain');
  });
  it('allows candidate source evidence with historical missing scope but never invents full output', () => {
    const root = tmp(), data = tmp(), source = recorded();
    delete source.report!.canonical;
    const log = new ChangeLog(data);
    log.apply({ job: 'repeated-task', kind: 'skill', action: 'create', target: 'check-source', summary: 'Candidate', reason: 'Repeated requests', evidence: [source.runId] }, [{ file: path.join(root, 'memory/skill-candidates/check-source.md'), text: draft }]);
    const service = new LearningReviewService({ userData: data, root: () => root, log, runs: () => [source] });
    expect(service.evidence(source.runId).run.report?.canonical).toBeUndefined();
    expect(service.evidence(source.runId).reviews).toEqual([]);
    expect(service.state().candidates[0]?.promotionProblems).toContain('missing-verified-example');
  });
});
