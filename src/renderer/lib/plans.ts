// What the work maps' screens know, with no screen (ADR 0342, 0343): how the list is grouped by status, searched,
// filtered and sorted; which place of the Mappa page a map is (`lavori/<id>`); which IPC call each button makes; which
// of a chat's maps is its own; how the boxes of a plan are laid in rows. The buttons a map shows are only those of
// PlanInfo.can. Pure, pinned by test/unit/work-maps-list.test.ts; used by components/plans/*, store/plans.ts,
// actions.ts, lib/where.ts and StrategyPanel.tsx.
import { waitsForUser, waitsOnUser, type WorkBox, type WorkLink, type PlanAction, type PlanInfo, type PlanState, type PlanSay, type PlanWaitFor } from '@shared/plan';

/** The place of the work maps in the Mappa page: `lavori`, or `lavori/<id>`. */
export const WORKS = 'lavori';
export const planPlace = (id?: string | null): string => (id ? `${WORKS}/${id}` : WORKS);
/** null = not a work maps' place; `id` null = the list. */
export function planPlaceOf(arg: string | null | undefined): { id: string | null } | null {
  if (arg === WORKS) return { id: null };
  return arg?.startsWith(`${WORKS}/`) ? { id: arg.slice(WORKS.length + 1) || null } : null;
}

/** The sections of the list, in the order the user decided (2026-11-23): what waits for them first, the finished last. */
export const WORK_GROUPS = ['wait', 'running', 'stopped', 'planned', 'idea', 'finished'] as const;
export type PlanGroup = (typeof WORK_GROUPS)[number];
const GROUP: Record<PlanState, PlanGroup> = { toApprove: 'wait', running: 'running', stopped: 'stopped', planned: 'planned', idea: 'idea', finished: 'finished', archived: 'finished' };
/** A job under way whose chat waits for the user is with what waits for him. */
export const groupOf = (i: Pick<PlanInfo, 'state' | 'live'>): PlanGroup => (waitsForUser(i) ? 'wait' : GROUP[i.state]);

/** How a live status is coloured: it waits for the user, for others, somebody works, something is wrong, done, not known. */
export type LiveKind = 'you' | 'wait' | 'work' | 'bad' | 'ok' | 'dim';
const KIND: Record<PlanSay, LiveKind> = { waiting: 'wait', failed: 'bad', closed: 'bad', gone: 'bad', blocked: 'bad', working: 'work', done: 'ok', interrupted: 'dim', unknown: 'dim', between: 'dim', partial: 'dim' };
export const liveKind = (l: { say?: PlanSay; waits?: PlanWaitFor; stale?: number }): LiveKind => (l.stale !== undefined || !l.say ? 'dim' : l.say === 'waiting' && waitsOnUser(l.waits) ? 'you' : KIND[l.say]);

/** Why «approve», «keep» and «start» wait: the first open doubt and how many are open; null = nothing holds them. */
export const heldBy = (i: Pick<PlanInfo, 'doubts'>): { n: number; first: string } | null => (i.doubts?.open ? { n: i.doubts.open, first: i.doubts.first ?? '' } : null);
export const HELD_ACTIONS: readonly PlanAction[] = ['approve', 'keep', 'start'];

export type PlanTab = 'open' | 'finished';
export type PlanSort = 'recent' | 'oldest' | 'title' | 'progress';
export const PLAN_SORTS: readonly PlanSort[] = ['recent', 'oldest', 'title', 'progress'];
export interface PlanFilter { tab: PlanTab; query: string; /** '' = every project */ project: string; sort: PlanSort }

/** Every label a map is found under: its project first, then the project maps it touches. */
export const projectsOf = (i: Pick<PlanInfo, 'project' | 'touches'>): string[] => [...new Set([...(i.project ? [i.project] : []), ...i.touches])];
/** The projects of the filter, by name. */
export const allProjects = (infos: readonly PlanInfo[]): string[] => [...new Set(infos.flatMap(projectsOf))].sort((a, b) => a.localeCompare(b));

const part = (i: PlanInfo): number => (i.steps ? i.done / i.steps : 0);
const ORDER: Record<PlanSort, (a: PlanInfo, b: PlanInfo) => number> = {
  recent: (a, b) => b.updatedAt - a.updatedAt,
  oldest: (a, b) => a.updatedAt - b.updatedAt,
  title: (a, b) => a.title.localeCompare(b.title),
  progress: (a, b) => part(b) - part(a) || b.updatedAt - a.updatedAt,
};

