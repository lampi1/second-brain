// The steps of a plan (ADR 0359): what each is, its true state, what it waits for, what it touches. Dependencies are explicit
// (`after`), so a step starts as soon as its own ones ended and everything else runs beside it: the turns the user sees, what may
// start now, what would write on the same things, the percentage and the time in a row or in parallel all come from here.
// A step is «fatto» only with a proof: a chat's report, the Strategist's own words on what it did and how it knows, or the user's. Nothing
// else moves a step: a plan closed, a chat lost or a save that leaves it out changes no state. Pure: used by shared/strategy.ts,
// shared/plan.ts, main (chats, delegation, plans) and the renderer; pinned by test/unit/shared/plan-steps.test.ts.
import type { DelegationOutcome } from './delegation';
import { isPresetId, type PresetId } from './model-presets';
import { isWorkRole, type WorkRoleId } from './roles';

/** todo = da fare · now = in corso · blocked = bloccato · partial = fatto in parte · done = fatto (with its proof) ·
 *  cancelled = annullato · check = da verificare: it was called done, and nothing readable proves it */
export type StepState = 'todo' | 'now' | 'blocked' | 'partial' | 'done' | 'cancelled' | 'check';
export const STEP_STATES: readonly StepState[] = ['todo', 'now', 'blocked', 'partial', 'done', 'cancelled', 'check'];
/** Why a step is «fatto»: whose word it is and what it says. */
export interface StepProof { at: number; by: 'report' | 'strategist' | 'user'; text: string; chatId?: string }

export interface PlanStep {
  /** stable within its plan: dependencies, edits and the history name it, whatever its place */
  id: string;
  title: string;
  /** optional: one short line on what the step covers */
  detail?: string;
  /** the role that does it (absent: the Strategist itself) */
  role?: WorkRoleId;
  state: StepState;
  proof?: StepProof;
  /** the chats delegated for it (agent_delegate with this step) */
  chatIds?: string[];
  startedAt?: number;
  endedAt?: number;
  /** the ids of the steps it waits for; none = it starts at once */
  after?: string[];
  /** what it writes or holds alone: files, folders, a test node («env:test1»). Two steps that may run together never share one */
  touches?: string[];
  /** how long it should take, in minutes */
  minutes?: number;
  /** added while the plan was under way: the user approved the plan without it */
  added?: true;
  /** the role card's preset the step runs on (ADR 0336); never a model (ADR 0346) */
  preset?: PresetId;
  /** a replan takes this started step away (ADR 0342): it goes on until the user approves, then its chats stop */
  drop?: true;
}

export const STEP_TITLE_MAX = 160, STEP_DETAIL_MAX = 1200, STEP_PROOF_MAX = 600, TOUCHES_MAX = 12, TOUCH_LEN = 160, STEP_CHATS_MAX = 10;
export const STEP_ID = /^s\d{1,5}$/;
/** a plan holds at most this many steps */
export const STEPS_ALL_MAX = 400;

/** It ended: what waits for it may start. Blocked has not. */
export const ended = (s: Pick<PlanStep, 'state'>): boolean => s.state === 'done' || s.state === 'partial' || s.state === 'cancelled';
/** It began, whatever came of it. */
export const begun = (s: Pick<PlanStep, 'state'>): boolean => s.state !== 'todo';
export const stepState = (o: DelegationOutcome): StepState => (o === 'done' ? 'done' : o === 'partial' ? 'partial' : 'blocked');

/** A free step id of these steps. */
export function nextStepId(steps: readonly Pick<PlanStep, 'id'>[]): string {
  return `s${Math.max(0, ...steps.map(s => Number(s.id.slice(1)) || 0)) + 1}`;
}

/** The ids a step waits for, those that exist only. */
const waits = (s: Pick<PlanStep, 'after'>, ids: ReadonlySet<string>): string[] => (s.after ?? []).filter(id => ids.has(id));

