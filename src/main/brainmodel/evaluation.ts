// Recorded task replay and held-out evaluation for the learning page. Inputs never carry outcomes: quality and
// resource measurements come from the run store. Explicit replay uses an injected app-owned executor; this module
// never starts a provider by itself. Synthetic examples exercise the workflow, never qualify a skill for promotion.
import { createHash, randomUUID } from 'node:crypto';
import type { AgentRun } from '../../shared/agents';
import type { EvaluationCase, EvaluationDataset, EvaluationMeasure, EvaluationSummary, ReplayComparison, ReplayRecord } from '../../shared/learning-review';
import type { WorkRoleId } from '../../shared/roles';
import { verifiedVerdict } from '../../shared/run-verdict';
import { readLocal, writeLocal } from '../agents/local-store';

export const contentDigest = (text: string): string => createHash('sha256').update(text).digest('hex');
const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected an object.');
  return v as Record<string, unknown>;
};
const keys = (v: Record<string, unknown>, allowed: string[]) => { if (Object.keys(v).some(k => !allowed.includes(k))) throw new Error('Unsupported field: imported cases cannot supply outcomes or execution evidence.'); };
const text = (v: unknown, max: number): string => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('Invalid or oversized text.'); return v.trim(); };
const id = (v: unknown): string => { const s = text(v, 80); if (!ID.test(s)) throw new Error('Invalid identifier.'); return s; };
const privateText = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_]{12,}|-----BEGIN .*PRIVATE KEY-----/i;

/** Explicitly anonymized inputs only. The attestation is not a claim that automated PII detection is exhaustive. */
export function importEvaluationDataset(raw: unknown, now: number): EvaluationDataset {
  const v = obj(raw); keys(v, ['id', 'name', 'anonymized', 'cases']);
  if (v.anonymized !== true) throw new Error('Confirm that task inputs are anonymized before importing.');
  if (!Array.isArray(v.cases) || v.cases.length < 2 || v.cases.length > 100) throw new Error('Import 2–100 cases with separate tuning and holdout cases.');
  const seen = new Set<string>(), familySplit = new Map<string, string>(), inputSplit = new Map<string, string>();
  const cases: EvaluationCase[] = v.cases.map(rawCase => {
    const c = obj(rawCase); keys(c, ['id', 'family', 'input', 'criteria', 'split']);
    const caseId = id(c.id), family = id(c.family), input = text(c.input, 6000);
    if (seen.has(caseId)) throw new Error('Duplicate case id.'); seen.add(caseId);
    if (c.split !== 'tuning' && c.split !== 'holdout') throw new Error('Each case needs an explicit tuning/holdout split.');
    if (!Array.isArray(c.criteria) || !c.criteria.length || c.criteria.length > 12) throw new Error('Each case needs 1–12 checkable criteria.');
    const criteria = c.criteria.map(x => { if (typeof x !== 'string' || x.length > 300) throw new Error('Replay criteria must be text of at most 300 characters.'); return text(x, 300); });
    if (new Set(criteria).size !== criteria.length) throw new Error('Repeated criterion.');
    if (privateText.test([input, ...criteria].join('\n'))) throw new Error('Potential identifying data or credential: anonymize it before importing.');
    const digest = contentDigest(input.toLowerCase().replace(/\s+/g, ' '));
    if (familySplit.has(family) && familySplit.get(family) !== c.split || inputSplit.has(digest) && inputSplit.get(digest) !== c.split) throw new Error('Tuning/holdout leakage: related or duplicate cases must stay in one split.');
    familySplit.set(family, c.split); inputSplit.set(digest, c.split);
    return { id: caseId, family, input, criteria, split: c.split };
  });
  if (!cases.some(c => c.split === 'holdout') || !cases.some(c => c.split === 'tuning')) throw new Error('Both tuning and holdout cases are required.');
  const name = text(v.name, 120);
  if (privateText.test(name)) throw new Error('Anonymize the dataset name.');
  return { id: id(v.id), name, origin: 'anonymized', anonymized: true, cases, digest: contentDigest(JSON.stringify(cases)), createdAt: now };
}

