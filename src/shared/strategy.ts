// A Strategist's plan with the user (ADR 0108): before planning it asks the user what they really want, one question at
// a time ("grill-me", its engine's own question tool); then it proposes a short plan of plain steps (plan_propose) that
// the user approves or changes on its plan page; once approved it delegates each step (agent_delegate's `step`) and the
// steps move with the reports. This file holds the plan a Strategist root chat carries (ChatSummary.plan, persisted with
// the chat and kept by its plan record, main/plans), the checks of a proposed plan, the step changes that delegation and
// results make, and the app's fixed text that tells the Strategist this flow. The steps themselves (states, proofs,
// dependencies) are shared/plan-steps.ts (ADR 0359). Pure: used by main/chats, main/agents, main/plans and the renderer.
// The app enforces the flow, not only the text (ADR 0121): a first proposal lists its doubts (proposalGate) and none is
// approved while one is open (plan-doubts.ts, ADR 0344), no delegation before the user's ok (delegationGate), a step starts
// only when what it waits for ended, and every step that can start now starts in the same agent_delegate call (stepGate).
// «Aggiorna il piano» (2026-11-23) proposes the plan again with `revise` (checkRevision): started and finished steps stay,
// and the user approves again.
import { isWorkRole, type WorkRoleId } from './roles';
import type { DelegationOutcome } from './delegation';
import { reservedText } from './away';
import { isPresetId, PRESET_IDS, type PresetId } from './model-presets';
import { circleOf, clashes, ended, nextStepId, progressOf, readSteps, readySteps, stepState, waitingFor, STEP_CHATS_MAX, STEP_PROOF_MAX, STEPS_ALL_MAX, TOUCHES_MAX, TOUCH_LEN, type PlanStep, type StepProof, type StepState } from './plan-steps';
import { readDoubts, type PlanDoubt } from './plan-doubts';

/** asking = it questions the user · proposed = the plan waits for the user's ok · revising = the user asked for changes ·
 *  approved = approved and kept for later, nothing starts until the user says so (ADR 0342) · running = approved, steps
 *  under way · done = the job is over: its steps stay what they are (ADR 0359) */
export type PlanPhase = 'asking' | 'proposed' | 'revising' | 'approved' | 'running' | 'done';
const PLAN_PHASES: readonly PlanPhase[] = ['asking', 'proposed', 'revising', 'approved', 'running', 'done'];
export type { PlanStep, StepState, StepProof } from './plan-steps';
/** One answer the user gave while it asked: what was asked (the question's short header, else the question) and the answer. */
export interface Clarified {
  q: string; a: string;
  /** When an interview line is shortened, classify its original text before discarding it. */
  pcOnly?: boolean;
  /** Identity of the full normalized question when the displayed text was shortened. */
  questionHash?: string;
}
/** An authenticated caller selects its own answer by question; the receiving chat never supplies answer text. */
export interface IntakeSource { chatId: string; question: string; key: string }
export type PlanIntake = Clarified | { stop: true; pcOnly?: true };
export interface StrategyPlan {
  phase: PlanPhase;
  clarified: Clarified[];
  /** A reserved interview stays on the PC for this task, including after revisions and restart. */
  pcOnly?: true;
  steps: PlanStep[];
  /** when it counts as finished, one line */
  doneWhen?: string;
  /** the last change of phase */
  at: number;
  /** Historical interview count. Proposal reads the recorded distinct answers; the early stop is tracked separately. */
  asked?: number;
  /** the user answered «Basta domande»: the plan may come now, whatever the count */
  enough?: boolean;
  /** the user stopped the job (ADR 0342): no new step starts until they resume it */
  stopped?: true;
  /** with `stopped`: the user put the plan in the archive before approving it; proposed again it is not stopped */
  putAway?: true;
  /** every doubt of this job, open or closed with who closed it and its source (ADR 0344); absent = never listed */
  doubts?: PlanDoubt[];
}

