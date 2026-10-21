// A Strategist's plan with the user (ADR 0108): before planning it asks the user what they really want, one question at
// a time ("grill-me", its engine's own question tool); then it proposes a short plan of plain steps (plan_propose) that
// the user approves or changes on its strip; once approved it delegates each step (agent_delegate's `step`) and the
// strip shows the steps as a checklist, Claude Code style. This file holds the plan a Strategist root chat carries
// (ChatSummary.plan, persisted with the chat), the checks of a proposed plan, the step changes that delegation and
// results make, and the app's fixed text that tells the Strategist this flow. Pure: used by main/chats/manager.ts,
// main/agents/strategy-tools.ts, main/agents/delegation.ts and the renderer (StrategyPanel.tsx).
import { isWorkRole, type WorkRoleId } from './roles';
import type { DelegationOutcome } from './delegation';

/** asking = it questions the user · proposed = the plan waits for the user's ok · revising = the user asked for changes ·
 *  running = approved, steps under way · done = every step done */
export type PlanPhase = 'asking' | 'proposed' | 'revising' | 'running' | 'done';
export type StepState = 'todo' | 'now' | 'done' | 'blocked';
export const STEP_STATES: readonly StepState[] = ['todo', 'now', 'done', 'blocked'];
export interface PlanStep {
  title: string;
  /** the role that does it (absent: the Strategist itself) */
  role?: WorkRoleId;
  state: StepState;
  /** Result quality is separate from execution progress: a partial report still finishes the work. */
  outcome?: DelegationOutcome;
  /** the chats delegated for it (agent_delegate with this step) */
  chatIds?: string[];
  startedAt?: number;
  endedAt?: number;
}
/** One answer the user gave while it asked: what was asked (the question's short header, else the question) and the answer. */
export interface Clarified { q: string; a: string }
export interface StrategyPlan {
  phase: PlanPhase;
  clarified: Clarified[];
  steps: PlanStep[];
  /** when it counts as finished, one line */
  doneWhen?: string;
  /** the last change of phase */
  at: number;
}

export const STEPS_MIN = 1, STEPS_MAX = 8, STEP_TITLE_MAX = 120, DONE_WHEN_MAX = 200, CLARIFIED_MAX = 8, CLARIFIED_TEXT_MAX = 120;
/** what the user's «Approva e parti» sends to the Strategist (also how its transcript shows the click) */
export const PLAN_APPROVED = 'Piano approvato: parti.';
/** the user's «Cambia qualcosa»: the Strategist proposes again */
export const planChange = (text: string): string => `Cambia il piano: ${text.trim()}`;
/** the answer «Basta domande» gives to the open question */
export const ENOUGH_QUESTIONS = 'Basta domande: proponi ora il piano con quello che sai.';

/** The app's fixed text a Strategist root chat gets after its first message (the user's own words come first). Not
 *  in the role's instructions: the user's edits to the role never drop the flow the strip depends on. */
export const STRATEGY_FLOW = [
  '[app · how you work with the user here]',
  '1. First find out what the user really wants, at a high level: ask ONE question at a time with your question tool (AskUserQuestion on Claude), in the user\'s language, with 2 to 4 short options, the recommended one first ending with " (consigliato)", and a short header naming the topic. If a missing goal, scope, constraint or success criterion would change your plan, ask the user before proposing it; never silently invent it. Skip what the request already says. Stop as soon as goal, scope, constraints and "done" are clear, after at most 5 questions, or when the user answers "Basta domande".',
  `2. Then propose the plan with plan_propose: 2 to 6 steps, each one short plain line in the user's language with the role that does it; no jargon, no sub-steps. End your turn and wait: the user approves on your strip ("${PLAN_APPROVED}") or writes what to change, and then you propose again. Delegate nothing before the approval.`,
  '3. Once approved, inspect agent_children and reuse a compatible child with agent_assign_task (read agent_task_events first), or delegate new work with agent_delegate, giving its number as `step` (independent steps in parallel). A step you do yourself: plan_update it to "now", then to "done". The user follows the steps on your strip. At the end, agent_report as usual.',
].join('\n');

