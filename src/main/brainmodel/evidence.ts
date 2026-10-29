// The evidence layer (ADR 0109, the rest of ADR 0104 and of move 12 of the 2026-10-20 analysis): every change in the
// brain's change log is a hypothesis with one metric, the user's corrections per run (frequent, and the user's own word,
// never a model's), measured on the runs of the roles it touches. The scope is sealed when the change is made (`seal`);
// the baseline is frozen (the newest 40 runs that ended before it); the runs after it count until it is undone. A verdict
// only at the fixed checkpoints of shared/evidence-stats.ts (20, 40, 80, 160 runs a side, against peeking), with a seeded
// 90% bootstrap interval of the difference: «aiuta» (the interval below zero), «peggiora» (above zero, shown with its
// Annulla, never undone silently), «nessun effetto» (inside ± a quarter of the baseline, at least 0.1, or still
// undecided after 160 runs), else «in raccolta». Changes that overlap share runs: a verdict is about the period, not a
// proof of one cause (said on the page). Pure; used by brainmodel/service.ts; tests: test/unit/brainmodel/evidence.test.ts.
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { BrainChange, ChangeClaim, ClaimSide, ClaimVerdict, LearningLessons, LearningRole, LearningState, LessonStub } from '../../shared/brain-model';
import { atCheckpoint, bootstrapDiff, CHECKPOINTS, verdictOf } from '../../shared/evidence-stats';
import { portableId } from '../agents/pack/flows';

/** What a change is measured on, sealed when it is made (the roles may change later; the claim does not follow them). */
/** baselineSkill: the baseline is the runs that loaded the skill too (it existed before: an update, a merge) */
export interface ClaimSeed { hypothesis: ChangeClaim['hypothesis']; scope: string[]; skill: string | null; baselineSkill?: boolean }
type ChangeHead = Pick<BrainChange, 'kind' | 'action' | 'target'>;
type Role = Pick<AgentProfile, 'id' | 'name' | 'skills' | 'knowhow'>;

/** the baseline's newest runs compared (as a trial's, agents/trials.ts) */
export const BASELINE_MAX = 40;
export const WEEK = 7 * 86_400_000;
/** weeks of the Apprendimento curves */
export const WEEKS = 12;

/** The claim's hypothesis, roles and skill for a change about to be recorded. */
export function seal(c: ChangeHead, roles: readonly Role[]): ClaimSeed {
  const hypothesis = c.action === 'create' || c.action === 'update' || c.action === 'link' ? 'fewer' : 'not-more';
  const ids = new Set(roles.map(r => r.id));
  if (c.kind === 'agent') return { hypothesis, scope: ids.has(c.target) ? [c.target] : [], skill: null };
  if (c.kind === 'skill') {
    // a merge's target is «dropped>kept» (jobs.ts mergeSkills): it is measured on the kept skill
    const name = c.action === 'merge' ? c.target.split('>').at(-1)! : c.target;
    const users = roles.filter(r => r.skills.includes(name) || (r.knowhow?.linked ?? []).includes(name)).map(r => r.id);
    // a skill loaded on demand is measured on the runs that loaded it; a removed one on its former users' runs
    if (c.action === 'remove') return { hypothesis, scope: users, skill: null };
    return { hypothesis, scope: users, skill: name, ...(c.action === 'create' ? {} : { baselineSkill: true }) };
  }
  if (c.kind === 'memory') {
    const m = /(?:^|[\\/])agents[\\/]([^\\/]+)[\\/]memory\.md$/.exec(c.target);
    const role = m ? roles.find(r => portableId(r.id) === m[1]) : undefined;
    return { hypothesis, scope: role ? [role.id] : [], skill: null };
  }
  // a rule is read by every role
  return { hypothesis, scope: [], skill: null };
}

const value = (r: AgentRun): number => r.corrections!.tagged + r.corrections!.afterReport;
const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** a stable seed from the change id: the same data, the same interval */
const seedOf = (id: string): number => { let h = 2166136261; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
/** runs that can be measured: chat runs that ended and counted the user's corrections (older ones did not: unknown) */
export const measurable = (runs: readonly AgentRun[]): AgentRun[] => runs.filter(r => r.source !== 'oneshot' && r.endedAt !== undefined && !!r.corrections);

/** A seed read back from brain-changes.json, or undefined when its shape is not one this build wrote. */
export function validSeed(x: unknown): ClaimSeed | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const s = x as Record<string, unknown>;
  if (s.hypothesis !== 'fewer' && s.hypothesis !== 'not-more') return undefined;
  if (!Array.isArray(s.scope) || !s.scope.every(v => typeof v === 'string')) return undefined;
  if (s.skill !== null && typeof s.skill !== 'string') return undefined;
  if (s.baselineSkill !== undefined && typeof s.baselineSkill !== 'boolean') return undefined;
  return { hypothesis: s.hypothesis, scope: [...s.scope as string[]], skill: s.skill as string | null, ...(s.baselineSkill ? { baselineSkill: true } : {}) };
}