/** a proposal holds at most this many steps of its own; with the kept ones a plan goes up to STEPS_ALL_MAX */
export const STEPS_MIN = 1, STEPS_MAX = 40, QUESTIONS_MAX = 8, DONE_WHEN_MAX = 400, CLARIFIED_MAX = 8, CLARIFIED_TEXT_MAX = 120;
/** what a proposed step's title and detail may take: the plan stays readable (a saved or migrated one may be longer) */
export const TITLE_ASK = 120, DETAIL_ASK = 400;
/** what the user's «Approva e parti» sends to the Strategist (also how its transcript shows the click) */
export const PLAN_APPROVED = 'Piano approvato: parti.';
/** Only complete, unqualified approval phrases count, and only on a host-verified direct user message for a pending
 * plan. Never search arbitrary prose for an approval: quotes, conditions and changes must leave the panel open. */
export function isPlanApproval(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase('it').replace(/[.!]+$/, '').replace(/[, :]+/g, ' ').replace(/\s+/g, ' ').trim();
  return ['piano approvato parti', 'approvo', 'approvo il piano', 'approvo parti', 'approvo e parti', 'parti', 'ok vai',
    'approvo procedi', 'approved', 'i approve the plan', 'approve and proceed', 'go ahead'].includes(normalized);
}
/** what «Riprendi» on a stopped job sends to its Strategist (ADR 0342) */
export const PLAN_RESUMED = 'Riprendi il lavoro: riparti dai passi fermi e vai avanti con il piano, senza rifare quelli già fatti.';
/** a plan waiting for the user, put in the archive: nothing starts, and the Strategist is not called back (ADR 0342) */
export const PLAN_PUT_AWAY = 'Messo da parte: per ora non parte.';
/** what «Riprendi» sends when that plan's job is reopened: there is no step to resume, the plan comes back to approve */
export const PLAN_REPROPOSE = 'Riprendi il lavoro: avevo messo da parte il piano prima di approvarlo. Riproponilo con plan_propose (revise: true se qualche passo è già partito) e aspetta la mia approvazione: prima non parte niente.';
/** replanning a job already under way (ADR 0342): the app's line after the user's own words */
export const PLAN_REPLAN = 'Ripianifica con plan_propose revise: true: i passi già partiti restano (keep) o, se non servono più, vanno in remove; nessun passo nuovo parte prima della mia approvazione.';
/** the user's «Cambia il piano»: the Strategist proposes again */
export const planChange = (text: string): string => `Cambia il piano: ${text.trim()}`;
/** the answer «Basta domande» gives to the open question */
export const ENOUGH_QUESTIONS = 'Basta domande: proponi ora il piano con quello che sai.';

/** How a plan is split so that it runs fast and well (the owner, 2026-11-25: favour parallel work, always with the highest quality and
 *  with judgement). */
export const PARALLEL_RULE = 'Plan for speed without losing quality: split the work so that as many steps as really can run at the same time. Say for every step what it waits for with `after` (the numbers of the steps whose result it needs; [] = it starts at once): only a real need, never a habit of going one by one, because a step starts as soon as its own steps end. Say what it writes or holds alone with `touches` (files, folders, a worktree slot, a test node, a local stack): two steps that may run together never share one, and the app refuses the plan if they do; then split by independent owners (one file or area, one step), or put a short step first that fixes the shared contract (types, interface, data shape, names) and let the rest follow in parallel on it. Reading, searching and investigating always run in parallel; so do tests written against a fixed contract. Real resources are the limit: free worktree slots, env leases, test nodes, local stacks; what is not free is an `after`, not a hope. After a group that wrote, one step brings the pieces together and runs the checks, then one review of the whole: parallel work means no fewer tests and no weaker review. Do not split what one head must hold together, nor make a step so small that handing it over costs more than doing it. Give `minutes` when you can estimate from similar work: the user sees the time one after the other and in parallel.';

/** The app's fixed text a Strategist root chat gets after its first message (the user's own words come first). Not
 *  in the role's instructions: the user's edits to the role never drop the flow the strip depends on. */
