// A plan (ADR 0359): ONE job of the user, whole: its goal and why, its project (editable), its steps with their true state, proofs,
// dependencies and the percentage done, its decisions and doubts, constraints, files and links, the chats that work on it and
// its versions. It replaces the plans and the plans. The app creates and keeps it in code (main/plans/service.ts)
// and it holds the job's plan itself, so it outlives the chat. Lifecycle: idea → toApprove → planned → running → stopped |
// finished → archived, and the trash (`deletedAt`, restorable; only the user deletes for good). This file is the contract the
// page, the live status and the tool build on: the record, its row and view, how the state is derived, which actions it allows
// now, the steps as they are shown (turn, what each waits for and opens), and the lenient reader of a saved file. Pure: used by
// main/plans/*, shared/contract/brain.ts and the renderer; pinned by test/unit/plans/shared.test.ts.
import { openDoubts } from './plan-doubts';
import type { PresetId } from './model-presets';
import { ladderText, type LadderQuestion } from './question-ladder';
import type { WorkRoleId } from './roles';
import { opens, progressOf, readySteps, timeOf, turnsOf, waitingFor, type PlanStep, type StepProof, type StepState } from './plan-steps';
import { readPlan, type StrategyPlan } from './strategy';

/** One version of a plan, in the history list. */
export interface PlanVersionInfo { version: number; at: number; by: string; summary: string }
/** What a plan links to: a file or folder, a web address, another plan, a chat. */
export interface PlanLink { kind: 'file' | 'link' | 'plan' | 'chat'; ref: string; label?: string }

/** idea = written down, or its Strategist is still asking (`planning`) · toApprove = its plan waits for the user ·
 *  planned = approved, not started · running = under way · stopped = the user stopped it, or its chat was closed ·
 *  finished = every step done (or the job reported) · archived = finished and seen, or put away by the user */
export type PlanState = 'idea' | 'toApprove' | 'planned' | 'running' | 'stopped' | 'finished' | 'archived';
export const PLAN_STATES: readonly PlanState[] = ['idea', 'toApprove', 'planned', 'running', 'stopped', 'finished', 'archived'];

/** user = «Ferma» · closed = its owner chat was closed, by the user or by the app with steps still open ·
 *  gone = its owner chat is no longer in the app · replaced = the owner chat moved on to another job */
export type PlanStopBy = 'user' | 'closed' | 'gone' | 'replaced';
export const PLAN_STOPS: readonly PlanStopBy[] = ['user', 'closed', 'gone', 'replaced'];

/** The Strategist chat the job belongs to; `task` = the job within that chat (a chat can get a second job). */
export interface PlanOwner { chatId: string; task: string }

/** One plan as saved (userData/plans/<id>/plan.json, its versions in history.jsonl); every real change is a new version. */
export interface Plan {
  id: string;
  version: number;
  title: string;
  /** the idea or the request in words (absent when only the title says it) */
  idea?: string;
  /** what it is for, and why now: in the user's words */
  goal?: string;
  why?: string;
  /** the project it belongs to, a name the user may change */
  project?: string;
  /** what must stay true, in plain lines */
  constraints: string[];
  /** files, folders, addresses, other plans, chats */
  links: PlanLink[];
  /** where it came from when the app made it from older data (migration): the old records, by name */
  from?: string[];
  /** in the trash: nothing of it changes; the user restores it, or deletes it for good */
  deletedAt?: number;
  owner?: PlanOwner;
  /** earlier owner chats of the same job (continued, or the job was resumed in a new chat) */
  past?: string[];
  /** the job's plan as it is now, steps and answers included; absent: an idea, or a job with no plan */
  plan?: StrategyPlan;
  state: PlanState;
  stopped?: { at: number; by: PlanStopBy };
  finishedAt?: number;
  /** when the user looked at it finished */
  seenAt?: number;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
  /** who made this version ("app", "user", "Orchestrator" or a chat's title) */
  by: string;
  /** what changed in this version, one line */
  summary: string;
}

/** What can be done on a map now (the screen's buttons, the Orchestrator's actions); the service refuses the rest. */
export type PlanAction = 'approve' | 'keep' | 'start' | 'stop' | 'resume' | 'replan' | 'archive' | 'reopen' | 'seen' | 'delete' | 'restore';