/** Each step's turn, from 1: one more than the last it waits for. Steps of one turn may run together. A circle (a broken file)
 *  counts as no dependency. */
export function turnsOf(steps: readonly Pick<PlanStep, 'id' | 'after'>[]): number[] {
  const ids = new Set(steps.map(s => s.id)), by = new Map(steps.map(s => [s.id, s])), done = new Map<string, number>(), open = new Set<string>();
  const turn = (id: string): number => {
    const known = done.get(id);
    if (known !== undefined) return known;
    if (open.has(id)) return 0;
    open.add(id);
    const t = 1 + Math.max(0, ...waits(by.get(id)!, ids).map(turn));
    open.delete(id);
    done.set(id, t);
    return t;
  };
  return steps.map(s => turn(s.id));
}

/** A dependency circle, as the steps' numbers; null = none. */
export function circleOf(steps: readonly Pick<PlanStep, 'id' | 'after'>[]): number[] | null {
  const ids = new Set(steps.map(s => s.id)), n = new Map(steps.map((s, i) => [s.id, i + 1])), by = new Map(steps.map(s => [s.id, s]));
  const seen = new Set<string>(), path: string[] = [];
  const walk = (id: string): number[] | null => {
    const at = path.indexOf(id);
    if (at >= 0) return path.slice(at).map(x => n.get(x)!);
    if (seen.has(id)) return null;
    path.push(id);
    for (const w of waits(by.get(id)!, ids)) { const c = walk(w); if (c) return c; }
    path.pop();
    seen.add(id);
    return null;
  };
  for (const s of steps) { const c = walk(s.id); if (c) return c; }
  return null;
}

/** Every step a step waits for, at any depth. */
function ancestors(steps: readonly Pick<PlanStep, 'id' | 'after'>[]): Map<string, Set<string>> {
  const ids = new Set(steps.map(s => s.id)), by = new Map(steps.map(s => [s.id, s])), out = new Map<string, Set<string>>();
  const of = (id: string): Set<string> => {
    const known = out.get(id);
    if (known) return known;
    const set = new Set<string>();
    out.set(id, set);
    for (const w of waits(by.get(id)!, ids)) { set.add(w); for (const x of of(w)) set.add(x); }
    return set;
  };
  for (const s of steps) of(s.id);
  return out;
}

/** Whether two of them may run at the same time. */
export function together(steps: readonly Pick<PlanStep, 'id' | 'after'>[], a: string, b: string): boolean {
  const up = ancestors(steps);
  return a !== b && !up.get(a)?.has(b) && !up.get(b)?.has(a);
}

const key = (t: string): string => t.trim().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
/** Two touched things are the same, or one is inside the other (a folder and a file of it). */
export function overlap(a: string, b: string): boolean {
  const x = key(a), y = key(b);
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}
/** The steps that may run together and touch the same thing: numbers and what they share. */
export function clashes(steps: readonly PlanStep[]): { a: number; b: number; on: string }[] {
  const up = ancestors(steps), out: { a: number; b: number; on: string }[] = [];
  steps.forEach((s, i) => steps.slice(i + 1).forEach((t, k) => {
    if (s.drop || t.drop || ended(s) || ended(t) || up.get(s.id)?.has(t.id) || up.get(t.id)?.has(s.id)) return;
    const on = (s.touches ?? []).find(x => (t.touches ?? []).some(y => overlap(x, y)));
    if (on) out.push({ a: i + 1, b: i + k + 2, on });
  }));
  return out;
}

/** The steps a step still waits for, as numbers; none = it may start now. */
export function waitingFor(steps: readonly PlanStep[], i: number): number[] {
  const ids = new Set(steps.map(s => s.id));
  return waits(steps[i]!, ids).map(id => steps.findIndex(s => s.id === id)).filter(k => !ended(steps[k]!) && !steps[k]!.drop).map(k => k + 1);
}
/** The steps to do that may start now, 0-based. */
export function readySteps(steps: readonly PlanStep[]): number[] {
  return steps.flatMap((s, i) => (s.state === 'todo' && !s.drop && !waitingFor(steps, i).length ? [i] : []));
}
/** The steps that start as soon as step i ends, as numbers. */
export function opens(steps: readonly PlanStep[], i: number): number[] {
  const id = steps[i]!.id;
  return steps.flatMap((s, k) => (s.state === 'todo' && s.after?.includes(id) && waitingFor(steps, k).every(n => n === i + 1) ? [k + 1] : []));
}

