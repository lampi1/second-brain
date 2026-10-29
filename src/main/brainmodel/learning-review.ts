// Current-brain facade for evaluation and candidate review IPC. Archives are isolated by canonical brain root;
// only explicit replay requests invoke the injected executor, with that root captured for the entire job.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRun } from '../../shared/agents';
import type { LearningEvidence, LearningEvidenceRun, LearningReviewState, ReplayComparison, ReplayRecord, SkillCandidateView } from '../../shared/learning-review';
import type { ChangeLog } from './changes';
import { contentDigest, EvaluationStore, type ReplayExecution } from './evaluation';
import { SkillCandidateService } from './skill-candidates';
import { replayEstimate } from './research-candidate';

export interface LearningReviewDeps {
  userData: string;
  root(): string | null;
  log: ChangeLog;
  runs(): readonly AgentRun[];
  /** Host-verified pending lesson sources; never arbitrary ids supplied by the renderer. */
  lessonSources?(): readonly string[];
  execute?(request: ReplayExecution & { brainRoot: string }): Promise<string>;
  now?(): number;
}
interface Scope { root: string; evaluations: EvaluationStore; candidates: SkillCandidateService }
export class LearningReviewService {
  private scopes = new Map<string, Scope>();
  constructor(private readonly deps: LearningReviewDeps) {}
  private scope(): Scope {
    const chosen = this.deps.root();
    if (!chosen) throw new Error('Select a brain before reviewing learning evidence.');
    const root = fs.realpathSync(chosen), key = process.platform === 'win32' ? root.toLowerCase() : root;
    let scope = this.scopes.get(key);
    if (!scope) {
      const evaluations = new EvaluationStore({ file: path.join(this.deps.userData, 'evaluations', `${contentDigest(key)}.json`), runs: this.deps.runs, now: this.deps.now,
        ...(this.deps.execute ? { execute: (request: ReplayExecution) => this.deps.execute!({ ...request, brainRoot: root }) } : {}) });
      const candidates = new SkillCandidateService({ root, log: this.deps.log, evaluations, runs: this.deps.runs });
      scope = { root, evaluations, candidates }; this.scopes.set(key, scope);
    }
    return scope;
  }
  state(): LearningReviewState {
    if (!this.deps.root()) return { datasets: [], replays: [], candidates: [], replayAvailable: false };
    const s = this.scope();
    return { datasets: s.evaluations.datasets(), replays: s.evaluations.replays(), candidates: s.candidates.list(), replayAvailable: s.evaluations.available() };
  }
  /** Evidence is readable only through this brain's candidate/replay/verified-lesson references. */
  evidence(runId: string): LearningEvidence {
    const s = this.scope(), runs = this.deps.runs();
    const direct = new Set([...s.candidates.list().flatMap(c => c.sourceRunIds), ...s.evaluations.replays().flatMap(r => r.cases.flatMap(c => c.runId ? [c.runId] : [])), ...(this.deps.lessonSources?.() ?? [])]);
    const canonicalRoot = (root: string): string => {
      let full: string; try { full = fs.realpathSync(root); } catch { full = path.resolve(root); }
      return process.platform === 'win32' ? full.toLowerCase() : full;
    };
    const inScope = (run: AgentRun): boolean => !run.scope || canonicalRoot(run.scope.brainRoot) === canonicalRoot(s.root);
    for (const id of direct) {
      const source = runs.find(r => r.runId === id);
      if (source && !inScope(source)) direct.delete(id);
    }
    const isReview = (run: AgentRun): boolean => (run.agentId === 'sentinel' || run.agentId === 'judge') && !!run.reviewOf && direct.has(run.reviewOf);
    const run = runs.find(r => r.runId === runId);
    if (!run || !inScope(run) || !direct.has(runId) && !isReview(run)) throw new Error('Learning evidence is not retained or does not belong to the selected brain.');
    const view = (r: AgentRun): LearningEvidenceRun => ({ runId: r.runId, agentId: r.agentId, goal: r.goal, startedAt: r.startedAt,
      ...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {}), ...(r.reviewOf ? { reviewOf: r.reviewOf } : {}),
      ...(r.outcome ? { outcome: structuredClone(r.outcome) } : {}), ...(r.report ? { report: structuredClone(r.report) } : {}) });
    return { run: view(run), reviews: runs.filter(r => r.reviewOf === runId && isReview(r) && inScope(r)).map(view) };
  }
  import(dataset: unknown): LearningReviewState { this.scope().evaluations.import(dataset); return this.state(); }
  replay(datasetId: string, split: 'tuning' | 'holdout', candidateName?: string): ReplayRecord {
    const s = this.scope();
    return s.evaluations.startReplay(datasetId, split, candidateName ? s.candidates.replayCandidate(candidateName) : undefined);
  }
  saveCandidate(name: string, text: string, expectedDigest: string): SkillCandidateView { return this.scope().candidates.save(name, text, expectedDigest); }
  promote(name: string, expectedDigest: string, replayId: string, exampleRunId: string): SkillCandidateView { return this.scope().candidates.promote(name, expectedDigest, replayId, exampleRunId); }
  compare(beforeId: string, afterId: string): ReplayComparison { return this.scope().evaluations.compare(beforeId, afterId); }
  /** The maintenance's candidate brain (ADR 0195): its replay on the newest anonymized set with holdout cases, only when
   *  the estimate (research-candidate.ts replayEstimate) fits in `budgetUsd`, what the research left of its cap. Never
   *  on the synthetic fixture (not evidence). Returns the replay's id, or why it was skipped (Italian, shown on the card). */
  replayBrainCandidate(c: { name: string; text: string; budgetUsd: number }): { replayId?: string; note: string } {
    if (!this.deps.execute || !this.deps.root()) return { note: 'Replay saltato: in questa app non si può eseguire.' };
    const s = this.scope();
    const set = s.evaluations.datasets().filter(d => d.origin === 'anonymized' && d.cases.some(x => x.split === 'holdout')).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!set) return { note: 'Replay saltato: nessun set di casi anonimizzati con casi di verifica (Apprendimento → Valutazione per importarne uno).' };
    const cases = set.cases.filter(x => x.split === 'holdout').length;
    const estimate = replayEstimate(cases, this.deps.runs(), this.deps.now?.() ?? Date.now());
    if (estimate === null) return { note: 'Replay saltato: nessun lavoro recente con un costo da cui stimarlo.' };
    if (estimate > c.budgetUsd) return { note: `Replay saltato: ${cases} casi costerebbero circa ${estimate.toFixed(2)} $, restano ${c.budgetUsd.toFixed(2)} $ del tetto della manutenzione.` };
    const r = s.evaluations.startReplay(set.id, 'holdout', { name: c.name, text: c.text, digest: contentDigest(c.text) });
    return { replayId: r.id, note: `Replay avviato su ${cases} casi di «${set.name}» (stima ${estimate.toFixed(2)} $): l'esito arriva in Apprendimento.` };
  }
  /** A replay's state now, null when gone or no brain. */
  replayStatus(id: string): ReplayRecord['status'] | null {
    if (!this.deps.root()) return null;
    return this.scope().evaluations.replay(id)?.status ?? null;
  }
}
