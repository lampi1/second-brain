// A Strategist's plan with the user (ADR 0108): before planning it asks the user what they really want, one question at
// a time ("grill-me", its engine's own question tool); then it proposes a short plan of plain steps (plan_propose) that
// the user approves or changes on its strip; once approved it delegates each step (agent_delegate's `step`) and the
// strip shows the steps as a checklist, Claude Code style. This file holds the plan a Strategist root chat carries
// (ChatSummary.plan, persisted with the chat), the checks of a proposed plan, the step changes that delegation and
// results make, and the app's fixed text that tells the Strategist this flow. Pure: used by main/chats/manager.ts,
// main/agents/strategy-tools.ts, main/agents/delegation.ts and the renderer (StrategyPanel.tsx, and the
// plan drawn on its map, work-map/WorkMapView.tsx). The app enforces the flow, not only the text (ADR 0121): a first
// proposal lists its doubts (proposalGate) and none is approved while one is open (plan-doubts.ts, ADR 0344), no
// delegation before the user's ok (delegationGate), and a parallel group starts in one agent_delegate call
// (parallelSplit). «Aggiorna il piano»
// (2026-11-23) proposes the plan again with `revise` (checkRevision): started and finished steps stay, and the user
// approves again.
import { isWorkRole, type WorkRoleId } from './roles';
import type { DelegationOutcome } from './delegation';
import { reservedText } from './away';
import { isPresetId, PRESET_IDS, type PresetId } from './model-presets';
import { readDoubts, type PlanDoubt } from './plan-doubts';

/** asking = it questions the user · proposed = the plan waits for the user's ok · revising = the user asked for changes ·
 *  approved = approved and kept for later, nothing starts until the user says so (ADR 0342) · running = approved, steps
 *  under way · done = every step done */
export type PlanPhase = 'asking' | 'proposed' | 'revising' | 'approved' | 'running' | 'done';
const PLAN_PHASES: readonly PlanPhase[] = ['asking', 'proposed', 'revising', 'approved', 'running', 'done'];
export type StepState = 'todo' | 'now' | 'done' | 'blocked';
export const STEP_STATES: readonly StepState[] = ['todo', 'now', 'done', 'blocked'];
export interface PlanStep {
  title: string;
  /** optional: one short line on what the step covers (shown on the plan to approve) */
  detail?: string;
  /** the role that does it (absent: the Strategist itself) */
  role?: WorkRoleId;
  state: StepState;
  /** Result quality is separate from execution progress: a partial report still finishes the work. */
  outcome?: DelegationOutcome;
  /** the chats delegated for it (agent_delegate with this step) */
  chatIds?: string[];
  startedAt?: number;
  endedAt?: number;
  /** the element of the project's map it works on (ADR 0276): the map shows the step there, live */
  on?: string;
  /** added while the plan was under way (plan_update add): the user approved the plan without it */
  added?: true;
  /** it goes together with the step before it, in parallel (ADR 0302); absent: it comes after it */
  par?: true;
  /** the role card's preset the step runs on (ADR 0336): the one its chat started on, else the one the plan asks
   *  (absent in plans saved before 2026-11-23: Base). Never a model (ADR 0346): the card's model for this preset is
   *  read when the step starts, so a card the user changed meanwhile counts */
  preset?: PresetId;
  /** a replan takes this started step away (ADR 0342): it goes on until the user approves, then its chats stop */
  drop?: true;
}
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
  /** the project map this plan is drawn on (its folder name, ADR 0276) */
  map?: string;
  /** the user stopped the job (ADR 0342): no new step starts until they resume it */
  stopped?: true;
  /** with `stopped`: the user put the plan in the archive before approving it; proposed again it is not stopped */
  putAway?: true;
  /** every doubt of this job, open or closed with who closed it and its source (ADR 0344); absent = never listed */
  doubts?: PlanDoubt[];
}