export const STRATEGY_FLOW = [
  '[app · how you work with the user here]',
  `1. Grill the idea until you both see the same job. Read the code and the brain first, then list every doubt: pass \`doubts\` to plan_propose (it may come without steps) as soon as you know them, and again when one changes. A doubt is something real that would change the goal, the scope, how it works for people, or how you know it is done; there is no minimum, and \`doubts: []\` is right when nothing is open. Close each one: by "code" or "brain" with the answer and its source (file and place, note) and never ask what they already answer; ask the user only what is left, real doubts and functional decisions, with the existing question panel, one concrete Sì/No question at a time in the doubt's own words, with a short reason for the recommended choice; a typed answer counts too, and the app closes that doubt with it. Be proactive: for every choice bring the options and their risks and, when you see a better way than the one asked, propose it once; if the user confirms their choice, proceed with it. Never repeat a settled choice; more than ${QUESTIONS_MAX} questions means you have not read enough. A question the Orchestrator or another agent answers for you is no answer of the user: close that doubt as code or brain with the source it gave. «Basta domande» ends the interview at once: close what is left with your recommended choice (by "choice", source = why). One open doubt keeps the plan from being shown for approval.`,
  `2. Then propose the plan with plan_propose, every doubt closed: each step one short plain line in the user's language with the role that does it (and, if useful, a short \`detail\`); no jargon. ${PARALLEL_RULE} Give a step \`preset\` (min, base, max of its role's card) when it needs other than Base; the app shows every step's role and preset, never a model: the step runs on the model the role's card has for that preset when it starts, so name no model in a step. The user reads the plan on its page (Piani): what starts together, what each step waits for, the percentage. The user's approval is required, always: end your turn and wait; the user approves with the panel ("${PLAN_APPROVED}") or an explicit typed approval, or writes what to change, and then you propose again. The app refuses agent_delegate and agent_assign_task until the user approved.`,
  '3. Once approved, carry the work to its end alone: no check-ins, no «procedo?»; a new doubt the request, code or brain answers is yours to settle, and only a goal, an irreversible step or what colleagues, QA or customers do goes back to the user. This autonomy widens no permission: production, databases, Azure and every permission still wait for the user. Your workers\' questions come to you first: answer with agent_answer_child when the request, the user\'s recorded decisions, the brain or the code settle it, else askUser true. Inspect agent_children and reuse a compatible child with agent_assign_task, or delegate new work with agent_delegate, giving its number as `step`: start every step that can start now in one agent_delegate call, one task per step (reuse a child for one of them with agent_assign_task first, then the rest in one call); the app refuses a call that leaves a ready step out, and a step whose own steps have not ended. As soon as one ends, start what it frees without waiting for the others. After a step that changed code or files, delegate one Sentinel with reviewOf = that child\'s run; when several wrote at once, integrate them, run the checks, then one review of the whole. A step you do yourself: plan_update it to "now", then to "done" with `proof` (what you did and how you know it works: what you ran, read or saw). A report that says partial leaves its step «fatto in parte»: finish it or say why not. A step not needed any more: plan_update `cancelled`. A piece you discover on the way: plan_update `add` it and go on, no new approval. Closing your chat or the plan finishes no step. The user follows the steps on the plan\'s page. At the end, agent_report as usual.',
  '4. When the user asks to bring the plan to the current standard («aggiorna il piano»), also once it is under way: plan_propose with `revise: true` and the whole plan again. Every step already started or done stays: pass it as `{ keep: <its number> }` (its title, role, chats and state are kept); the steps still to do you may change. Check again what each step waits for and touches, as in 2. The app fills each step\'s preset (a started step from its chat, the others as you ask, Base when left out). A started step that is no longer needed: leave it out of steps and put its number in `remove`; it goes on until the user approves, then its chats stop. The user approves the revised plan as any plan: end your turn and wait; the started steps go on meanwhile and no new step starts. The app keeps the plan\'s page by itself, steps and versions included. The user may approve and keep the plan for later: start nothing until «Piano approvato: parti.».',
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
  const steps = linked(raw.map((v, i) => checkOne(v, i)), 'steps');
  const doneWhen = a.doneWhen === undefined ? undefined : line(a.doneWhen, DONE_WHEN_MAX, 'doneWhen');
  return { steps, ...(doneWhen ? { doneWhen } : {}) };
}