/** One step as the page shows it. */
export interface PlanStepView {
  /** the step's number, from 1 */
  n: number;
  id: string;
  title: string;
  detail?: string;
  role?: WorkRoleId;
  /** the role card's preset the step asks; never a model (ADR 0346) */
  preset?: PresetId;
  /** its turn, from 1: steps of one turn may run together */
  turn: number;
  /** it shares its turn with other steps */
  par?: true;
  state: StepState;
  proof?: StepProof;
  /** the numbers of the steps it waits for, all of them (`after`) and those not ended yet (`waitsFor`: none = it may start) */
  after: number[];
  waitsFor: number[];
  /** the steps that start as soon as it ends */
  opens: number[];
  touches: string[];
  minutes?: number;
  chatIds: string[];
  startedAt?: number;
  endedAt?: number;
  /** found on the way, after the approval */
  added?: true;
  /** the replan takes it away; it goes on until the user's ok */
  drop?: true;
  /** what its chats are doing now (see «Live status» below); absent when there is nothing to say beyond `state` */
  live?: StepLive;
}

/** A row of the list. */
export interface PlanInfo {
  id: string;
  title: string;
  project?: string;
  state: PlanState;
  /** in the trash */
  deleted?: true;
  /** an idea whose Strategist is asking or drawing the plan now, or a job being replanned */
  planning?: true;
  /** the plan waiting for the user replaces one whose steps already started */
  replanned?: true;
  ownerChatId?: string;
  /** the plan waits for an answer at this revision (`at` of approve and keep) */
  planAt?: number;
  steps: number; done: number; now: number; blocked: number; partial: number; check: number;
  /** the share done, 0-100: «fatto» counts one, «fatto in parte» half, the rest nothing (shared/plan-steps.ts progressOf) */
  percent: number;
  /** the first step to do that may start now; none when nothing can */
  next?: { n: number; title: string };
  /** how many steps may start now, together */
  ready: number;
  /** estimated minutes one step after the other and in parallel; absent when a step has no estimate */
  time?: { row: number; parallel: number };
  stopped?: { at: number; by: PlanStopBy };
  createdAt: number; updatedAt: number; finishedAt?: number; seenAt?: number; archivedAt?: number;
  can: PlanAction[];
  /** its plan's doubts (ADR 0344): one still open holds the approval and the start; first = the first open one */
  doubts?: { open: number; total: number; first?: string };
  /** what its chats are doing now (see «Live status» below); absent when there is nothing to say beyond `state` */
  live?: PlanLive;
}
/** One plan, whole: the record, its steps as shown and its versions. */
export interface PlanFull {
  record: Plan; info: PlanInfo; steps: PlanStepView[]; history: PlanVersionInfo[];
  /** the questions its chats asked (ADR 0344): the open ones first, then who answered and why; none on an earlier version */
  questions: PlanAsk[];
}
/** A question a chat of the map asked, as it went up (ADR 0344). */
export interface PlanAsk {
  chatId: string;
  title: string;
  /** the step it works for */
  n?: number;
  question: LadderQuestion;
}

export const PLAN_LIMITS = { title: 160, idea: 4000, goal: 2000, why: 2000, project: 64, summary: 200, by: 80, constraints: 20, constraint: 300, links: 40, from: 30, past: 12, change: 2000 } as const;
export const PLAN_ID = /^pl_[a-z0-9]{6,24}$/;

/** Steps the plan already started (under way, blocked or done). */
const started = (p: StrategyPlan): boolean => p.steps.some(s => s.state !== 'todo' && s.state !== 'cancelled');

/** The state a record is in: the only place it is decided. */
export function planStateOf(m: Pick<Plan, 'plan' | 'owner' | 'stopped' | 'finishedAt' | 'archivedAt'>): PlanState {
  if (m.archivedAt !== undefined) return 'archived';
  if (m.finishedAt !== undefined) return 'finished';
  if (m.stopped) return 'stopped';
  const p = m.plan;
  if (!p) return m.owner ? 'running' : 'idea';
  switch (p.phase) {
    case 'asking': return 'idea';
    case 'proposed': return 'toApprove';
    case 'revising': return started(p) ? 'running' : 'idea';
    case 'approved': return 'planned';
    case 'running': return 'running';
    case 'done': return 'finished';
  }
}