/** Clearly synthetic fixture: no user's history or performance claim. Families never cross the split. */
export function syntheticEvaluationDataset(): EvaluationDataset {
  const dataset = importEvaluationDataset({ id: 'synthetic-workflow-v1', name: 'Synthetic workflow examples — not real performance evidence', anonymized: true, cases: [
    { id: 'summary', family: 'summaries', input: 'Synthetic note: project ALPHA ships two fixes and one new export. Summarize only this note.', criteria: ['Names two fixes and one export without inventing details'], split: 'tuning' },
    { id: 'update', family: 'updates', input: 'Synthetic instruction: use branch main. Earlier instruction said develop. State the current branch and identify the superseded instruction.', criteria: ['Current branch is main', 'Earlier develop instruction is superseded'], split: 'holdout' },
    { id: 'continuation', family: 'task-continuity', input: 'Synthetic event log: one Scout conversation has assignment r1 then a neutral follow-up r2 and an explicit correction r3. Identify execution count, conversation count, and which run is rework.', criteria: ['Counts three executions in one conversation', 'Only the explicit correction r3 is rework'], split: 'holdout' },
    { id: 'delivery', family: 'display-deduplication', input: 'Synthetic delivery log: result r1 is posted, app restarts, same result r1 is restored twice. Policy display. State visible unique result count and required additional inference submissions.', criteria: ['One unique visible result', 'Zero additional inference submissions for display'], split: 'holdout' },
    { id: 'scope', family: 'memory-isolation', input: 'Synthetic memories: project A uses branch main, project B uses release. A revoked note says A uses develop. Asked for B current branch, answer only using B evidence.', criteria: ['Answers release for project B', 'Does not use revoked or other-project evidence'], split: 'holdout' },
    { id: 'abstain', family: 'missing-source', input: 'Synthetic task: report the release date. No release date or source is provided.', criteria: ['States that the date is unknown rather than guessing'], split: 'holdout' },
  ] }, 0);
  return { ...dataset, origin: 'synthetic' };
}

export interface ReplayCandidate { name: string; text: string; digest: string; roleId?: WorkRoleId }
export interface ReplayExecution { replayId: string; test: EvaluationCase; candidate?: ReplayCandidate }
export interface EvaluationDeps {
  file: string;
  runs(): readonly AgentRun[];
  /** Trusted app adapter. Explicit user action only; creates a fresh run with the supplied criteria and awaits it. */
  execute?(request: ReplayExecution): Promise<string>;
  now?(): number;
}
interface State { version: 1; datasets: EvaluationDataset[]; replays: ReplayRecord[] }
const failure = (e: unknown) => e instanceof Error ? e.message.slice(0, 400) : 'Replay execution failed.';