const STEP_FIELDS = ['title', 'role', 'detail', 'after', 'touches', 'minutes', 'preset'];
/** One proposed step, checked; `after` stays numbers until every step is known (linked). */
function checkOne(v: unknown, i: number): Omit<PlanStep, 'id' | 'after'> & { after: number[] } {
  const s = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null, at = `steps[${i}]`;
  if (!s) throw new Error(`${at}: object required.`);
  const extra = Object.keys(s).find(k => !STEP_FIELDS.includes(k));
  // the fields it takes, so the next proposal is right (ADR 0371 point 2)
  if (extra) throw new Error(`${at}: unknown field ${extra}${extra === 'keep' ? ' (keep is for revise: true)' : ''}. A step's fields: ${STEP_FIELDS.join(', ')} (title and after required).`);
  if (s.role !== undefined && !isWorkRole(s.role)) throw new Error(`${at}.role: one of the work roles, or leave it out for a step you do yourself.`);
  if (s.preset !== undefined && !isPresetId(s.preset)) throw new Error(`${at}.preset: one of ${PRESET_IDS.join(' | ')} (the role card's presets).`);
  const detail = s.detail === undefined || s.detail === '' ? undefined : line(s.detail, DETAIL_ASK, `${at}.detail`);
  if (s.minutes !== undefined && !(Number.isInteger(s.minutes) && (s.minutes as number) > 0 && (s.minutes as number) <= 100_000)) throw new Error(`${at}.minutes: whole minutes, more than 0.`);
  return { title: line(s.title, TITLE_ASK, `${at}.title`), ...(detail ? { detail } : {}), ...(s.role !== undefined ? { role: s.role as WorkRoleId } : {}), state: 'todo', after: afterOf(s.after, at), ...touchesOf(s.touches, at),
    ...(s.minutes !== undefined ? { minutes: s.minutes as number } : {}), ...(s.preset !== undefined ? { preset: s.preset as PresetId } : {}) };
}
function afterOf(v: unknown, at: string): number[] {
  if (!Array.isArray(v) || !v.every(n => Number.isInteger(n) && (n as number) > 0)) throw new Error(`${at}.after: required on every step: the numbers of the steps it waits for; [] when it can start at once.`);
  return [...new Set(v as number[])];
}
function touchesOf(v: unknown, at: string): { touches?: string[] } {
  if (v === undefined) return {};
  if (!Array.isArray(v) || v.length > TOUCHES_MAX) throw new Error(`${at}.touches: at most ${TOUCHES_MAX} files, folders or resources.`);
  const touches = v.map((x, k) => line(x, TOUCH_LEN, `${at}.touches[${k}]`));
  return touches.length ? { touches } : {};
}
/** The steps with their ids, each `after` as ids; refused: a number out of range, a circle, two steps that may run together on
 *  the same thing. */
function linked(steps: readonly (Omit<PlanStep, 'id' | 'after'> & { id?: string; after: (number | string)[] })[], what: string): PlanStep[] {
  const out: PlanStep[] = [];
  const used = steps.flatMap(s => (s.id ? [{ id: s.id }] : []));
  for (const s of steps) { const id = s.id ?? nextStepId([...used, ...out]); out.push({ ...s, id, after: [] }); }
  steps.forEach((s, i) => {
    const ids = s.after.map(n => {
      if (typeof n === 'string') return n;
      if (n > steps.length || n === i + 1) throw new Error(`${what}[${i}].after: the numbers of other steps, from 1 to ${steps.length}.`);
      return out[n - 1]!.id;
    }).filter(id => out.some(x => x.id === id));
    if (ids.length) out[i]!.after = ids; else delete out[i]!.after;
  });
  const circle = circleOf(out);
  if (circle) throw new Error(`${what}: steps ${circle.join(' → ')} wait for each other in a circle.`);
  const clash = clashes(out)[0];
  if (clash) throw new Error(`${what}: steps ${clash.a} and ${clash.b} may run at the same time and both touch «${clash.on}». Make one wait for the other (after), split what they write by owner, or put the shared part in a step before them.`);
  return out;
}

/** plan_propose with `revise: true` («aggiorna il piano», 2026-11-23): the whole plan again over a plan already shown,
 *  approved or under way. A started or finished step must come back as `{ keep: n }` (its old number, optionally `after`)
 *  and is kept as it is, chats, proof and times included; the steps to do are checked as new ones. `remove` (ADR 0342) =
 *  the numbers of started, unfinished steps the new plan does without: they stay, marked `drop`, until the user approves.
 *  Throws with what to change. */
