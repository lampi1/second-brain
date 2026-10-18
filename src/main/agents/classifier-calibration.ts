// Calibration of the agent classifier's threshold from the user's own confirmed runs, and the store of the thresholds
// the user approved. Why: the threshold decides when the start dialog and agent_catalog say "no agent fits, create one";
// the semantic channel's scale depends on the model (multilingual-e5 puts even unrelated texts at cosine 0.7–1.0, model
// card FAQ), so a fixed number can only be a guess. Every run records how the classifier scored the agent it ran with
// (routing-snapshot.ts); a run the user (or a reviewed piece of evidence) confirmed as a success says "this agent was
// right for this request". The suggested threshold is the split-conformal lower quantile of those scores (Angelopoulos &
// Bates, "A Gentle Introduction to Conformal Prediction", 2021): with n confirmed scores, the ⌊α(n+1)⌋-th smallest keeps
// at least 1−α of future right matches above the line, if future requests resemble past ones. Nothing changes by itself:
// the suggestion waits in the "Da approvare" inbox and only the user's click applies it (ADR 0073, ADR 0074).
// Used by wiring.ts (the classifier reads thresholds(); the IPC handlers in index.ts read and decide).
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import { GENERAL_AGENT_ID } from '../../shared/agents';
import { CALIBRATION_ALPHA, CALIBRATION_MIN_RUNS, DEFAULT_CLASSIFIER_THRESHOLDS, type ClassifierCalibration, type ClassifierDecision, type ClassifierMode } from '../../shared/agent-classifier';

const MODES: readonly ClassifierMode[] = ['hybrid', 'words'];
/** A suggestion closer than this to the threshold in force is not worth asking about. */
export const SUGGEST_MIN_STEP = 5;

/** A run that says "this agent was right for this request": a confirmed success (the user, or reviewed evidence; never
 *  the agent's own report or the Orchestrator's opinion) of a specialist the classifier could pick. */
const confirmed = (r: AgentRun, routable: Set<string>): boolean => !!r.routing && r.routing.mode !== null && r.routing.agentId === r.agentId
  && routable.has(r.agentId) && r.outcome?.verdict === 'success' && (r.outcome.basis === 'human' || r.outcome.basis === 'reviewed-evidence');

/** Split-conformal lower bound: the ⌊α(n+1)⌋-th smallest score (at least the first), so P(next right match ≥ it) ≥ 1−α. */
export function conformalLower(scores: readonly number[], alpha = CALIBRATION_ALPHA): number | null {
  if (!scores.length) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length, Math.max(1, Math.floor(alpha * (sorted.length + 1)))) - 1]!;
}

/** One channel's standing. `approved` = the user's value (absent = default); `dismissed` = a suggestion the user set aside. */
export function calibrate(mode: ClassifierMode, runs: readonly AgentRun[], profiles: readonly AgentProfile[],
  o: { approved?: number; dismissed?: number; alpha?: number; minRuns?: number } = {}): ClassifierCalibration {
  // Generale takes whatever no specialist took: its runs say nothing about the threshold between "fits" and "none fits"
  const routable = new Set(profiles.filter(p => p.status === 'active' && p.routable !== false && p.id !== GENERAL_AGENT_ID).map(p => p.id));
  const rows = runs.filter(r => confirmed(r, routable) && r.routing!.mode === mode);
  // the snapshot leaves score null when the agent scored 0 (unranked): still a right match the classifier missed
  const scores = rows.map(r => r.routing!.score ?? 0);
  const defaultThreshold = DEFAULT_CLASSIFIER_THRESHOLDS[mode], threshold = o.approved ?? defaultThreshold;
  const share = (t: number | null) => t === null || !scores.length ? null : scores.filter(s => s >= t).length / scores.length;
  const suggested = scores.length >= (o.minRuns ?? CALIBRATION_MIN_RUNS) ? conformalLower(scores, o.alpha) : null;
  return {
    mode, threshold, defaultThreshold, approved: o.approved ?? null, n: scores.length,
    rank1: rows.length ? rows.filter(r => r.routing!.rank === 1).length / rows.length : null,
    coverageNow: share(threshold), coverageSuggested: share(suggested), suggested,
    pending: suggested !== null && Math.abs(suggested - threshold) >= SUGGEST_MIN_STEP && o.dismissed !== suggested,
  };
}

interface Saved { thresholds: Partial<Record<ClassifierMode, number>>; dismissed: Partial<Record<ClassifierMode, number>> }
const score = (v: unknown): number | undefined => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100 ? v : undefined;
const pick = (o: unknown): Partial<Record<ClassifierMode, number>> => {
  const src = o && typeof o === 'object' ? o as Record<string, unknown> : {};
  return Object.fromEntries(MODES.flatMap(m => { const v = score(src[m]); return v === undefined ? [] : [[m, v]]; }));
};

/** The thresholds the user approved and the suggestions they dismissed: userData/agent-classifier.json. A missing or
 *  broken file = defaults (the classifier keeps working). Written only by decide(), i.e. by a user's click. */
export class ClassifierTuning {
  private saved: Saved;
  constructor(private file: string | null, private source: () => { runs: readonly AgentRun[]; profiles: readonly AgentProfile[] }) {
    let raw: Record<string, unknown> = {};
    if (file) try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { /* first start or broken: defaults */ }
    this.saved = { thresholds: pick(raw.thresholds), dismissed: pick(raw.dismissed) };
  }

  /** The thresholds in force, per channel. */
  thresholds(): Record<ClassifierMode, number> {
    return { hybrid: this.saved.thresholds.hybrid ?? DEFAULT_CLASSIFIER_THRESHOLDS.hybrid, words: this.saved.thresholds.words ?? DEFAULT_CLASSIFIER_THRESHOLDS.words };
  }

  read(): ClassifierCalibration[] {
    const { runs, profiles } = this.source();
    return MODES.map(m => calibrate(m, runs, profiles, { approved: this.saved.thresholds[m], dismissed: this.saved.dismissed[m] }));
  }

  /** The user's decision. apply/dismiss name the value they saw: a suggestion that moved since is refused (read again). */
  decide(d: ClassifierDecision): ClassifierCalibration[] {
    if (!d || typeof d !== 'object' || !MODES.includes(d.mode)) throw new Error('classifier: mode hybrid | words');
    if (d.decision === 'reset') delete this.saved.thresholds[d.mode];
    else {
      const value = score(d.value);
      if (value === undefined || (d.decision !== 'apply' && d.decision !== 'dismiss')) throw new Error('classifier: decision apply | dismiss | reset, value 1–100');
      const now = this.read().find(c => c.mode === d.mode)!;
      // undo of an apply sends the previous value back: allowed whatever the suggestion says now
      if (d.decision === 'dismiss' && now.suggested !== value) throw new Error('classifier: the suggestion changed, read it again');
      if (d.decision === 'apply') this.saved.thresholds[d.mode] = value; else this.saved.dismissed[d.mode] = value;
    }
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.saved, null, 2));
    }
    return this.read();
  }
}