/** What the user can do on it now. */
export function planActions(m: Plan): PlanAction[] {
  const s = m.state;
  if (m.deletedAt !== undefined) return ['restore'];
  if (s === 'archived') return ['reopen', 'delete'];
  if (s === 'finished') return [...(m.seenAt === undefined ? ['seen' as const] : []), ...(m.plan && m.owner ? ['replan' as const] : []), 'archive'];
  if (s === 'stopped') return ['resume', 'archive'];
  // a replan whose started steps go on: it can be stopped, never put away under them
  const going: PlanAction[] = m.plan && started(m.plan) ? ['stop'] : ['archive'];
  if (s === 'toApprove') return ['approve', 'keep', 'replan', ...going];
  if (s === 'planned') return ['start', 'replan', ...going];
  if (s === 'running') return ['stop', ...(m.plan ? ['replan' as const] : [])];
  return m.owner ? ['stop', 'replan', 'archive'] : ['start', 'archive'];
}

/** The plan's steps as the page shows them, in order. */
export function stepViews(plan: StrategyPlan | undefined): PlanStepView[] {
  if (!plan) return [];
  const steps = plan.steps, turns = turnsOf(steps), numberOf = (id: string) => steps.findIndex(x => x.id === id) + 1;
  return steps.map((s, i) => ({
    n: i + 1, id: s.id, title: s.title, ...(s.detail ? { detail: s.detail } : {}), ...(s.role ? { role: s.role } : {}), ...(s.preset ? { preset: s.preset } : {}),
    turn: turns[i]!, ...(turns.filter(t => t === turns[i]).length > 1 ? { par: true as const } : {}), state: s.state, ...(s.proof ? { proof: s.proof } : {}),
    after: (s.after ?? []).map(numberOf).filter(n => n > 0), waitsFor: waitingFor(steps, i), opens: opens(steps, i), touches: [...(s.touches ?? [])], ...(s.minutes ? { minutes: s.minutes } : {}),
    chatIds: [...(s.chatIds ?? [])], ...(s.startedAt ? { startedAt: s.startedAt } : {}), ...(s.endedAt ? { endedAt: s.endedAt } : {}), ...(s.added ? { added: true as const } : {}), ...(s.drop ? { drop: true as const } : {}),
  }));
}

function doubtsOf(m: Plan): Pick<PlanInfo, 'doubts'> {
  const total = m.plan?.doubts?.length ?? 0, open = m.plan && m.state !== 'finished' && m.state !== 'archived' ? openDoubts(m.plan) : [];
  return total ? { doubts: { open: open.length, total, ...(open[0] ? { first: open[0].text } : {}) } } : {};
}

export function planInfo(m: Plan): PlanInfo {
  const all = m.plan?.steps ?? [], steps = all.filter(s => !s.drop && s.state !== 'cancelled'), n = (st: StepState) => steps.filter(s => s.state === st).length;
  const go = m.plan && (m.state === 'running' || m.state === 'planned' || m.state === 'toApprove') ? readySteps(all) : [], time = timeOf(all);
  const p = m.plan?.phase, live = m.state === 'idea' || m.state === 'running';
  return {
    id: m.id, title: m.title, ...(m.project ? { project: m.project } : {}), state: m.state, ...(m.deletedAt !== undefined ? { deleted: true as const } : {}),
    ...(live && (p === 'asking' || p === 'revising') ? { planning: true as const } : {}),
    ...(m.state === 'toApprove' && m.plan && started(m.plan) ? { replanned: true as const } : {}),
    ...(m.owner ? { ownerChatId: m.owner.chatId } : {}), ...(m.state === 'toApprove' && m.plan ? { planAt: m.plan.at } : {}),
    steps: steps.length, done: n('done'), now: n('now'), blocked: n('blocked'), partial: n('partial'), check: n('check'), percent: m.plan ? progressOf(all).percent : 0,
    ...(go.length ? { next: { n: go[0]! + 1, title: all[go[0]!]!.title } } : {}), ready: go.length, ...(time ? { time } : {}),
    ...(m.stopped && m.state === 'stopped' ? { stopped: { ...m.stopped } } : {}),
    createdAt: m.createdAt, updatedAt: m.updatedAt, ...(m.finishedAt !== undefined ? { finishedAt: m.finishedAt } : {}), ...(m.seenAt !== undefined ? { seenAt: m.seenAt } : {}), ...(m.archivedAt !== undefined ? { archivedAt: m.archivedAt } : {}),
    can: planActions(m), ...doubtsOf(m),
  };
}