const line = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${what}: required text.`);
  const s = v.replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new Error(`${what}: at most ${max} characters.`);
  return s;
};

/** plan_propose's input, checked: the steps (all to do) and the optional "finished when" line. */
export function checkProposal(a: Record<string, unknown>): { steps: PlanStep[]; doneWhen?: string } {
  const raw = a.steps;
  if (!Array.isArray(raw) || raw.length < STEPS_MIN || raw.length > STEPS_MAX) throw new Error(`plan_propose: steps = ${STEPS_MIN} to ${STEPS_MAX} items.`);
  const steps = raw.map((v, i): PlanStep => {
    const s = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
    if (!s) throw new Error(`steps[${i}]: object required.`);
    const extra = Object.keys(s).find(k => k !== 'title' && k !== 'role');
    if (extra) throw new Error(`steps[${i}]: unknown field ${extra}.`);
    if (s.role !== undefined && !isWorkRole(s.role)) throw new Error(`steps[${i}].role: one of the work roles, or leave it out for a step you do yourself.`);
    return { title: line(s.title, STEP_TITLE_MAX, `steps[${i}].title`), ...(s.role !== undefined ? { role: s.role as WorkRoleId } : {}), state: 'todo' };
  });
  const doneWhen = a.doneWhen === undefined ? undefined : line(a.doneWhen, DONE_WHEN_MAX, 'doneWhen');
  return { steps, ...(doneWhen ? { doneWhen } : {}) };
}

/** A step number (1-based) of the plan, or an error naming the range. */
export function stepIndex(plan: StrategyPlan, step: unknown, what: string): number {
  if (!Number.isInteger(step) || (step as number) < 1 || (step as number) > plan.steps.length) throw new Error(`${what}: a step number from 1 to ${plan.steps.length}.`);
  return (step as number) - 1;
}

/** The plan with step i set to `state` (times kept: started at the first "now", ended at done or blocked); every step
 *  done ends the plan. */
export function withStep(plan: StrategyPlan, i: number, state: StepState, now: number): StrategyPlan {
  const steps = plan.steps.map((s, k) => {
    if (k !== i) return s;
    const started = s.startedAt ?? (state !== 'todo' ? now : undefined);
    const ended = state === 'done' || state === 'blocked' ? s.endedAt ?? now : undefined;
    const { startedAt: _s, endedAt: _e, outcome, ...rest } = s;
    return { ...rest, state, ...(state === 'done' && outcome ? { outcome } : {}), ...(started !== undefined ? { startedAt: started } : {}), ...(ended !== undefined ? { endedAt: ended } : {}) };
  });
  const done = steps.every(s => s.state === 'done');
  return { ...plan, steps, ...(done ? { phase: 'done' as const, at: now } : plan.phase === 'done' ? { phase: 'running' as const, at: now } : {}) };
}

/** Step i got these delegated chats: it is under way. */
export function withDelegated(plan: StrategyPlan, i: number, chatIds: string[], now: number): StrategyPlan {
  const s = plan.steps[i]!;
  // A reused conversation now belongs to this step; its prior run remains in the run ledger.
  const moved = { ...plan, steps: plan.steps.map((step, k) => k === i || !step.chatIds ? step : { ...step, chatIds: step.chatIds.filter(id => !chatIds.includes(id)) }) };
  const next = withStep(moved, i, 'now', now);
  next.steps[i] = { ...next.steps[i]!, chatIds: [...new Set([...(s.chatIds ?? []), ...chatIds])].slice(-10) };
  return next;
}

/** A delegated chat reported: its step is finished when every chat reported done or partial, blocked when one cannot proceed, unchanged while one still works. `outcomes` = each chat's outcome, undefined while it works. */
export function afterReport(plan: StrategyPlan, chatId: string, outcomes: (id: string) => DelegationOutcome | undefined, now: number): StrategyPlan {
  const i = plan.steps.findIndex(s => s.chatIds?.includes(chatId));
  if (i < 0) return plan;
  const all = plan.steps[i]!.chatIds!.map(outcomes);
  if (all.some(o => o === undefined)) return plan;
  const outcome: DelegationOutcome = all.includes('blocked') ? 'blocked' : all.includes('partial') ? 'partial' : 'done';
  const next = withStep(plan, i, outcome === 'blocked' ? 'blocked' : 'done', now);
  next.steps[i] = { ...next.steps[i]!, outcome };
  return next;
}

/** A final parent report ends execution, without claiming unfinished steps met their criteria.
 * Unfinished work is partial (or retains a blocked result); explicit successful steps retain their quality. */
export function finishPlan(plan: StrategyPlan, now: number): StrategyPlan {
  return { ...plan, phase: 'done', at: now, steps: plan.steps.map(s => ({ ...s, state: 'done',
    outcome: s.outcome ?? (s.state === 'done' ? 'done' : s.state === 'blocked' ? 'blocked' : 'partial'),
    endedAt: s.endedAt ?? now })) };
}

/** The answers to the user's questions, as "already clear" lines (the latest CLARIFIED_MAX). */
export function withClarified(plan: StrategyPlan, qs: { question: string; header?: string }[], answers: Record<string, string | string[]>): StrategyPlan {
  const cut = (s: string) => { const x = s.replace(/\s+/g, ' ').trim(); return x.length > CLARIFIED_TEXT_MAX ? `${x.slice(0, CLARIFIED_TEXT_MAX - 1)}…` : x; };
  const added = qs.flatMap(q => {
    const a = answers[q.question], text = Array.isArray(a) ? a.join(', ') : a;
    return typeof text === 'string' && text.trim() && text !== ENOUGH_QUESTIONS ? [{ q: cut(q.header?.trim() || q.question), a: cut(text) }] : [];
  });
  return added.length ? { ...plan, clarified: [...plan.clarified, ...added].slice(-CLARIFIED_MAX) } : plan;
}

/** A saved plan, checked (an unreadable one is dropped, never guessed). */
export function readPlan(v: unknown): StrategyPlan | null {
  const p = v as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || !['asking', 'proposed', 'revising', 'running', 'done'].includes(p.phase as string) || !Number.isFinite(p.at)) return null;
  const str = (x: unknown, max: number) => typeof x === 'string' && x.length > 0 && x.length <= max;
  const time = (x: unknown) => x === undefined || (typeof x === 'number' && Number.isFinite(x) && x > 0);
  if (!Array.isArray(p.clarified) || p.clarified.length > CLARIFIED_MAX || !p.clarified.every(c => c && str(c.q, CLARIFIED_TEXT_MAX) && str(c.a, CLARIFIED_TEXT_MAX))) return null;
  if (!Array.isArray(p.steps) || p.steps.length > STEPS_MAX || !p.steps.every(s => s && str(s.title, STEP_TITLE_MAX) && (s.role === undefined || isWorkRole(s.role))
    && (s.outcome === undefined || ['done', 'partial', 'blocked'].includes(s.outcome)) && STEP_STATES.includes(s.state) && (s.chatIds === undefined || Array.isArray(s.chatIds) && s.chatIds.length <= 10 && s.chatIds.every((id: unknown) => typeof id === 'string' && /^[\w-]{1,80}$/.test(id)))
    && time(s.startedAt) && time(s.endedAt))) return null;
  if (p.doneWhen !== undefined && !str(p.doneWhen, DONE_WHEN_MAX)) return null;
  return {
    phase: p.phase as PlanPhase, at: p.at as number, clarified: (p.clarified as Clarified[]).map(c => ({ q: c.q, a: c.a })),
    steps: (p.steps as PlanStep[]).map(s => ({ title: s.title, ...(s.role ? { role: s.role } : {}), state: s.state, ...(s.outcome ? { outcome: s.outcome } : {}), ...(s.chatIds ? { chatIds: [...s.chatIds] } : {}),
      ...(s.startedAt ? { startedAt: s.startedAt } : {}), ...(s.endedAt ? { endedAt: s.endedAt } : {}) })),
    ...(p.doneWhen ? { doneWhen: p.doneWhen as string } : {}),
  };
}

/** Steps done, of how many. */
export const planCount = (plan: StrategyPlan): { done: number; total: number } => ({ done: plan.steps.filter(s => s.state === 'done').length, total: plan.steps.length });