/** What counts of a plan: its steps but the cancelled and the ones a replan takes away. */
const counted = (steps: readonly PlanStep[]): PlanStep[] => steps.filter(s => s.state !== 'cancelled' && !s.drop);
/** How far it is: done of how many, and the share done, 0-100. A step done in part counts half; one to verify counts nothing. */
export function progressOf(steps: readonly PlanStep[]): { done: number; total: number; percent: number } {
  const all = counted(steps), done = all.filter(s => s.state === 'done').length, part = all.filter(s => s.state === 'partial').length;
  const share = all.length ? (done + part / 2) / all.length : 0;
  // 100 only when everything is done
  return { done, total: all.length, percent: done === all.length && all.length ? 100 : Math.min(99, Math.floor(share * 100)) };
}
export interface PlanTimeEstimate {
  /** Total estimated minutes sequentially and in parallel across steps with estimates. */
  row: number;
  parallel: number;
  /** Remaining estimated minutes (non-ended steps), present when some steps have already ended. */
  remainingRow?: number;
  remainingParallel?: number;
  /** Count of remaining (or total if none remaining) steps missing an estimate. */
  unknown?: number;
}
/** Estimated minutes sequentially and in parallel; tolerant of steps without `minutes` (returns null only if no step has an estimate). */
export function timeOf(steps: readonly PlanStep[]): PlanTimeEstimate | null {
  const all = counted(steps);
  if (!all.length || !all.some(s => (s.minutes ?? 0) > 0)) return null;
  const compute = (list: readonly PlanStep[]): { row: number; parallel: number } => {
    const ids = new Set(list.map(s => s.id)), by = new Map(list.map(s => [s.id, s])), end = new Map<string, number>();
    const endOf = (id: string, seen: ReadonlySet<string>): number => {
      const known = end.get(id);
      if (known !== undefined) return known;
      if (seen.has(id)) return 0;
      const next = new Set(seen).add(id);
      const t = (by.get(id)?.minutes ?? 0) + Math.max(0, ...waits(by.get(id)!, ids).map(w => endOf(w, next)));
      end.set(id, t);
      return t;
    };
    const row = list.reduce((n, s) => n + (s.minutes ?? 0), 0);
    const parallel = list.length ? Math.max(...list.map(s => endOf(s.id, new Set()))) : 0;
    return { row, parallel };
  };
  const total = compute(all);
  const open = all.filter(s => !ended(s));
  const hasEnded = open.length < all.length;
  const unknown = (open.length ? open : all).filter(s => !s.minutes).length;
  const rem = hasEnded ? compute(open) : null;
  return {
    ...total,
    ...(rem ? { remainingRow: rem.row, remainingParallel: rem.parallel } : {}),
    ...(unknown > 0 ? { unknown } : {}),
  };
}

// ---- reading a saved step, the one of before ADR 0359 included: `par` (it shares the turn of the step before it) becomes the
// dependencies it meant, «done» without a proof is «da verificare», a partial or blocked result is its own state.

const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const time = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
const CHAT = /^[\w-]{1,80}$/;

export function readProof(v: unknown): StepProof | null {
  const p = v as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || !time(p.at) || !text(p.text, STEP_PROOF_MAX) || !['report', 'strategist', 'user'].includes(String(p.by))) return null;
  return { at: p.at, by: p.by as StepProof['by'], text: p.text, ...(typeof p.chatId === 'string' && CHAT.test(p.chatId) ? { chatId: p.chatId } : {}) };
}