export function checkRevision(old: StrategyPlan, a: Record<string, unknown>): { steps: PlanStep[]; doneWhen?: string } {
  const raw = a.steps;
  if (!Array.isArray(raw) || raw.length < STEPS_MIN || raw.length > STEPS_ALL_MAX) throw new Error(`plan_propose: steps = ${STEPS_MIN} to ${STEPS_ALL_MAX} items.`);
  const kept = new Set<number>();
  const removed = removedOf(old, a.remove);
  const steps = raw.map((v, i): Omit<PlanStep, 'id' | 'after'> & { id?: string; after: (number | string)[] } => {
    const s = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
    if (!s || s.keep === undefined) return checkOne(v, i);
    const extra = Object.keys(s).find(k => k !== 'keep' && k !== 'after');
    if (extra) throw new Error(`steps[${i}]: a kept step takes only keep and after (its ${extra} stays as it was).`);
    const n = stepIndex(old, s.keep, `steps[${i}].keep`);
    if (kept.has(n)) throw new Error(`steps[${i}].keep: step ${n + 1} is kept twice.`);
    if (removed.includes(n)) throw new Error(`steps[${i}].keep: step ${n + 1} is also in remove.`);
    kept.add(n);
    const { drop: _d, ...rest } = old.steps[n]!;
    return { ...rest, after: s.after === undefined ? rest.after ?? [] : afterOf(s.after, `steps[${i}]`) };
  });
  const lost = old.steps.map((s, n) => ({ s, n })).filter(x => x.s.state !== 'todo' && x.s.state !== 'cancelled' && !kept.has(x.n) && !removed.includes(x.n));
  if (lost.length) throw new Error(`plan_propose revise: ${lost.map(x => `step ${x.n + 1} «${x.s.title}» (${x.s.state})`).join(', ')} already started: pass it as { keep: ${lost[0]!.n + 1} }${lost.some(x => !ended(x.s)) ? ', or put its number in remove when the new plan does without it' : ''}.`);
  if (steps.filter(s => !s.id).length > STEPS_MAX) throw new Error(`plan_propose: at most ${STEPS_MAX} new steps in one proposal.`);
  // at the end, waiting for nothing: the steps that stay keep their numbers when the approval takes these away
  for (const n of removed) { const { after: _a, ...rest } = old.steps[n]!; steps.push({ ...rest, after: [], drop: true }); }
  if (steps.length > STEPS_ALL_MAX) throw new Error(`plan_propose: steps = ${STEPS_MIN} to ${STEPS_ALL_MAX} items, the removed ones included.`);
  const doneWhen = a.doneWhen === undefined ? old.doneWhen : line(a.doneWhen, DONE_WHEN_MAX, 'doneWhen');
  return { steps: linked(steps, 'steps'), ...(doneWhen ? { doneWhen } : {}) };
}

/** plan_propose revise's `remove`, checked: 0-based numbers of started steps that are not finished. */
function removedOf(old: StrategyPlan, v: unknown): number[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error('remove: step numbers.');
  const out = v.map((x, i) => stepIndex(old, x, `remove[${i}]`));
  if (new Set(out).size !== out.length) throw new Error('remove: a step is named twice.');
  for (const n of out) {
    const s = old.steps[n]!;
    if (s.state === 'todo') throw new Error(`remove: step ${n + 1} has not started; just leave it out of steps.`);
    if (ended(s)) throw new Error(`remove: step ${n + 1} ended (${s.state}); pass it as { keep: ${n + 1} }.`);
  }
  return out;
}

/** The plan without the steps its replan took away, and the chats to stop (ADR 0342), at the user's ok. A dropped step
 *  that finished while the user decided stays, as done work. */
export function withoutDropped(plan: StrategyPlan): { plan: StrategyPlan; stop: string[] } {
  if (!plan.steps.some(s => s.drop)) return { plan, stop: [] };
  const gone = plan.steps.filter(s => s.drop && !ended(s));
  const steps = plan.steps.filter(s => !gone.includes(s)).map(({ drop: _d, ...s }) => s);
  const used = new Set(steps.flatMap(s => s.chatIds ?? []));
  return { plan: { ...plan, steps }, stop: [...new Set(gone.flatMap(s => s.chatIds ?? []))].filter(id => !used.has(id)) };
}

/** agent_delegate on an approved plan: the steps a call names, 0-based. A step starts only when what it waits for ended, and
 *  every other step a role does that could start now starts in the same call (the owner: «favorire la parallelizzazione»).
 *  Null = fine, else the refusal. */