/** The list as it is drawn: the sections with something in them. With words to search both tabs are searched (`infos` is
 *  then what main found: it also reads the ideas and the steps' titles, which a row does not carry). */
export function arrange(infos: readonly PlanInfo[], f: PlanFilter): { group: PlanGroup; items: PlanInfo[] }[] {
  const all = !!f.query.trim();
  const kept = infos.filter(i => (!f.project || projectsOf(i).includes(f.project)) && (all || (f.tab === 'finished') === (groupOf(i) === 'finished')));
  return WORK_GROUPS.flatMap(group => {
    const items = kept.filter(i => groupOf(i) === group).sort((a, b) => ORDER[f.sort](a, b) || a.id.localeCompare(b.id));
    return items.length ? [{ group, items }] : [];
  });
}

/** Of a chat's maps, the one of the job it is on now (main/plans/service.ts ofChat, on the list's rows). */
export function mapOfChat(infos: readonly PlanInfo[], chatId: string): PlanInfo | null {
  const mine = infos.filter(i => i.ownerChatId === chatId);
  return mine.find(i => i.stopped?.by !== 'replaced' && i.state !== 'archived') ?? mine[mine.length - 1] ?? null;
}

/** The buttons in the order they are drawn; `seen` is never one (opening a finished map says it). */
export const PLAN_BUTTONS: readonly Exclude<PlanAction, 'seen'>[] = ['approve', 'keep', 'start', 'resume', 'replan', 'stop', 'reopen', 'archive'];
export const buttonsOf = (i: Pick<PlanInfo, 'can'>): Exclude<PlanAction, 'seen'>[] => PLAN_BUTTONS.filter(a => i.can.includes(a));

/** The versions «Versione» lists under «Adesso», the newest first: never the last one, which is «Adesso» itself, whatever
 *  version is on screen. */
export const earlier = <T extends { version: number }>(history: readonly T[]): T[] => [...history].sort((a, b) => b.version - a.version).slice(1);

export type PlanCall =
  | { channel: 'plans:approve' | 'plans:keep'; args: { id: string; at: number } }
  | { channel: 'plans:replan'; args: { id: string; text: string } }
  | { channel: 'plans:start' | 'plans:stop' | 'plans:resume' | 'plans:archive' | 'plans:reopen' | 'plans:seen'; args: { id: string } };
/** The IPC call of an action; null = the map does not allow it, or it misses what it needs (the plan's revision on
 *  screen, the words of a replan), or an open doubt holds it. */
export function callOf(i: Pick<PlanInfo, 'id' | 'can' | 'planAt' | 'doubts'>, action: PlanAction, text = ''): PlanCall | null {
  if (!i.can.includes(action) || heldBy(i) && HELD_ACTIONS.includes(action)) return null;
  const id = i.id;
  if (action === 'approve' || action === 'keep') return i.planAt === undefined ? null : { channel: `plans:${action}`, args: { id, at: i.planAt } };
  if (action === 'replan') return text.trim() ? { channel: 'plans:replan', args: { id, text: text.trim() } } : null;
  return { channel: `plans:${action}`, args: { id } };
}

/** The chats a box carries: its own, then those these delegated that work, wait or failed now. */
export const chatsOf = (b: Pick<WorkBox, 'chatIds' | 'live'>): string[] => [...new Set([...b.chatIds, ...(b.live?.chats ?? []).filter(w => w.below && ['working', 'waiting', 'failed'].includes(w.say)).map(w => w.chatId)])];

/** One row of the drawing: the boxes of one turn. `in`/`out` = an arrow comes into it, goes out of it. */
export interface PlanRow { wave: number; boxes: WorkBox[]; in: boolean; out: boolean }
/** The boxes in rows, turn by turn; the steps a replan takes away are apart (they lead nowhere). */
export function rowsOf(boxes: readonly WorkBox[], links: readonly WorkLink[]): { rows: PlanRow[]; dropped: WorkBox[] } {
  const live = boxes.filter(b => !b.drop), waves = [...new Set(live.map(b => b.wave))].sort((a, b) => a - b);
  const to = new Set(links.map(l => l.to)), from = new Set(links.map(l => l.from));
  return {
    rows: waves.map(wave => { const own = live.filter(b => b.wave === wave); return { wave, boxes: own, in: own.some(b => to.has(b.n)), out: own.some(b => from.has(b.n)) }; }),
    dropped: boxes.filter(b => b.drop),
  };
}