export class EvaluationStore {
  private data: State;
  private active = false;
  private readonly now: () => number;
  constructor(private readonly deps: EvaluationDeps) {
    this.now = deps.now ?? Date.now;
    const saved = readLocal(deps.file) as State | undefined;
    if (saved && (saved.version !== 1 || !Array.isArray(saved.datasets) || !Array.isArray(saved.replays))) throw new Error('Invalid evaluation archive; original preserved.');
    this.data = saved ?? { version: 1, datasets: [syntheticEvaluationDataset()], replays: [] };
    // A process interruption cannot become a passing replay or silently restart paid work.
    for (const r of this.data.replays) if (r.status === 'running') {
      r.finishedAt = this.now(); r.status = 'failed';
      for (const c of r.cases) if (!c.runId) { c.error = 'Replay interrupted; explicitly start a new replay.'; c.passed = false; }
    }
  }
  private save(): void { writeLocal(this.deps.file, this.data); }
  available(): boolean { return !!this.deps.execute; }
  datasets(): EvaluationDataset[] { return structuredClone(this.data.datasets); }
  import(raw: unknown): EvaluationDataset {
    const dataset = importEvaluationDataset(raw, this.now());
    if (this.data.datasets.some(d => d.id === dataset.id)) throw new Error('Dataset id already exists; use a new version id.');
    const syntheticInputs = new Set(this.data.datasets.filter(d => d.origin === 'synthetic').flatMap(d => d.cases.map(c => contentDigest(c.input))));
    if (dataset.cases.some(c => syntheticInputs.has(contentDigest(c.input)))) throw new Error('Known synthetic fixtures cannot be relabeled as imported real examples.');
    // A family or duplicate input cannot move between tuning and holdout across dataset versions either.
    for (const c of dataset.cases) for (const d of this.data.datasets) {
      if (d.cases.some(old => old.split !== c.split && (old.family === c.family || contentDigest(old.input.toLowerCase().replace(/\s+/g, ' ')) === contentDigest(c.input.toLowerCase().replace(/\s+/g, ' '))))) throw new Error('Tuning/holdout leakage across dataset versions.');
    }
    if (this.data.datasets.length >= 40) throw new Error('Evaluation dataset limit reached.');
    this.data.datasets.push(dataset);
    try { this.save(); } catch (e) { this.data.datasets.pop(); throw e; }
    return structuredClone(dataset);
  }
  private refresh(r: ReplayRecord): void {
    const dataset = this.data.datasets.find(d => d.id === r.datasetId && d.digest === r.datasetDigest);
    const runs = this.deps.runs();
    for (const c of r.cases) {
      if (!c.runId || c.error) continue;
      const run = runs.find(v => v.runId === c.runId), test = dataset?.cases.find(v => v.id === c.caseId);
      const verdict = run ? verifiedVerdict(run, [], this.now()) : null;
      const result = run?.report?.canonical;
      c.passed = !run || !test || !verdict || run.endedAt === undefined ? null : verdict.verdict === 'success' && !!result && test.criteria.every(criterion => result.doneWhen.some(d => d.criterion === criterion && d.met));
    }
    if (r.finishedAt !== undefined) r.status = r.cases.some(c => c.passed === false) ? 'failed' : r.cases.every(c => c.passed === true) ? 'passed' : 'awaiting-review';
  }
  replays(): ReplayRecord[] { for (const r of this.data.replays) this.refresh(r); return structuredClone(this.data.replays); }
  replay(id: string): ReplayRecord | undefined { return this.replays().find(r => r.id === id); }
  /** Returns immediately; app state polling follows execution and independent review. No automatic retries. */
  startReplay(datasetId: string, split: 'tuning' | 'holdout', candidate?: ReplayCandidate): ReplayRecord {
    if (!this.deps.execute) throw new Error('Replay execution is unavailable: configure the app replay executor.');
    if (this.active) throw new Error('A replay is already running.');
    if (split !== 'tuning' && split !== 'holdout') throw new Error('Invalid evaluation split.');
    const dataset = this.data.datasets.find(d => d.id === datasetId);
    if (!dataset) throw new Error('Unknown evaluation dataset.');
    if (candidate && (candidate.digest !== contentDigest(candidate.text) || !ID.test(candidate.name))) throw new Error('Candidate digest mismatch.');
    if (this.data.replays.length >= 200) throw new Error('Replay archive limit reached.');
    const cases = dataset.cases.filter(c => c.split === split);
    const r: ReplayRecord = { id: randomUUID(), datasetId, datasetDigest: dataset.digest, split, ...(candidate ? { candidate: { name: candidate.name, digest: candidate.digest } } : {}), startedAt: this.now(), status: 'running', cases: cases.map(c => ({ caseId: c.id, passed: null })) };
    this.data.replays.push(r);
    try { this.save(); } catch (e) { this.data.replays.pop(); throw e; }
    this.active = true;
    void this.execute(r, cases, candidate).finally(() => { this.active = false; });
    return structuredClone(r);
  }
  private async execute(r: ReplayRecord, tests: EvaluationCase[], candidate?: ReplayCandidate): Promise<void> {
    const seen = new Set(this.deps.runs().map(run => run.runId));
    try {
      for (const test of tests) {
        const c = r.cases.find(v => v.caseId === test.id)!;
        try {
          const runId = await this.deps.execute!({ replayId: r.id, test: structuredClone(test), ...(candidate ? { candidate: structuredClone(candidate) } : {}) });
          const run = this.deps.runs().find(v => v.runId === runId);
          if (!run || seen.has(runId) || run.startedAt < r.startedAt) throw new Error('Replay executor must return a fresh recorded run for each case.');
          seen.add(runId); c.runId = runId;
        } catch (e) { c.error = failure(e); c.passed = false; }
        this.save();
      }
      r.finishedAt = this.now(); this.refresh(r); this.save();
    } catch { r.status = 'failed'; r.finishedAt = this.now(); }
  }
  /** Gate rechecks current independent outcomes, so revoked evidence cannot keep a candidate eligible. */
  eligibleReplay(id: string, candidate: { name: string; digest: string }): boolean {
    const r = this.replay(id), d = this.data.datasets.find(v => v.id === r?.datasetId);
    return !!r && d?.origin === 'anonymized' && r.split === 'holdout' && r.status === 'passed' && r.candidate?.name === candidate.name && r.candidate.digest === candidate.digest && r.cases.length > 0;
  }
  compare(beforeId: string, afterId: string): ReplayComparison {
    const before = this.replay(beforeId), after = this.replay(afterId);
    if (!before || !after) throw new Error('Unknown replay.');
    const comparable = before.datasetDigest === after.datasetDigest && before.split === after.split;
    const runs = this.deps.runs(), retained = new Set(runs.map(r => r.runId));
    const common = new Set(comparable ? before.cases.filter(c => c.runId && retained.has(c.runId) && after.cases.some(a => a.caseId === c.caseId && a.runId && retained.has(a.runId))).map(c => c.caseId) : []);
    const selected = (r: ReplayRecord) => r.cases.filter(c => common.has(c.caseId)).flatMap(c => { const run = runs.find(v => v.runId === c.runId); return run ? [run] : []; });
    return { before: evaluationSummary(selected(before), runs), after: evaluationSummary(selected(after), runs), pairedCases: common.size, comparable,
      note: 'matched-retained-descriptive' };
  }
}