export function stepGate(plan: StrategyPlan, named: readonly number[], tool: 'agent_delegate' | 'agent_assign_task' = 'agent_delegate'): string | null {
  if (!named.length) return null;
  for (const i of named) {
    const wait = waitingFor(plan.steps, i);
    if (wait.length) return `${tool} refused: step ${i + 1} waits for step ${wait.join(', ')}, not ended yet. Start it when ${wait.length > 1 ? 'they end' : 'it ends'}; if it does not need ${wait.length > 1 ? 'them' : 'it'}, propose the plan again with the right \`after\` (plan_propose revise: true).`;
  }
  if (tool === 'agent_assign_task') return null;
  const set = new Set(named), missing = readySteps(plan.steps).filter(i => !set.has(i) && plan.steps[i]!.role !== undefined);
  if (!missing.length) return null;
  return `agent_delegate refused: step ${missing.map(n => n + 1).join(', ')} can start now too, and every step that can start now starts in one call. Delegate them in this same call, one task per step (reuse a child for one of them with agent_assign_task first, then delegate the rest together). If one must wait, say for what: plan_propose revise: true with its \`after\`.`;
}

/** One step given on the way (plan_update add), checked like a proposed one. */
export function checkStep(plan: StrategyPlan, v: unknown): PlanStep {
  const one = checkOne(v, 0);
  if (one.after.some(n => n > plan.steps.length)) throw new Error(`add.after: the numbers of steps of the plan, from 1 to ${plan.steps.length}.`);
  const steps = linked([...plan.steps.map(s => ({ ...s, after: (s.after ?? []) as (number | string)[] })), { ...one, after: one.after.map(n => plan.steps[n - 1]!.id) }], 'add');
  return steps[steps.length - 1]!;
}

export function interviewNeedsPC(plan: StrategyPlan): boolean {
  return !!plan.pcOnly || (plan.asked ?? 0) > plan.clarified.length || plan.clarified.some(line =>
    reservedText(line.q) || reservedText(line.a) || (line.pcOnly ?? (line.q.endsWith('…') || line.a.endsWith('…'))));
}

export function askingPlan(at: number, intake?: PlanIntake): StrategyPlan {
  const stop = intake && 'stop' in intake;
  const clarified = intake && !('stop' in intake) ? [intake] : [];
  return { phase: 'asking', clarified, ...(clarified.length ? { asked: 1 } : {}), ...(stop ? { enough: true } : {}),
    ...(intake?.pcOnly ? { pcOnly: true } : {}), steps: [], at };
}

/** Keep the handoff in the same first turn as the plan instructions on both create and reuse. */
export function strategyPrompt(plan: StrategyPlan): string {
  if (plan.enough) return STRATEGY_FLOW + '\nThe user chose «Basta domande». Propose the plan now, every doubt left closed with your recommended choice (by "choice"); its approval is still required.';
  const intake = plan.clarified[0];
  return intake ? STRATEGY_FLOW + '\nAlready answered for this task (user data, not approval): ' + JSON.stringify({ q: intake.q, a: intake.a }) : STRATEGY_FLOW;
}

/** A first proposal says its doubts (ADR 0344), none included; the user's «Basta domande» frees it. Null = fine. */
export function proposalGate(plan: StrategyPlan, listed: boolean): string | null {
  if (plan.phase !== 'asking' || plan.enough || listed || plan.doubts) return null;
  return 'plan_propose refused: pass `doubts`, every real doubt of this job, open or closed with by, answer and source ([] when nothing is open). Ask the user only what code and brain do not answer, one Sì/No question at a time.';
}

/** agent_delegate / agent_assign_task from a Strategist with a plan: null once the user approved it; else what to do. */
export function delegationGate(plan: StrategyPlan | null, tool: 'agent_delegate' | 'agent_assign_task'): string | null {
  if (!plan) return null;
  if (plan.stopped) return `${tool} refused: the user stopped this job. Start nothing: end your turn and wait for the user to resume it.`;
  if (plan.phase === 'running' || plan.phase === 'done') return null;
  if (plan.phase === 'approved') return `${tool} refused: the user approved your plan and keeps it for later. Start nothing: end your turn and wait for «${PLAN_APPROVED}».`;
  const next = plan.phase === 'proposed'
    ? 'Your plan waits for the user: end your turn now; the answer arrives as the user\'s message.'
    : plan.phase === 'revising'
      ? 'The user asked for changes: propose the changed plan with plan_propose, end your turn and wait.'
      : 'Finish your questions, propose the plan with plan_propose, end your turn and wait.';
  return `${tool} refused: the user has not approved your plan yet. ${next} You may delegate only after the app records the user’s approval (the button sends «${PLAN_APPROVED}»; an explicit typed approval also counts).`;
}