/** a plan under way may grow by the pieces it discovers (plan_update add), up to this many steps in all */
export const STEPS_ALL_MAX = 16;
export const STEPS_MIN = 1, STEPS_MAX = 8, STEP_TITLE_MAX = 120, STEP_DETAIL_MAX = 200, QUESTIONS_MAX = 8, DONE_WHEN_MAX = 200, CLARIFIED_MAX = 8, CLARIFIED_TEXT_MAX = 120;
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
export const PLAN_RESUMED = 'Riprendi il lavoro: riparti dai passi fermi e vai avanti con il piano.';
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

/** The app's fixed text a Strategist root chat gets after its first message (the user's own words come first). Not
 *  in the role's instructions: the user's edits to the role never drop the flow the strip depends on. */
export const STRATEGY_FLOW = [
  '[app · how you work with the user here]',
  `1. Grill the idea until you both see the same job. Read the code and the brain first, then list every doubt: pass \`doubts\` to plan_propose (it may come without steps) as soon as you know them, and again when one changes. A doubt is something real that would change the goal, the scope, how it works for people, or how you know it is done; there is no minimum, and \`doubts: []\` is right when nothing is open. Close each one: by "code" or "brain" with the answer and its source (file and place, note) and never ask what they already answer; ask the user only what is left, real doubts and functional decisions, with the existing question panel, one concrete Sì/No question at a time in the doubt's own words, with a short reason for the recommended choice; a typed answer counts too, and the app closes that doubt with it. Be proactive: for every choice bring the options and their risks and, when you see a better way than the one asked, propose it once; if the user confirms their choice, proceed with it. Never repeat a settled choice; more than ${QUESTIONS_MAX} questions means you have not read enough. A question the Orchestrator or another agent answers for you is no answer of the user: close that doubt as code or brain with the source it gave. «Basta domande» ends the interview at once: close what is left with your recommended choice (by "choice", source = why). One open doubt keeps the plan from being shown for approval.`,
  `2. Then propose the plan with plan_propose, every doubt closed: 2 to 6 steps, each one short plain line in the user's language with the role that does it (and, if useful, a short \`detail\`); no jargon, no sub-steps. Say for every step which steps it depends on: its \`detail\` starts with "dopo 1, 2" (in the user's language) or "subito" when it needs none. Steps that do not depend on each other are one parallel group: put them one after the other and give every one but the first \`par: true\`; a step that needs the group comes after it, without \`par\` (the user sees a dashed frame for each group and where it joins again). Mark a group parallel only after checking that its steps can really run at the same time now: free worktree slots and env leases, test nodes, local stacks; when one is not free, put those steps one after the other. A step is parallel or sequential, nothing in between. Give a step \`preset\` (min, base, max of its role's card) when it needs other than Base; the app shows every step's role and preset, never a model: the step runs on the model the role's card has for that preset when it starts, so name no model in a step. When the work is on a project (its code or systems), draw the plan on the project's map: pass \`map\` (the project; \`add\` = the pieces that do not exist yet) and each step's \`on\` (the element it works on; one element may hold several steps and agents). The user reads the map, not a list. The user's approval is required, always: end your turn and wait; the user approves with the panel ("${PLAN_APPROVED}") or an explicit typed approval, or writes what to change, and then you propose again. The app refuses agent_delegate and agent_assign_task until the user approved.`,
  '3. Once approved, carry the work to its end alone: no check-ins, no «procedo?»; a new doubt the request, code or brain answers is yours to settle, and only a goal, an irreversible step or what colleagues, QA or customers do goes back to the user. This autonomy widens no permission: production, databases, Azure and every permission still wait for the user. Your workers\' questions come to you first: answer with agent_answer_child when the request, the user\'s recorded decisions, the brain or the code settle it, else askUser true. Inspect agent_children and reuse a compatible child with agent_assign_task, or delegate new work with agent_delegate, giving its number as `step`: delegate a whole parallel group in one agent_delegate call, one task per step, so its steps really run at the same time (reuse a child for one of them with agent_assign_task first, then the rest in one call; the app refuses a group split over several agent_delegate calls), and start a step only when every step it depends on is done. After a step that changed code or files, delegate one Sentinel with reviewOf = that child\'s run. A step you do yourself: plan_update it to "now", then to "done". A piece you discover on the way: plan_update `add` it and go on, no new approval. The user follows the steps on your strip and on the map. At the end, agent_report as usual.',
  '4. When the user asks to bring the plan to the current standard («aggiorna il piano»), also once it is under way: plan_propose with `revise: true` and the whole plan again. Every step already started or done stays: pass it as `{ keep: <its number> }` (its title, role, chats and state are kept); the steps still to do you may change. Check every parallel group again as in 2 (resources, parallel or sequential); a step to do cannot be parallel with a started one. The app fills each step\'s preset (a started step from its chat, the others as you ask, Base when left out). A started step that is no longer needed: leave it out of steps and put its number in `remove`; it goes on until the user approves, then its chats stop. The user approves the revised plan as any plan: end your turn and wait; the started steps go on meanwhile and no new step starts. The app keeps the map of this job by itself, plan and steps included. The user may approve and keep the plan for later: start nothing until «Piano approvato: parti.».',
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
  const steps = raw.map((v, i) => checkOne(v, i));
  const doneWhen = a.doneWhen === undefined ? undefined : line(a.doneWhen, DONE_WHEN_MAX, 'doneWhen');
  return { steps, ...(doneWhen ? { doneWhen } : {}) };
}

