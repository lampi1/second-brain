// A work map (ADR 0342): the map of ONE Strategist job, or of an idea nobody works on yet. The app creates and keeps it in
// code (main/workmap/service.ts), with no tool call from the agent, and it holds the job's plan itself, so it outlives the
// chat. Its lifecycle: idea → toApprove → planned → running → stopped | finished → archived. This file is the contract the
// screen, the live status and the tools build on: the record, its list row and view, how the state is derived, which
// actions a map allows now, the boxes and arrows drawn from the plan, and the lenient reader of a saved file. Pure: used
// by main/workmap/*, shared/contract/brain.ts and the renderer; pinned by test/unit/workmap-shared.test.ts.
import type { DelegationOutcome } from './delegation';
import type { PresetId } from './model-presets';
import type { MapVersionInfo } from './project-map';
import type { WorkRoleId } from './roles';
import { planWaves, readPlan, type StepState, type StrategyPlan } from './strategy';

/** idea = written down, or its Strategist is still asking (`planning`) · toApprove = its plan waits for the user ·
 *  planned = approved, not started · running = under way · stopped = the user stopped it, or its chat was closed ·
 *  finished = every step done (or the job reported) · archived = finished and seen, or put away by the user */
export type WorkMapState = 'idea' | 'toApprove' | 'planned' | 'running' | 'stopped' | 'finished' | 'archived';
export const WORK_MAP_STATES: readonly WorkMapState[] = ['idea', 'toApprove', 'planned', 'running', 'stopped', 'finished', 'archived'];

/** user = «Ferma» · closed = its owner chat was closed, by the user or by the app with steps still open ·
 *  gone = its owner chat is no longer in the app · replaced = the owner chat moved on to another job */
export type WorkMapStopBy = 'user' | 'closed' | 'gone' | 'replaced';
export const WORK_MAP_STOPS: readonly WorkMapStopBy[] = ['user', 'closed', 'gone', 'replaced'];

/** The Strategist chat the job belongs to; `task` = the job within that chat (a chat can get a second job). */
export interface WorkMapOwner { chatId: string; task: string }