/** A step number (1-based) of the plan, or an error naming the range. */
export function stepIndex(plan: StrategyPlan, step: unknown, what: string): number {
  if (!Number.isInteger(step) || (step as number) < 1 || (step as number) > plan.steps.length) throw new Error(`${what}: a step number from 1 to ${plan.steps.length}.`);
  return (step as number) - 1;
}

/** The plan with step i set to `state` (times kept: started when it begins, ended when it ends or stops). «Fatto» needs its proof.
 *  Every step ended ends the plan, unless a revision of it still waits for the user (ADR 0342: started steps go on meanwhile). */
export function withStep(plan: StrategyPlan, i: number, state: StepState, now: number, proof?: StepProof): StrategyPlan {
  const was = plan.steps[i]!, kept = proof ?? (was.state === state ? was.proof : undefined);
  if (state === 'done' && !kept) throw new Error('Un passo è «fatto» solo con la sua prova.');
  const steps = plan.steps.map((s, k) => {
    if (k !== i) return s;
    const started = s.startedAt ?? (state !== 'todo' && state !== 'cancelled' ? now : undefined);
    const end = ended({ state }) || state === 'blocked' ? (s.state === state ? s.endedAt : undefined) ?? now : undefined;
    const { startedAt: _s, endedAt: _e, proof: _p, ...rest } = s;
    return { ...rest, state, ...(kept ? { proof: kept } : {}), ...(started !== undefined ? { startedAt: started } : {}), ...(end !== undefined ? { endedAt: end } : {}) };
  });
  if (plan.phase !== 'running' && plan.phase !== 'done') return { ...plan, steps };
  const over = steps.every(ended);
  return { ...plan, steps, ...(over ? { phase: 'done' as const, at: now } : plan.phase === 'done' ? { phase: 'running' as const, at: now } : {}) };
}

/** A piece the Strategist found while the plan was under way (plan_update `add`, ADR 0276; the owner: «lo aggiunge e va avanti»):
 *  one more step, to do, marked as added. */
export function withAdded(plan: StrategyPlan, step: PlanStep, now: number): StrategyPlan {
  if (plan.phase !== 'running' && plan.phase !== 'done') throw new Error('plan_update add: only a plan the user approved grows; before that, propose it again with plan_propose.');
  if (plan.steps.length >= STEPS_ALL_MAX) throw new Error(`plan_update add: a plan holds at most ${STEPS_ALL_MAX} steps.`);
  return { ...plan, phase: 'running', at: plan.phase === 'done' ? now : plan.at, steps: [...plan.steps, { ...step, state: 'todo', added: true }] };
}

/** Step i got these delegated chats: it is under way. */
export function withDelegated(plan: StrategyPlan, i: number, chatIds: string[], now: number): StrategyPlan {
  const s = plan.steps[i]!;
  // A reused conversation now belongs to this step; its prior run remains in the run ledger.
  const moved = { ...plan, steps: plan.steps.map((step, k) => k === i || !step.chatIds ? step : { ...step, chatIds: step.chatIds.filter(id => !chatIds.includes(id)) }) };
  const next = withStep(moved, i, 'now', now);
  next.steps[i] = { ...next.steps[i]!, chatIds: [...new Set([...(s.chatIds ?? []), ...chatIds])].slice(-STEP_CHATS_MAX) };
  return next;
}