function checkOne(v: unknown, i: number): PlanStep {
  const s = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  if (!s) throw new Error(`steps[${i}]: object required.`);
  const extra = Object.keys(s).find(k => !['title', 'role', 'detail', 'on', 'par', 'preset'].includes(k));
  if (s.par !== undefined && typeof s.par !== 'boolean') throw new Error(`steps[${i}].par: true or false.`);
  if (s.on !== undefined && !(typeof s.on === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(s.on))) throw new Error(`steps[${i}].on: a map element id.`);
  if (extra) throw new Error(`steps[${i}]: unknown field ${extra}${extra === 'keep' ? ' (keep is for revise: true)' : ''}.`);
  if (s.role !== undefined && !isWorkRole(s.role)) throw new Error(`steps[${i}].role: one of the work roles, or leave it out for a step you do yourself.`);
  if (s.preset !== undefined && !isPresetId(s.preset)) throw new Error(`steps[${i}].preset: one of ${PRESET_IDS.join(' | ')} (the role card's presets).`);
  const detail = s.detail === undefined || s.detail === '' ? undefined : line(s.detail, STEP_DETAIL_MAX, `steps[${i}].detail`);
  return { title: line(s.title, STEP_TITLE_MAX, `steps[${i}].title`), ...(detail ? { detail } : {}), ...(s.role !== undefined ? { role: s.role as WorkRoleId } : {}), state: 'todo', ...(s.on !== undefined ? { on: s.on as string } : {}), ...(s.par === true ? { par: true as const } : {}), ...(s.preset !== undefined ? { preset: s.preset as PresetId } : {}) };
}

/** plan_propose with `revise: true` («aggiorna il piano», 2026-11-23): the whole plan again over a plan already shown,
 *  approved or under way. A started or finished step must come back as `{ keep: n }` (its old number, optionally `par`)
 *  and is kept as it is, chats and times included; the steps to do are checked as new ones. A step to do cannot share a
 *  parallel group with a started one (that group could no longer start in one call). `remove` (ADR 0342) = the numbers of
 *  started, unfinished steps the new plan does without: they stay, marked `drop`, until the user approves. Throws with
 *  what to change. */