// ---- Live status: what the chats of a map are doing now, read by the app from the chats themselves (main/plans/live.ts).
// Never saved as a version; `plans:changed` tells when it changes. It never says more than the app can see: what nobody
// vouches for is 'unknown' and stale, with the time of the last confirmation.

/** What a chat, a step or a map is doing:
 *  waiting = it waits for someone (`waits` says whom) · failed = its last turn ended on an error · closed = its chat was
 *  closed without a report · gone = its chat is not in the app any more · working = a turn (or its background work) runs ·
 *  interrupted = its turn was stopped and nothing followed · between = its turn is over, no report yet · blocked, partial,
 *  done = what it reported · unknown = nobody can say (after a restart, until the chat works again) */
export type PlanSay = 'waiting' | 'failed' | 'closed' | 'gone' | 'working' | 'interrupted' | 'between' | 'blocked' | 'partial' | 'done' | 'unknown';
/** user = an open question or permission that reached him, or its last answer waits for him · parent = its question is with
 *  the chat that delegated it, orchestrator = with the Orchestrator (the question ladder, ADR 0344: not the user's yet) ·
 *  colleagues = people or chats outside the job · work = work still running that the app does not see in its own chats ·
 *  credits = its model ran out of credits: the user changes the model on its role's card and it goes on (ADR 0346) */
export type PlanWaitFor = 'user' | 'credits' | 'parent' | 'orchestrator' | 'colleagues' | 'work';
/** The user must move: a question or permission of his, or a role card to change. */
export const waitsOnUser = (w: PlanWaitFor | undefined): boolean => w === 'user' || w === 'credits';
/** One chat of the map (its owner, a step's chat, or one these delegated) and what it is doing. */
export interface PlanWorker {
  chatId: string;
  title: string;
  say: PlanSay;
  /** say = waiting: for whom */
  waits?: PlanWaitFor;
  /** the step it works for; absent: the job itself (its owner chat) */
  n?: number;
  /** delegated by a step's chat, at any depth */
  below?: true;
}
/** One step, live. */
export interface StepLive {
  /** the one thing to show: what needs someone first, then who works */
  say: PlanSay;
  /** say = waiting: for whom */
  waits?: PlanWaitFor;
  /** its chats, what needs someone first (a step the Strategist does itself: the owner chat) */
  chats: PlanWorker[];
  /** nobody can vouch for it since then: show it as to be verified, with this time */
  stale?: number;
}
/** Why a map is stopped, beyond `stopped.by`: user = «Ferma» · closedByUser, closedByAgent, closedByApp = who closed its chat ·
 *  crash = its chat's engine died and did not come back · gone = its chat is not in the app any more · replaced = its chat
 *  moved to another job. The Orchestrator was told of closedByApp, crash and a gone that nobody closed by hand. */
export type PlanStopWhy = 'user' | 'closedByUser' | 'closedByAgent' | 'closedByApp' | 'crash' | 'gone' | 'replaced';
/** A whole map, live. */
export interface PlanLive {
  /** the one thing to show on its row, as on a step; absent on a map that nobody is expected to work on */
  say?: PlanSay;
  /** say = waiting: for whom */
  waits?: PlanWaitFor;
  /** the chats at work now */
  working: PlanWorker[];
  /** the chats that wait, for the user first */
  waiting: PlanWorker[];
  /** the chats whose last turn failed */
  failed: PlanWorker[];
  /** the chats of open steps closed without a report, or not in the app any more */
  lost: PlanWorker[];
  /** nobody can vouch for it since then: show it as to be verified, with this time */
  stale?: number;
  /** a stopped map: why */
  why?: PlanStopWhy;
}

