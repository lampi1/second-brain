// What the plans' screens know, with no screen (ADR 0359): how the list is grouped by status, searched, filtered and
// sorted; which IPC call each button makes; which of a chat's plans is its own; the steps laid out in turns (what runs
// together, what waits for what). The buttons a plan shows are only those of PlanInfo.can. Pure, pinned by
// test/unit/plans/list.test.ts; used by components/plans/*, store/plans.ts, actions.ts, lib/where.ts and StrategyPanel.tsx.
import { waitsForUser, waitsOnUser, type PlanAction, type PlanInfo, type PlanSay, type PlanState, type PlanStepView, type PlanWaitFor } from '@shared/plan';

/** The groups of the list, in the order the user decided: what waits for them first, the finished last (closed by default). */
export const PLAN_GROUPS = ['wait', 'running', 'stopped', 'idea', 'finished'] as const;
export type PlanGroup = (typeof PLAN_GROUPS)[number];
const GROUP: Record<PlanState, PlanGroup> = { toApprove: 'wait', running: 'running', stopped: 'stopped', planned: 'idea', idea: 'idea', finished: 'finished', archived: 'finished' };
/** A job under way whose chat waits for the user is with what waits for them. */
export const groupOf = (i: Pick<PlanInfo, 'state' | 'live'>): PlanGroup => (waitsForUser(i) ? 'wait' : GROUP[i.state]);

/** How a live status is coloured: it waits for the user, for others, somebody works, something is wrong, done, not known. */
export type LiveKind = 'you' | 'wait' | 'work' | 'bad' | 'ok' | 'dim';
const KIND: Record<PlanSay, LiveKind> = { waiting: 'wait', failed: 'bad', closed: 'bad', gone: 'bad', blocked: 'bad', working: 'work', done: 'ok', interrupted: 'dim', unknown: 'dim', between: 'dim', partial: 'dim' };
export const liveKind = (l: { say?: PlanSay; waits?: PlanWaitFor; stale?: number }): LiveKind => (l.stale !== undefined || !l.say ? 'dim' : l.say === 'waiting' && waitsOnUser(l.waits) ? 'you' : KIND[l.say]);

/** Why «approve», «keep» and «start» wait: the first open doubt and how many are open; null = nothing holds them. */
export const heldBy = (i: Pick<PlanInfo, 'doubts'>): { n: number; first: string } | null => (i.doubts?.open ? { n: i.doubts.open, first: i.doubts.first ?? '' } : null);
export const HELD_ACTIONS: readonly PlanAction[] = ['approve', 'keep', 'start'];

export type PlanSort = 'recent' | 'oldest' | 'title' | 'progress';
export const PLAN_SORTS: readonly PlanSort[] = ['recent', 'oldest', 'title', 'progress'];
export interface PlanFilter { trash: boolean; query: string; /** '' = every project */ project: string; sort: PlanSort }

/** The projects of the filter, by name. */
export const allProjects = (infos: readonly PlanInfo[]): string[] => [...new Set(infos.flatMap(i => (i.project ? [i.project] : [])))].sort((a, b) => a.localeCompare(b));

const ORDER: Record<PlanSort, (a: PlanInfo, b: PlanInfo) => number> = {
  recent: (a, b) => b.updatedAt - a.updatedAt,
  oldest: (a, b) => a.updatedAt - b.updatedAt,
  title: (a, b) => a.title.localeCompare(b.title),
  progress: (a, b) => b.percent - a.percent || b.updatedAt - a.updatedAt,
};

/** The list as it is drawn: the groups with something in them (the trash is its own list, a flat one under «finished»'s place). */
export function arrange(infos: readonly PlanInfo[], f: PlanFilter): { group: PlanGroup; items: PlanInfo[] }[] {
  const kept = infos.filter(i => !!i.deleted === f.trash && (!f.project || i.project === f.project));
  if (f.trash) return kept.length ? [{ group: 'finished', items: [...kept].sort((a, b) => ORDER[f.sort](a, b) || a.id.localeCompare(b.id)) }] : [];
  return PLAN_GROUPS.flatMap(group => {
    const items = kept.filter(i => groupOf(i) === group).sort((a, b) => ORDER[f.sort](a, b) || a.id.localeCompare(b.id));
    return items.length ? [{ group, items }] : [];
  });
}