/** One work map as saved (userData/work-maps/<id>/map.json); every real change is a new version. */
export interface WorkMap {
  id: string;
  version: number;
  title: string;
  /** the idea or the request in words (absent when only the title says it) */
  idea?: string;
  /** the label it is grouped under: a project map's folder name, or a name the user gave */
  project?: string;
  /** the project maps its work touches (folder names) */
  touches: string[];
  owner?: WorkMapOwner;
  /** earlier owner chats of the same job (continued, or the job was resumed in a new chat) */
  past?: string[];
  /** the job's plan as it is now, steps and answers included; absent: an idea, or a job with no plan */
  plan?: StrategyPlan;
  state: WorkMapState;
  stopped?: { at: number; by: WorkMapStopBy };
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
export type WorkMapAction = 'approve' | 'keep' | 'start' | 'stop' | 'resume' | 'replan' | 'archive' | 'reopen' | 'seen';

/** One step as a box of the drawing. */
export interface WorkBox {
  /** the step's number, from 1 */
  n: number;
  title: string;
  detail?: string;
  role?: WorkRoleId;
  model?: string;
  preset?: PresetId;
  /** its turn, from 1: boxes of one turn run together */
  wave: number;
  /** it shares its turn with other boxes */
  par?: true;
  state: StepState;
  outcome?: DelegationOutcome;
  /** the element of the project map it works on */
  on?: string;
  chatIds: string[];
  startedAt?: number;
  endedAt?: number;
  /** found on the way, after the approval */
  added?: true;
  /** the replan takes it away; it goes on until the user's ok */
  drop?: true;
  /** what its chats are doing now (see «Live status» below); absent when there is nothing to say beyond `state` */
  live?: WorkBoxLive;
}
/** An arrow between two boxes, by step number. */
export interface WorkLink { from: number; to: number }

/** A row of the list. */
export interface WorkMapInfo {
  id: string;
  title: string;
  project?: string;
  touches: string[];
  state: WorkMapState;
  /** an idea whose Strategist is asking or drawing the plan now, or a job being replanned */
  planning?: true;
  /** the plan waiting for the user replaces one whose steps already started */
  replanned?: true;
  ownerChatId?: string;
  /** the plan waits for an answer at this revision (`at` of approve and keep) */
  planAt?: number;
  steps: number; done: number; now: number; blocked: number;
  stopped?: { at: number; by: WorkMapStopBy };
  createdAt: number; updatedAt: number; finishedAt?: number; seenAt?: number; archivedAt?: number;
  can: WorkMapAction[];
  /** what its chats are doing now (see «Live status» below); absent when there is nothing to say beyond `state` */
  live?: WorkMapLive;
}
/** One map, whole: the record, its drawing and its versions. */
export interface WorkMapView { map: WorkMap; info: WorkMapInfo; boxes: WorkBox[]; links: WorkLink[]; history: MapVersionInfo[] }

export const WORK_MAP_LIMITS = { title: 160, idea: 4000, project: 64, summary: 200, by: 80, touches: 12, past: 12, change: 2000 } as const;
export const WORK_MAP_ID = /^wm_[a-z0-9]{6,24}$/;

/** Steps the plan already started (under way, blocked or done). */
const started = (p: StrategyPlan): boolean => p.steps.some(s => s.state !== 'todo');

/** The state a record is in: the only place it is decided. */
export function workStateOf(m: Pick<WorkMap, 'plan' | 'owner' | 'stopped' | 'finishedAt' | 'archivedAt'>): WorkMapState {
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
export function workActions(m: WorkMap): WorkMapAction[] {
  const s = m.state;
  if (s === 'archived') return ['reopen'];
  if (s === 'finished') return [...(m.seenAt === undefined ? ['seen' as const] : []), ...(m.plan && m.owner ? ['replan' as const] : []), 'archive'];
  if (s === 'stopped') return ['resume', 'archive'];
  // a replan whose started steps go on: it can be stopped, never put away under them
  const going: WorkMapAction[] = m.plan && started(m.plan) ? ['stop'] : ['archive'];
  if (s === 'toApprove') return ['approve', 'keep', 'replan', ...going];
  if (s === 'planned') return ['start', 'replan', ...going];
  if (s === 'running') return ['stop', ...(m.plan ? ['replan' as const] : [])];
  return m.owner ? ['stop', 'replan', 'archive'] : ['start', 'archive'];
}

/** The plan's steps as boxes, in order. */
export function workBoxes(plan: StrategyPlan | undefined): WorkBox[] {
  if (!plan) return [];
  const waves = planWaves(plan.steps);
  return plan.steps.map((s, i) => ({
    n: i + 1, title: s.title, ...(s.detail ? { detail: s.detail } : {}), ...(s.role ? { role: s.role } : {}), ...(s.model ? { model: s.model } : {}), ...(s.preset ? { preset: s.preset } : {}),
    wave: waves[i]!, ...(waves.filter(w => w === waves[i]).length > 1 ? { par: true as const } : {}), state: s.state, ...(s.outcome ? { outcome: s.outcome } : {}), ...(s.on ? { on: s.on } : {}),
    chatIds: [...(s.chatIds ?? [])], ...(s.startedAt ? { startedAt: s.startedAt } : {}), ...(s.endedAt ? { endedAt: s.endedAt } : {}), ...(s.added ? { added: true as const } : {}), ...(s.drop ? { drop: true as const } : {}),
  }));
}

/** The drawing of a map: its steps; a map with no plan yet is one box, the job itself. */
export function drawingOf(m: Pick<WorkMap, 'plan' | 'title' | 'owner' | 'state' | 'createdAt' | 'finishedAt'>): { boxes: WorkBox[]; links: WorkLink[] } {
  const boxes = workBoxes(m.plan);
  if (!boxes.length) {
    const state: StepState = m.state === 'finished' || m.state === 'archived' && m.finishedAt !== undefined ? 'done' : m.state === 'running' ? 'now' : 'todo';
    return { boxes: [{ n: 1, title: m.title, wave: 1, state, chatIds: m.owner ? [m.owner.chatId] : [], ...(m.owner ? { startedAt: m.createdAt } : {}), ...(m.finishedAt ? { endedAt: m.finishedAt } : {}) }], links: [] };
  }
  // a step the replan drops leads nowhere and nothing waits for it
  const live = boxes.filter(b => !b.drop), links: WorkLink[] = [];
  for (const b of live) for (const a of live) if (a.wave === b.wave - 1) links.push({ from: a.n, to: b.n });
  return { boxes, links };
}

export function workInfo(m: WorkMap): WorkMapInfo {
  const steps = (m.plan?.steps ?? []).filter(s => !s.drop), n = (st: StepState) => steps.filter(s => s.state === st).length;
  const p = m.plan?.phase, live = m.state === 'idea' || m.state === 'running';
  return {
    id: m.id, title: m.title, ...(m.project ? { project: m.project } : {}), touches: [...m.touches], state: m.state,
    ...(live && (p === 'asking' || p === 'revising') ? { planning: true as const } : {}),
    ...(m.state === 'toApprove' && m.plan && started(m.plan) ? { replanned: true as const } : {}),
    ...(m.owner ? { ownerChatId: m.owner.chatId } : {}), ...(m.state === 'toApprove' && m.plan ? { planAt: m.plan.at } : {}),
    steps: steps.length, done: n('done'), now: n('now'), blocked: n('blocked'),
    ...(m.stopped && m.state === 'stopped' ? { stopped: { ...m.stopped } } : {}),
    createdAt: m.createdAt, updatedAt: m.updatedAt, ...(m.finishedAt !== undefined ? { finishedAt: m.finishedAt } : {}), ...(m.seenAt !== undefined ? { seenAt: m.seenAt } : {}), ...(m.archivedAt !== undefined ? { archivedAt: m.archivedAt } : {}),
    can: workActions(m),
  };
}

// ---- Live status: what the chats of a map are doing now, read by the app from the chats themselves (main/workmap/live.ts).
// Never saved as a version; `workmap:changed` tells when it changes. It never says more than the app can see: what nobody
// vouches for is 'unknown' and stale, with the time of the last confirmation.

/** What a chat, a step or a map is doing:
 *  waiting = it waits for someone (`waits` says whom) · failed = its last turn ended on an error · closed = its chat was
 *  closed without a report · gone = its chat is not in the app any more · working = a turn (or its background work) runs ·
 *  interrupted = its turn was stopped and nothing followed · between = its turn is over, no report yet · blocked, partial,
 *  done = what it reported · unknown = nobody can say (after a restart, until the chat works again) */
export type WorkSay = 'waiting' | 'failed' | 'closed' | 'gone' | 'working' | 'interrupted' | 'between' | 'blocked' | 'partial' | 'done' | 'unknown';
/** user = an open question or permission that reached him, or its last answer waits for him · parent = its question is with
 *  the chat that delegated it, orchestrator = with the Orchestrator (the question ladder, ADR 0344: not the user's yet) ·
 *  colleagues = people or chats outside the job · work = work still running that the app does not see in its own chats */
export type WorkWaitFor = 'user' | 'parent' | 'orchestrator' | 'colleagues' | 'work';
/** One chat of the map (its owner, a step's chat, or one these delegated) and what it is doing. */
export interface WorkWorker {
  chatId: string;
  title: string;
  say: WorkSay;
  /** say = waiting: for whom */
  waits?: WorkWaitFor;
  /** the step it works for; absent: the job itself (its owner chat) */
  n?: number;
  /** delegated by a step's chat, at any depth */
  below?: true;
}
/** One step, live. */
export interface WorkBoxLive {
  /** the one thing to show: what needs someone first, then who works */
  say: WorkSay;
  /** say = waiting: for whom */
  waits?: WorkWaitFor;
  /** its chats, what needs someone first (a step the Strategist does itself: the owner chat) */
  chats: WorkWorker[];
  /** nobody can vouch for it since then: show it as to be verified, with this time */
  stale?: number;
}
/** Why a map is stopped, beyond `stopped.by`: user = «Ferma» · closedByUser, closedByAgent, closedByApp = who closed its chat ·
 *  crash = its chat's engine died and did not come back · gone = its chat is not in the app any more · replaced = its chat
 *  moved to another job. The Orchestrator was told of closedByApp, crash and a gone that nobody closed by hand. */
export type WorkStopWhy = 'user' | 'closedByUser' | 'closedByAgent' | 'closedByApp' | 'crash' | 'gone' | 'replaced';
/** A whole map, live. */
export interface WorkMapLive {
  /** the one thing to show on its row, as on a step; absent on a map that nobody is expected to work on */
  say?: WorkSay;
  /** the chats at work now */
  working: WorkWorker[];
  /** the chats that wait, for the user first */
  waiting: WorkWorker[];
  /** the chats whose last turn failed */
  failed: WorkWorker[];
  /** the chats of open steps closed without a report, or not in the app any more */
  lost: WorkWorker[];
  /** nobody can vouch for it since then: show it as to be verified, with this time */
  stale?: number;
  /** a stopped map: why */
  why?: WorkStopWhy;
}

/** The order in which what a chat is doing matters to the user. */
export const WORK_SAYS: readonly WorkSay[] = ['waiting', 'failed', 'closed', 'gone', 'working', 'blocked', 'interrupted', 'unknown', 'between', 'partial', 'done'];
const SAY_WORDS: Record<WorkSay, string> = { waiting: 'waiting', failed: 'its turn failed', closed: 'its chat was closed without a report', gone: 'its chat is not in the app any more', working: 'at work', blocked: 'reported blocked', interrupted: 'interrupted', unknown: 'unknown', between: 'turn over, no report yet', partial: 'reported partial', done: 'reported done' };
/** The live status in words, for an agent. */
export function liveWords(l: { say?: WorkSay; waits?: WorkWaitFor; stale?: number; why?: WorkStopWhy }): string {
  return [l.say ? `${SAY_WORDS[l.say]}${l.waits ? ` for ${l.waits}` : ''}` : '', l.why ? `why: ${l.why}` : '', l.stale !== undefined ? `not confirmed since ${new Date(l.stale).toISOString()}` : ''].filter(Boolean).join(', ');
}
// ---- end of the live status

const STATE_WORDS: Record<WorkMapState, string> = { idea: 'idea', toApprove: 'plan waits for the user', planned: 'approved, kept for later', running: 'under way', stopped: 'stopped', finished: 'finished', archived: 'archived' };
/** A map as text, for an agent that answers the user. */
export function workText(v: WorkMapView): string {
  const { map: m, info } = v, steps = m.plan?.steps.length ? v.boxes : [];
  return [
    `${m.title} (${m.id}, version ${m.version}): ${STATE_WORDS[m.state]}${info.planning ? ', being planned' : ''}${info.stopped ? ` by ${info.stopped.by}` : ''}${info.live && liveWords(info.live) ? ` · ${liveWords(info.live)}` : ''}`,
    ...(m.project || m.touches.length ? [`Project: ${[...new Set([...(m.project ? [m.project] : []), ...m.touches])].join(', ')}`] : []),
    ...(m.owner ? [`Chat: ${m.owner.chatId}`] : ['No chat yet']),
    ...(m.idea ? [`Idea: ${m.idea}`] : []),
    ...(steps.length ? [`Steps (${info.done} of ${info.steps} done):`, ...steps.map(b => `${b.n}. [turn ${b.wave}] ${b.title} · ${b.state}${b.role ? ` · ${b.role}` : ''}${b.model ? ` · ${b.model}` : ''}${b.preset ? ` · ${b.preset}` : ''}${b.drop ? ' · removed by the replan at the user’s ok' : ''}${b.live ? ` · now: ${liveWords(b.live)}` : ''}`)] : []),
    ...(m.plan?.clarified.length ? ['Answers:', ...m.plan.clarified.map(c => `- ${c.q} → ${c.a}`)] : []),
    `Now: ${info.can.join(', ')}`,
  ].join('\n');
}

/** A saved file, read leniently: what is not understood is left out; null = not a work map of that id. */
export function readWorkMap(v: unknown, id: string): WorkMap | null {
  const m = v as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.id !== id || !WORK_MAP_ID.test(id)) return null;
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
  const str = (x: unknown, max: number): x is string => typeof x === 'string' && !!x.trim() && x.length <= max;
  const strs = (x: unknown, max: number, each: number): string[] => (Array.isArray(x) ? [...new Set(x.filter((s): s is string => str(s, each)))].slice(0, max) : []);
  if (!Number.isSafeInteger(m.version) || (m.version as number) < 1 || !str(m.title, WORK_MAP_LIMITS.title) || !num(m.createdAt)) return null;
  const plan = m.plan === undefined ? null : readPlan(m.plan);
  const o = m.owner as Record<string, unknown> | undefined;
  const owner = o && typeof o === 'object' && str(o.chatId, 80) && str(o.task, 120) ? { chatId: o.chatId, task: o.task } : undefined;
  const s = m.stopped as Record<string, unknown> | undefined;
  const stopped = s && typeof s === 'object' && num(s.at) && WORK_MAP_STOPS.includes(s.by as WorkMapStopBy) ? { at: s.at, by: s.by as WorkMapStopBy } : undefined;
  const past = strs(m.past, WORK_MAP_LIMITS.past, 80);
  const out: Omit<WorkMap, 'state'> = {
    id, version: m.version as number, title: m.title, ...(str(m.idea, WORK_MAP_LIMITS.idea) ? { idea: m.idea } : {}), ...(str(m.project, WORK_MAP_LIMITS.project) ? { project: m.project } : {}),
    touches: strs(m.touches, WORK_MAP_LIMITS.touches, WORK_MAP_LIMITS.project), ...(owner ? { owner } : {}), ...(past.length ? { past } : {}), ...(plan ? { plan } : {}), ...(stopped ? { stopped } : {}),
    ...(num(m.finishedAt) ? { finishedAt: m.finishedAt } : {}), ...(num(m.seenAt) ? { seenAt: m.seenAt } : {}), ...(num(m.archivedAt) ? { archivedAt: m.archivedAt } : {}),
    createdAt: m.createdAt, updatedAt: num(m.updatedAt) ? m.updatedAt : m.createdAt, by: str(m.by, WORK_MAP_LIMITS.by) ? m.by : 'app', summary: str(m.summary, WORK_MAP_LIMITS.summary) ? m.summary : '',
  };
  return { ...out, state: workStateOf(out) };
}