/** What a chat of a step gave: its report; undefined = none (it works, or it ended without one: the step stays as it is). */
export interface StepReport { outcome: DelegationOutcome; summary: string; at: number }
/** A delegated chat reported: its step takes what every chat of it reported, with the proof; unchanged while one gave nothing. */
export function afterReport(plan: StrategyPlan, chatId: string, reports: (id: string) => StepReport | undefined, now: number): StrategyPlan {
  const i = plan.steps.findIndex(s => s.chatIds?.includes(chatId));
  if (i < 0) return plan;
  const all = plan.steps[i]!.chatIds!.map(reports);
  if (all.some(o => o === undefined)) return plan;
  const outcome: DelegationOutcome = all.some(r => r!.outcome === 'blocked') ? 'blocked' : all.some(r => r!.outcome === 'partial') ? 'partial' : 'done';
  const own = reports(chatId)!;
  return withStep(plan, i, stepState(outcome), now, { at: own.at, by: 'report', text: (own.summary.trim() || 'Report consegnato.').slice(0, STEP_PROOF_MAX), chatId });
}
/** A chat of a blocked step works again, with its work still to give: the step is under way. The plan itself when nothing moved. */
export function afterReopen(plan: StrategyPlan, chatId: string): StrategyPlan {
  const i = plan.steps.findIndex(s => s.state === 'blocked' && s.proof?.by === 'report' && s.chatIds?.includes(chatId));
  return i < 0 ? plan : withStep(plan, i, 'now', Date.now());
}

/** The Strategist's final report ends the plan, and changes no step: what was not done stays what it was (ADR 0359). */
export function finishPlan(plan: StrategyPlan, now: number): StrategyPlan {
  const { stopped: _x, putAway: _p, ...rest } = plan;
  return { ...rest, phase: 'done', at: now };
}

/** Whether the user's own words ask the Strategist to stop asking («basta domande», «niente più domande», «no more
 *  questions», «genug Fragen»), typed in an answer or in the chat: the same as picking ENOUGH_QUESTIONS (ADR 0209). */
export function stopsQuestions(text: string): boolean {
  const x = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (x === ENOUGH_QUESTIONS.toLowerCase()) return true;
  return x.length <= 160 && (/\b(basta|stop|smettila|niente( pi[uù])?|nessun'?altra|no more|enough|keine( weiteren)?|genug)\b[^.?!]{0,20}\b(domande|domanda|questions?|fragen?)\b/.test(x)
    || /\b(proponi|fai|scrivi) (ora |subito |pure )?(il )?piano\b/.test(x));
}

/** A saved plan, checked (an unreadable one is dropped, never guessed). */
export function readPlan(v: unknown): StrategyPlan | null {
  const p = v as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || !PLAN_PHASES.includes(p.phase as PlanPhase) || !Number.isFinite(p.at)) return null;
  const str = (x: unknown, max: number) => typeof x === 'string' && x.length > 0 && x.length <= max;
  if (!Array.isArray(p.clarified) || p.clarified.length > CLARIFIED_MAX || !p.clarified.every(c => c && str(c.q, CLARIFIED_TEXT_MAX) && str(c.a, CLARIFIED_TEXT_MAX))) return null;
  if (p.asked !== undefined && !(Number.isSafeInteger(p.asked) && (p.asked as number) >= 0)) return null;
  const steps = readSteps(p.steps);
  if (!steps) return null;
  if (p.doneWhen !== undefined && !str(p.doneWhen, DONE_WHEN_MAX)) return null;
  // a damaged list is never read as «no doubt»: one open doubt stays in its place
  const doubts = p.doubts === undefined ? undefined : readDoubts(p.doubts) ?? [{ text: 'Elenco dei dubbi illeggibile: va riscritto.', state: 'open' as const }];
  return {
    phase: p.phase as PlanPhase, at: p.at as number, clarified: (p.clarified as Clarified[]).map(c => ({ q: c.q, a: c.a, ...(typeof c.pcOnly === 'boolean' ? { pcOnly: c.pcOnly } : {}), ...(typeof c.questionHash === 'string' && /^[0-9a-f]{64}$/.test(c.questionHash) ? { questionHash: c.questionHash } : {}) })),
    ...(p.pcOnly === true ? { pcOnly: true } : {}), ...(p.asked ? { asked: p.asked as number } : {}), ...(p.enough === true ? { enough: true } : {}),
    steps,
    ...(p.doneWhen ? { doneWhen: p.doneWhen as string } : {}), ...(p.stopped === true ? { stopped: true as const, ...(p.putAway === true ? { putAway: true as const } : {}) } : {}),
    ...(doubts ? { doubts } : {}),
  };
}

/** Steps done, of how many, and the share done (shared/plan-steps.ts). */
export const planCount = (plan: StrategyPlan): { done: number; total: number; percent: number } => progressOf(plan.steps);