/** Saved steps, checked; null = not a list of steps (nothing is guessed). What is not understood inside one is left out. */
export function readSteps(v: unknown): PlanStep[] | null {
  if (!Array.isArray(v) || v.length > STEPS_ALL_MAX) return null;
  const raw = v as Record<string, unknown>[];
  if (!raw.every(s => s && typeof s === 'object' && text(s.title, STEP_TITLE_MAX) && (s.detail === undefined || text(s.detail, STEP_DETAIL_MAX)) && (s.role === undefined || isWorkRole(s.role)) && (s.chatIds === undefined || (Array.isArray(s.chatIds) && s.chatIds.every(x => typeof x === 'string' && CHAT.test(x)))) && STEP_STATES.includes(s.state as StepState))) return null;
  const out: PlanStep[] = [];
  let turn: string[] = [], before: string[] = [];
  for (const [i, s] of raw.entries()) {
    const id = typeof s.id === 'string' && STEP_ID.test(s.id) && !out.some(x => x.id === s.id) ? s.id : nextStepId([...out, ...raw.slice(i + 1).flatMap(x => (typeof x.id === 'string' && STEP_ID.test(x.id) ? [{ id: x.id }] : []))]);
    if (s.par === true && i > 0) turn.push(id); else { before = turn; turn = [id]; }
    const after = Array.isArray(s.after) ? [...new Set(s.after.filter((x): x is string => typeof x === 'string' && STEP_ID.test(x) && x !== id))] : typeof s.id === 'string' ? [] : before;
    const proof = readProof(s.proof);
    let state = s.state as StepState;
    if (state === 'done' && s.outcome === 'partial') state = 'partial';
    else if (state === 'done' && s.outcome === 'blocked') state = 'blocked';
    else if (state === 'done' && !proof) state = 'check';
    out.push({ id, title: (s.title as string).trim(), ...(text(s.detail, STEP_DETAIL_MAX) ? { detail: s.detail } : {}), ...(isWorkRole(s.role) ? { role: s.role } : {}), state, ...(proof ? { proof } : {}),
      ...(Array.isArray(s.chatIds) && s.chatIds.length ? { chatIds: s.chatIds.filter((x): x is string => typeof x === 'string' && CHAT.test(x)).slice(-STEP_CHATS_MAX) } : {}),
      ...(time(s.startedAt) ? { startedAt: s.startedAt } : {}), ...(time(s.endedAt) ? { endedAt: s.endedAt } : {}), ...(after.length ? { after } : {}),
      ...(Array.isArray(s.touches) && s.touches.length ? { touches: s.touches.filter((x): x is string => text(x, TOUCH_LEN)).slice(0, TOUCHES_MAX) } : {}),
      ...(time(s.minutes) ? { minutes: s.minutes } : {}), ...(s.added === true ? { added: true as const } : {}), ...(isPresetId(s.preset) ? { preset: s.preset } : {}), ...(s.drop === true ? { drop: true as const } : {}) });
  }
  return out;
}

/** Steps to verify that a chat's report proves now (a plan saved before ADR 0359): «fatto» with that report, or «fatto in
 *  parte». The same steps when nothing is proved. */
export function proved(steps: readonly PlanStep[], report: (chatId: string) => { outcome: DelegationOutcome; summary: string; at: number } | null): PlanStep[] {
  return steps.map(s => {
    if (s.state !== 'check' || !s.chatIds?.length) return s;
    const all = s.chatIds.map(report);
    if (all.some(r => !r)) return s;
    const last = all[all.length - 1]!, outcome = all.some(r => r!.outcome === 'blocked') ? 'blocked' : all.some(r => r!.outcome === 'partial') ? 'partial' : 'done';
    return { ...s, state: stepState(outcome), proof: { at: last.at, by: 'report' as const, text: last.summary.slice(0, STEP_PROOF_MAX), chatId: s.chatIds[s.chatIds.length - 1]! } };
  });
}