/** Mean per task with known-data counts; unknown is never inferred as zero. */
export function evaluationSummary(runs: readonly AgentRun[], allRuns: readonly AgentRun[] = runs): EvaluationSummary {
  const work = (root: AgentRun): AgentRun[] => {
    const ids = new Set([root.runId]);
    let changed = true;
    while (changed) { changed = false; for (const r of allRuns) if (r.parentRunId && ids.has(r.parentRunId) && !r.reviewOf && !ids.has(r.runId)) { ids.add(r.runId); changed = true; } }
    return [root, ...allRuns.filter(r => r.runId !== root.runId && ids.has(r.runId))];
  };
  const taskTotal = (root: AgentRun, value: (run: AgentRun) => number | null | undefined): number | null => {
    const values = work(root).map(value);
    return values.every((v): v is number => typeof v === 'number' && Number.isFinite(v)) ? values.reduce((a, b) => a + b, 0) : null;
  };
  const measure = (values: (number | null | undefined)[]): EvaluationMeasure => { const known = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)); return { value: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null, n: known.length, total: runs.length }; };
  return { tasks: runs.length, quality: measure(runs.map(r => { const v = verifiedVerdict(r, [], 0); return v ? (v.verdict === 'success' ? 1 : 0) : null; })),
    turns: measure(runs.map(r => taskTotal(r, v => v.turns))), costUsd: measure(runs.map(r => taskTotal(r, v => v.costUsd))), elapsedMs: measure(runs.map(r => r.endedAt === undefined ? null : r.endedAt - r.startedAt)),
    tokens: { input: measure(runs.map(r => taskTotal(r, v => v.tokens?.input))), output: measure(runs.map(r => taskTotal(r, v => v.tokens?.output))), cacheRead: measure(runs.map(r => taskTotal(r, v => v.tokens?.cacheRead))), cacheWrite: measure(runs.map(r => taskTotal(r, v => v.tokens?.cacheWrite))) } };
}