/** The user must move: its plan waits for his ok, or a chat of it waits for him (a question an agent holds does not). */
export const waitsForUser = (i: Pick<PlanInfo, 'state' | 'live'>): boolean => i.state === 'toApprove' || (i.state === 'idea' || i.state === 'running') && waitsOnUser(i.live?.waits);

/** The order in which what a chat is doing matters to the user. */
export const PLAN_SAYS: readonly PlanSay[] = ['waiting', 'failed', 'closed', 'gone', 'working', 'blocked', 'interrupted', 'unknown', 'between', 'partial', 'done'];
const SAY_WORDS: Record<PlanSay, string> = { waiting: 'waiting', failed: 'its turn failed', closed: 'its chat was closed without a report', gone: 'its chat is not in the app any more', working: 'at work', blocked: 'reported blocked', interrupted: 'interrupted', unknown: 'unknown', between: 'turn over, no report yet', partial: 'reported partial', done: 'reported done' };
/** The live status in words, for an agent. */
export function liveWords(l: { say?: PlanSay; waits?: PlanWaitFor; stale?: number; why?: PlanStopWhy }): string {
  return [l.say ? `${SAY_WORDS[l.say]}${l.waits ? ` for ${l.waits}` : ''}` : '', l.why ? `why: ${l.why}` : '', l.stale !== undefined ? `not confirmed since ${new Date(l.stale).toISOString()}` : ''].filter(Boolean).join(', ');
}
// ---- end of the live status

const STATE_WORDS: Record<PlanState, string> = { idea: 'idea', toApprove: 'plan waits for the user', planned: 'approved, kept for later', running: 'under way', stopped: 'stopped', finished: 'finished', archived: 'archived' };
const STEP_WORDS: Record<StepState, string> = { todo: 'da fare', now: 'in corso', blocked: 'bloccato', partial: 'fatto in parte', done: 'fatto', cancelled: 'annullato', check: 'da verificare' };
/** A plan as text, for an agent that answers the user. */
export function planText(v: PlanFull): string {
  const { record: m, info } = v;
  return [
    `${m.title} (${m.id}, version ${m.version}): ${m.deletedAt !== undefined ? 'in the trash' : STATE_WORDS[m.state]}${info.planning ? ', being planned' : ''}${info.stopped ? ` by ${info.stopped.by}` : ''}${info.live && liveWords(info.live) ? ` · ${liveWords(info.live)}` : ''}`,
    ...(m.plan?.steps.length ? [`Progress: ${info.percent}% (${info.done} of ${info.steps} done${info.partial ? `, ${info.partial} in part` : ''}${info.check ? `, ${info.check} to verify` : ''})${info.time ? ` · about ${info.time.parallel} min in parallel, ${info.time.row} one after the other` : ''}`] : []),
    ...(m.project ? [`Project: ${m.project}`] : []),
    ...(m.owner ? [`Chat: ${m.owner.chatId}`] : ['No chat yet']),
    ...(m.goal ? [`Goal: ${m.goal}`] : []), ...(m.why ? [`Why: ${m.why}`] : []), ...(m.idea ? [`Idea: ${m.idea}`] : []),
    ...(m.constraints.length ? ['Constraints:', ...m.constraints.map(c => `- ${c}`)] : []),
    ...(m.links.length ? ['Files and links:', ...m.links.map(l => `- ${l.kind}: ${l.ref}${l.label ? ` (${l.label})` : ''}`)] : []),
    ...(v.steps.length ? ['Steps:', ...v.steps.map(b => `${b.n}. [turn ${b.turn}${b.waitsFor.length ? `, waits for ${b.waitsFor.join(', ')}` : ''}] ${b.title} · ${STEP_WORDS[b.state]}${b.role ? ` · ${b.role}` : ''}${b.preset ? ` · ${b.preset}` : ''}${b.proof ? ` · proof (${b.proof.by}): ${b.proof.text}` : ''}${b.drop ? ' · removed by the replan at the user’s ok' : ''}${b.live ? ` · now: ${liveWords(b.live)}` : ''}`)] : []),
    ...(m.plan?.clarified.length ? ['Answers:', ...m.plan.clarified.map(c => `- ${c.q} → ${c.a}`)] : []),
    ...(m.plan?.doubts?.length ? ['Doubts (one still open holds the approval):', ...m.plan.doubts.map(d => `- ${d.text} · ${d.state === 'open' ? 'open' : `closed by ${d.by}: ${d.answer} (${d.source})`}`)] : []),
    ...(v.questions.length ? ['Questions of its chats:', ...v.questions.map(q => `- ${q.title}${q.n ? ` (step ${q.n})` : ''}: ${ladderText(q.question).replace(/\s+/g, ' ')} · ${q.question.answered ? `answered by ${q.question.answered.name}: ${q.question.answered.answer} (${q.question.answered.why})` : q.question.level === 'user' ? 'waits for the user' : `with the ${q.question.level}`}`)] : []),
    `Now: ${info.can.join(', ')}`,
  ].join('\n');
}