export function checkRevision(old: StrategyPlan, a: Record<string, unknown>): { steps: PlanStep[]; doneWhen?: string } {
  const raw = a.steps;
  if (!Array.isArray(raw) || raw.length < STEPS_MIN || raw.length > STEPS_ALL_MAX) throw new Error(`plan_propose: steps = ${STEPS_MIN} to ${STEPS_ALL_MAX} items.`);
  const kept = new Set<number>();
  const removed = removedOf(old, a.remove);
  const steps = raw.map((v, i): PlanStep => {
    const s = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
    if (!s || s.keep === undefined) return checkOne(v, i);
    const extra = Object.keys(s).find(k => k !== 'keep' && k !== 'par');
    if (extra) throw new Error(`steps[${i}]: a kept step takes only keep and par (its ${extra} stays as it was).`);
    if (s.par !== undefined && typeof s.par !== 'boolean') throw new Error(`steps[${i}].par: true or false.`);
    const n = stepIndex(old, s.keep, `steps[${i}].keep`);
    if (kept.has(n)) throw new Error(`steps[${i}].keep: step ${n + 1} is kept twice.`);
    if (removed.includes(n)) throw new Error(`steps[${i}].keep: step ${n + 1} is also in remove.`);
    kept.add(n);
    const { par: _p, drop: _d, ...rest } = old.steps[n]!;
    return { ...rest, ...(s.par === true ? { par: true as const } : {}) };
  });
  const lost = old.steps.map((s, n) => ({ s, n })).filter(x => x.s.state !== 'todo' && !kept.has(x.n) && !removed.includes(x.n));
  if (lost.length) throw new Error(`plan_propose revise: ${lost.map(x => `step ${x.n + 1} «${x.s.title}» (${x.s.state})`).join(', ')} already started: pass it as { keep: ${lost[0]!.n + 1} }${lost.some(x => x.s.state !== 'done') ? ', or put its number in remove when the new plan does without it' : ''}.`);
  if (steps.length + removed.length > STEPS_ALL_MAX) throw new Error(`plan_propose: steps = ${STEPS_MIN} to ${STEPS_ALL_MAX} items, the removed ones included.`);
  const waves = planWaves(steps);
  const mixed = steps.findIndex((s, i) => s.state === 'todo' && steps.some((t, k) => k !== i && waves[k] === waves[i] && t.state !== 'todo'));
  if (mixed >= 0) throw new Error(`steps[${mixed}]: it is to do but in the same parallel group as a started step; make it its own step after them (leave par out) or group it with steps to do.`);
  const doneWhen = a.doneWhen === undefined ? old.doneWhen : line(a.doneWhen, DONE_WHEN_MAX, 'doneWhen');
  // at the end, each its own turn: the steps that stay keep their numbers when the approval takes these away
  for (const n of removed) { const { par: _p, ...rest } = old.steps[n]!; steps.push({ ...rest, drop: true }); }
  return { steps, ...(doneWhen ? { doneWhen } : {}) };
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
    if (s.state === 'done') throw new Error(`remove: step ${n + 1} is done; pass it as { keep: ${n + 1} }.`);
  }
  return out;
}

/** The plan without the steps its replan took away, and the chats to stop (ADR 0342), at the user's ok. A dropped step
 *  that finished while the user decided stays, as done work. */
export function withoutDropped(plan: StrategyPlan): { plan: StrategyPlan; stop: string[] } {
  if (!plan.steps.some(s => s.drop)) return { plan, stop: [] };
  const gone = plan.steps.filter(s => s.drop && s.state !== 'done');
  const steps = plan.steps.filter(s => !gone.includes(s)).map(({ drop: _d, ...s }) => s);
  const used = new Set(steps.flatMap(s => s.chatIds ?? []));
  return { plan: { ...plan, steps }, stop: [...new Set(gone.flatMap(s => s.chatIds ?? []))].filter(id => !used.has(id)) };
}

/** agent_delegate on an approved plan (2026-11-23, «o parallelo o non parallelo»): the steps a call names, 0-based; a
 *  parallel group is launched in one call, so every other step of that group still to do (and done by a role) must be in
 *  the same call. Null = fine, else the refusal. Steps the Strategist does itself and steps already started are left out. */