/** Of a chat's plans, the one of the job it is on now (main/plans/service.ts ofChat, on the list's rows). */
export function mapOfChat(infos: readonly PlanInfo[], chatId: string): PlanInfo | null {
  const mine = infos.filter(i => i.ownerChatId === chatId && !i.deleted);
  return mine.find(i => i.stopped?.by !== 'replaced' && i.state !== 'archived') ?? mine[mine.length - 1] ?? null;
}

/** The buttons of a plan in the order they are drawn; `seen` is never one (opening a finished plan says it). */
export type PlanButton = Exclude<PlanAction, 'seen'>;
export const PLAN_BUTTONS: readonly PlanButton[] = ['approve', 'keep', 'start', 'resume', 'replan', 'stop', 'reopen', 'archive', 'delete', 'restore'];
export const buttonsOf = (i: Pick<PlanInfo, 'can'>): PlanButton[] => PLAN_BUTTONS.filter(a => i.can.includes(a));
/** The buttons of a row: «Apri» is the row itself. */
export const ROW_BUTTONS: readonly PlanButton[] = ['resume', 'replan', 'archive', 'delete', 'restore'];

/** The versions «Versione» lists under «Adesso», the newest first: never the last one, which is «Adesso» itself. */
export const earlier = <T extends { version: number }>(history: readonly T[]): T[] => [...history].sort((a, b) => b.version - a.version).slice(1);

export type PlanCall =
  | { channel: 'plans:approve' | 'plans:keep'; args: { id: string; at: number } }
  | { channel: 'plans:replan'; args: { id: string; text: string } }
  | { channel: 'plans:start' | 'plans:stop' | 'plans:resume' | 'plans:archive' | 'plans:reopen' | 'plans:seen' | 'plans:delete' | 'plans:restore'; args: { id: string } };
/** The IPC call of an action; null = the plan does not allow it, or it misses what it needs (the plan's revision on screen,
 *  the words of a replan), or an open doubt holds it. */
export function callOf(i: Pick<PlanInfo, 'id' | 'can' | 'planAt' | 'doubts'>, action: PlanAction, text = ''): PlanCall | null {
  if (!i.can.includes(action) || heldBy(i) && HELD_ACTIONS.includes(action)) return null;
  const id = i.id;
  if (action === 'approve' || action === 'keep') return i.planAt === undefined ? null : { channel: `plans:${action}`, args: { id, at: i.planAt } };
  if (action === 'replan') return text.trim() ? { channel: 'plans:replan', args: { id, text: text.trim() } } : null;
  return { channel: `plans:${action}`, args: { id } };
}

/** The chats a step carries: its own, then those these delegated that work, wait or failed now. */
export const chatsOf = (b: Pick<PlanStepView, 'chatIds' | 'live'>): string[] => [...new Set([...b.chatIds, ...(b.live?.chats ?? []).filter(w => w.below && ['working', 'waiting', 'failed'].includes(w.say)).map(w => w.chatId)])];

/** The steps in turns: the steps of one turn may run together; the steps a replan takes away are apart. `lane`: how many
 *  run side by side in the widest turn. */
export interface PlanTurn { turn: number; steps: PlanStepView[]; together: boolean }
export function turnsOf(steps: readonly PlanStepView[]): { turns: PlanTurn[]; dropped: PlanStepView[]; lanes: number } {
  const live = steps.filter(s => !s.drop), numbers = [...new Set(live.map(s => s.turn))].sort((a, b) => a - b);
  const turns = numbers.map(turn => { const own = live.filter(s => s.turn === turn); return { turn, steps: own, together: own.length > 1 }; });
  return { turns, dropped: steps.filter(s => s.drop), lanes: Math.max(1, ...turns.map(t => t.steps.length)) };
}

/** The state words of a step, for the list and the tests. */
export const STEP_TONE: Record<PlanStepView['state'], 'todo' | 'now' | 'ok' | 'part' | 'bad' | 'off' | 'check'> = { todo: 'todo', now: 'now', done: 'ok', partial: 'part', blocked: 'bad', cancelled: 'off', check: 'check' };

/** «12 min» or «1 h 20»; the time one after the other and in parallel, when every step has an estimate. */
export function minutesText(n: number): string { return n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60}` : ''}` : `${n} min`; }