/** The bootstrap intervals already drawn: they change only when a side reaches a checkpoint (or its judged runs change),
 *  so a page refresh does not redraw 2000 resamples per change (brainmodel/service.ts keeps one per service). */
export type IntervalCache = Map<string, { low: number; high: number } | null>;

/** The claim of one change from its seed and the runs. */
export function claimOf(c: Pick<BrainChange, 'id' | 'at' | 'rolledBackAt'>, seed: ClaimSeed, runs: readonly AgentRun[], cache?: IntervalCache): ChangeClaim {
  const inScope = (r: AgentRun): boolean => !seed.scope.length || seed.scope.includes(r.agentId);
  const loaded = (r: AgentRun): boolean => !seed.skill || (r.tags?.skills ?? []).includes(seed.skill);
  const pool = measurable(runs).filter(inScope);
  const before = pool.filter(r => r.endedAt! <= c.at && (!seed.baselineSkill || loaded(r))).sort((a, b) => b.endedAt! - a.endedAt!).slice(0, BASELINE_MAX);
  const after = pool.filter(r => r.startedAt >= c.at && (c.rolledBackAt === undefined || r.endedAt! <= c.rolledBackAt)
    && loaded(r)).sort((a, b) => a.endedAt! - b.endedAt!);
  // each side at its checkpoint: the baseline's newest runs, the first runs after the change
  const jb = atCheckpoint(before.length), ja = atCheckpoint(after.length);
  const vb = before.slice(0, jb).map(value), va = after.slice(0, ja).map(value);
  const side = (all: AgentRun[], judged: number[]): ClaimSide => ({ n: all.length, judged: judged.length, mean: mean(judged.length ? judged : all.map(value)) });
  const key = `${c.id}|${jb}|${ja}|${vb.join(',')}|${va.join(',')}`;
  let diff = cache?.get(key);
  if (diff === undefined) {
    diff = jb && ja ? bootstrapDiff(vb, va, { seed: seedOf(c.id) }) : null;
    cache?.set(key, diff);
  }
  const margin = Math.max(0.1, 0.25 * (mean(vb) ?? 0));
  const verdict: ClaimVerdict = c.rolledBackAt !== undefined ? 'annullato' : verdictOf(diff, { before: jb, after: ja }, 'lower', margin);
  return {
    hypothesis: seed.hypothesis, metric: 'corrections', scope: seed.scope, skill: seed.skill,
    before: side(before, vb), after: side(after, va), need: CHECKPOINTS.find(k => k > after.length) ?? null,
    diff: diff ? { low: diff.low, high: diff.high } : null, verdict,
  };
}

/** The lessons proposed from `from` to `now`, by status (ADR 0186: the page shows how few there are, not a trend). */
export function lessonCounts(lessons: readonly LessonStub[], from: number, now: number): LearningLessons {
  const out: LearningLessons = { proposed: 0, approved: 0, discarded: 0, waiting: 0 };
  for (const l of lessons) {
    if (!Number.isFinite(l.createdAt) || l.createdAt < from || l.createdAt > now) continue;
    out.proposed++;
    if (l.status === 'approved') out.approved++; else if (l.status === 'discarded') out.discarded++; else out.waiting++;
  }
  return out;
}

/** The Apprendimento page: the verdict counts and, per role, the weekly corrections per run with the changes on its runs;
 *  `lessons` = the agents' stored lessons (undefined = not read). */
export function learningState(changes: readonly BrainChange[], roles: readonly Role[], runs: readonly AgentRun[], now: number, lessons?: readonly LessonStub[]): LearningState {
  const counts: Record<ClaimVerdict, number> = { raccolta: 0, aiuta: 0, 'nessun-effetto': 0, peggiora: 0, annullato: 0 };
  for (const c of changes) if (c.claim) counts[c.claim.verdict]++;
  const from = now - WEEKS * WEEK, ok = measurable(runs);
  const out: LearningRole[] = roles.map(r => {
    const weeks = Array.from({ length: WEEKS }, (_, i) => ({ start: from + i * WEEK, runs: 0, corrections: 0 }));
    for (const run of ok) {
      if (run.agentId !== r.id || run.endedAt! < from || run.endedAt! > now) continue;
      const w = weeks[Math.min(WEEKS - 1, Math.floor((run.endedAt! - from) / WEEK))]!;
      w.runs++; w.corrections += value(run);
    }
    const mine = changes.filter(c => c.claim && c.at >= from && (!c.claim.scope.length || c.claim.scope.includes(r.id)))
      .sort((a, b) => a.at - b.at).map(c => ({ id: c.id, at: c.at, verdict: c.claim!.verdict, summary: c.summary }));
    return { id: r.id, name: r.name, weeks, changes: mine };
  });
  return { counts, roles: out, from, week: WEEK, ...(lessons ? { lessons: lessonCounts(lessons, from, now) } : {}) };
}