export function parallelSplit(plan: StrategyPlan, named: readonly number[]): string | null {
  if (!named.length) return null;
  const waves = planWaves(plan.steps), set = new Set(named);
  const missing = plan.steps.map((s, i) => i).filter(i => !set.has(i) && plan.steps[i]!.state === 'todo' && plan.steps[i]!.role !== undefined && named.some(n => waves[n] === waves[i]));
  if (!missing.length) return null;
  return `agent_delegate refused: step ${[...set].map(n => n + 1).join(', ')} is in a parallel group with step ${missing.map(n => n + 1).join(', ')}, and a parallel group starts in one call. Delegate the whole group in this same call, one task per step (reuse a child for one of them with agent_assign_task first, then delegate the rest together). If they cannot run together now, ask the user to approve the plan with those steps one after the other (plan_propose revise: true).`;
}

/** One step given on the way (plan_update add), checked like a proposed one. */
export function checkStep(v: unknown): PlanStep { return checkProposal({ steps: [v] }).steps[0]!; }

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

/** The plan with step i set to `state` (times kept: started at the first "now", ended at done or blocked); every step
 *  done ends the plan, unless a revision of it still waits for the user (ADR 0342: started steps go on meanwhile). */
export function withStep(plan: StrategyPlan, i: number, state: StepState, now: number): StrategyPlan {
  const steps = plan.steps.map((s, k) => {
    if (k !== i) return s;
    const started = s.startedAt ?? (state !== 'todo' ? now : undefined);
    const ended = state === 'done' || state === 'blocked' ? s.endedAt ?? now : undefined;
    const { startedAt: _s, endedAt: _e, outcome, ...rest } = s;
    return { ...rest, state, ...(state === 'done' && outcome ? { outcome } : {}), ...(started !== undefined ? { startedAt: started } : {}), ...(ended !== undefined ? { endedAt: ended } : {}) };
  });
  if (plan.phase !== 'running' && plan.phase !== 'done') return { ...plan, steps };
  const done = steps.every(s => s.state === 'done');
  return { ...plan, steps, ...(done ? { phase: 'done' as const, at: now } : plan.phase === 'done' ? { phase: 'running' as const, at: now } : {}) };
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

/** A step whose chats ended without moving it (one closed or gone without a report, or whose report belonged to an earlier
 *  run of the plan's chat) is not «now» for ever (ADR 0342, live status): it ends with what its chats gave, blocked for one
 *  that gave nothing. `outcomes` as in afterReport; `chatId` = only the step of that chat. The plan itself when nothing
 *  moved; the approval and the user's stop are never touched. */
export function afterChatsEnded(plan: StrategyPlan, outcomes: (id: string) => DelegationOutcome | undefined, now: number, chatId?: string): StrategyPlan {
  let next = plan;
  plan.steps.forEach((s, i) => {
    if (s.state === 'now' && s.chatIds?.length && (!chatId || s.chatIds.includes(chatId))) {
      if (s.chatIds.every(id => outcomes(id) !== undefined)) next = afterReport(next, s.chatIds[0]!, outcomes, now);
    } else if (s.state === 'blocked' && s.outcome === 'blocked' && chatId && s.chatIds?.includes(chatId) && outcomes(chatId) === undefined) {
      // its chat is open again with its work still to give (a blocked the Strategist wrote itself has no outcome: kept)
      next = withStep(next, i, 'now', now);
    }
  });
  return next;
}

/** A final parent report ends execution, without claiming unfinished steps met their criteria.
 * Unfinished work is partial (or retains a blocked result); explicit successful steps retain their quality. */
export function finishPlan(plan: StrategyPlan, now: number): StrategyPlan {
  const { stopped: _x, putAway: _p, ...rest } = plan;
  return { ...rest, phase: 'done', at: now, steps: plan.steps.map(({ drop: _d, ...s }) => ({ ...s, state: 'done',
    outcome: s.outcome ?? (s.state === 'done' ? 'done' : s.state === 'blocked' ? 'blocked' : 'partial'),
    endedAt: s.endedAt ?? now })) };
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
  const time = (x: unknown) => x === undefined || (typeof x === 'number' && Number.isFinite(x) && x > 0);
  if (!Array.isArray(p.clarified) || p.clarified.length > CLARIFIED_MAX || !p.clarified.every(c => c && str(c.q, CLARIFIED_TEXT_MAX) && str(c.a, CLARIFIED_TEXT_MAX))) return null;
  if (p.asked !== undefined && !(Number.isSafeInteger(p.asked) && (p.asked as number) >= 0)) return null;
  if (!Array.isArray(p.steps) || p.steps.length > STEPS_ALL_MAX || !p.steps.every(s => s && str(s.title, STEP_TITLE_MAX) && (s.detail === undefined || str(s.detail, STEP_DETAIL_MAX)) && (s.role === undefined || isWorkRole(s.role))
    && (s.outcome === undefined || ['done', 'partial', 'blocked'].includes(s.outcome)) && STEP_STATES.includes(s.state) && (s.chatIds === undefined || Array.isArray(s.chatIds) && s.chatIds.length <= 10 && s.chatIds.every((id: unknown) => typeof id === 'string' && /^[\w-]{1,80}$/.test(id)))
    && time(s.startedAt) && time(s.endedAt) && (s.on === undefined || str(s.on, 48)))) return null;
  if (p.map !== undefined && !str(p.map, 48)) return null;
  if (p.doneWhen !== undefined && !str(p.doneWhen, DONE_WHEN_MAX)) return null;
  // a damaged list is never read as «no doubt»: one open doubt stays in its place
  const doubts = p.doubts === undefined ? undefined : readDoubts(p.doubts) ?? [{ text: 'Elenco dei dubbi illeggibile: va riscritto.', state: 'open' as const }];
  return {
    phase: p.phase as PlanPhase, at: p.at as number, clarified: (p.clarified as Clarified[]).map(c => ({ q: c.q, a: c.a, ...(typeof c.pcOnly === 'boolean' ? { pcOnly: c.pcOnly } : {}), ...(typeof c.questionHash === 'string' && /^[0-9a-f]{64}$/.test(c.questionHash) ? { questionHash: c.questionHash } : {}) })),
    ...(p.pcOnly === true ? { pcOnly: true } : {}), ...(p.asked ? { asked: p.asked as number } : {}), ...(p.enough === true ? { enough: true } : {}),
    steps: (p.steps as PlanStep[]).map(s => ({ title: s.title, ...(s.detail ? { detail: s.detail } : {}), ...(s.role ? { role: s.role } : {}), state: s.state, ...(s.outcome ? { outcome: s.outcome } : {}), ...(s.chatIds ? { chatIds: [...s.chatIds] } : {}),
      ...(s.startedAt ? { startedAt: s.startedAt } : {}), ...(s.endedAt ? { endedAt: s.endedAt } : {}), ...(s.on ? { on: s.on } : {}), ...(s.added === true ? { added: true as const } : {}), ...(s.par === true ? { par: true as const } : {}), ...(s.drop === true ? { drop: true as const } : {}),
      // read leniently: a bad preset (or none, before 2026-11-23) is left out, the plan stays; a model saved with a
      // step before ADR 0346 is dropped
      ...(isPresetId(s.preset) ? { preset: s.preset } : {}) })),
    ...(p.doneWhen ? { doneWhen: p.doneWhen as string } : {}), ...(p.map ? { map: p.map as string } : {}), ...(p.stopped === true ? { stopped: true as const, ...(p.putAway === true ? { putAway: true as const } : {}) } : {}),
    ...(doubts ? { doubts } : {}),
  };
}

/** Each step's turn (from 1), ADR 0302: a step comes after the one before it, or shares its turn when it is marked
 *  `par`. Steps of one turn go in parallel; the map and the plan show the turns in order. */
export function planWaves(steps: readonly Pick<PlanStep, 'par'>[]): number[] {
  let wave = 0;
  return steps.map((s, i) => (i > 0 && s.par ? wave : ++wave));
}

/** Steps done, of how many. */
export const planCount = (plan: StrategyPlan): { done: number; total: number } => ({ done: plan.steps.filter(s => s.state === 'done').length, total: plan.steps.length });