/** A saved file, read leniently: what is not understood is left out; null = not a plan of that id. */
export function readPlanRecord(v: unknown, id: string): Plan | null {
  const m = v as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.id !== id || !PLAN_ID.test(id)) return null;
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
  const str = (x: unknown, max: number): x is string => typeof x === 'string' && !!x.trim() && x.length <= max;
  const strs = (x: unknown, max: number, each: number): string[] => (Array.isArray(x) ? [...new Set(x.filter((s): s is string => str(s, each)))].slice(0, max) : []);
  if (!Number.isSafeInteger(m.version) || (m.version as number) < 1 || !str(m.title, PLAN_LIMITS.title) || !num(m.createdAt)) return null;
  const plan = m.plan === undefined ? null : readPlan(m.plan);
  const o = m.owner as Record<string, unknown> | undefined;
  const owner = o && typeof o === 'object' && str(o.chatId, 80) && str(o.task, 120) ? { chatId: o.chatId, task: o.task } : undefined;
  const s = m.stopped as Record<string, unknown> | undefined;
  const stopped = s && typeof s === 'object' && num(s.at) && PLAN_STOPS.includes(s.by as PlanStopBy) ? { at: s.at, by: s.by as PlanStopBy } : undefined;
  const past = strs(m.past, PLAN_LIMITS.past, 80), constraints = strs(m.constraints, PLAN_LIMITS.constraints, PLAN_LIMITS.constraint), from = strs(m.from, PLAN_LIMITS.from, 160);
  const links = (Array.isArray(m.links) ? m.links : []).flatMap((l: Record<string, unknown>) => l && ['file', 'link', 'plan', 'chat'].includes(String(l.kind)) && str(l.ref, 500) ? [{ kind: l.kind as PlanLink['kind'], ref: l.ref, ...(str(l.label, 160) ? { label: l.label } : {}) }] : []).slice(0, PLAN_LIMITS.links);
  const out: Omit<Plan, 'state'> = {
    id, version: m.version as number, title: m.title, ...(str(m.idea, PLAN_LIMITS.idea) ? { idea: m.idea } : {}), ...(str(m.goal, PLAN_LIMITS.goal) ? { goal: m.goal } : {}), ...(str(m.why, PLAN_LIMITS.why) ? { why: m.why } : {}), ...(str(m.project, PLAN_LIMITS.project) ? { project: m.project } : {}),
    constraints, links, ...(from.length ? { from } : {}), ...(num(m.deletedAt) ? { deletedAt: m.deletedAt } : {}), ...(owner ? { owner } : {}), ...(past.length ? { past } : {}), ...(plan ? { plan } : {}), ...(stopped ? { stopped } : {}),
    ...(num(m.finishedAt) ? { finishedAt: m.finishedAt } : {}), ...(num(m.seenAt) ? { seenAt: m.seenAt } : {}), ...(num(m.archivedAt) ? { archivedAt: m.archivedAt } : {}),
    createdAt: m.createdAt, updatedAt: num(m.updatedAt) ? m.updatedAt : m.createdAt, by: str(m.by, PLAN_LIMITS.by) ? m.by : 'app', summary: str(m.summary, PLAN_LIMITS.summary) ? m.summary : '',
  };
  return { ...out, state: planStateOf(out) };
}
