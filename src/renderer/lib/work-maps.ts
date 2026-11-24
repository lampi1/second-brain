// What the work maps' screens know, with no screen (ADR 0342, 0343): how the list is grouped by status, searched,
// filtered and sorted; which place of the Mappa page a map is (`lavori/<id>`); which IPC call each button makes; which
// of a chat's maps is its own; how the boxes of a plan are laid in rows. The buttons a map shows are only those of
// WorkMapInfo.can. Pure, pinned by test/unit/work-maps-list.test.ts; used by components/work-map/*, store/work-maps.ts,
// actions.ts, lib/where.ts and StrategyPanel.tsx.
import type { WorkBox, WorkLink, WorkMapAction, WorkMapInfo, WorkMapState } from '@shared/work-map';

/** The place of the work maps in the Mappa page: `lavori`, or `lavori/<id>`. */
export const WORKS = 'lavori';
export const workPlace = (id?: string | null): string => (id ? `${WORKS}/${id}` : WORKS);
/** null = not a work maps' place; `id` null = the list. */
export function workPlaceOf(arg: string | null | undefined): { id: string | null } | null {
  if (arg === WORKS) return { id: null };
  return arg?.startsWith(`${WORKS}/`) ? { id: arg.slice(WORKS.length + 1) || null } : null;
}

/** The sections of the list, in the order the user decided (2026-11-23): what waits for them first, the finished last. */
export const WORK_GROUPS = ['wait', 'running', 'stopped', 'planned', 'idea', 'finished'] as const;
export type WorkGroup = (typeof WORK_GROUPS)[number];
const GROUP: Record<WorkMapState, WorkGroup> = { toApprove: 'wait', running: 'running', stopped: 'stopped', planned: 'planned', idea: 'idea', finished: 'finished', archived: 'finished' };
export const groupOf = (i: Pick<WorkMapInfo, 'state'>): WorkGroup => GROUP[i.state];

export type WorkTab = 'open' | 'finished';
export type WorkSort = 'recent' | 'oldest' | 'title' | 'progress';
export const WORK_SORTS: readonly WorkSort[] = ['recent', 'oldest', 'title', 'progress'];
export interface WorkFilter { tab: WorkTab; query: string; /** '' = every project */ project: string; sort: WorkSort }

/** Every label a map is found under: its project first, then the project maps it touches. */
export const projectsOf = (i: Pick<WorkMapInfo, 'project' | 'touches'>): string[] => [...new Set([...(i.project ? [i.project] : []), ...i.touches])];
/** The projects of the filter, by name. */
export const allProjects = (infos: readonly WorkMapInfo[]): string[] => [...new Set(infos.flatMap(projectsOf))].sort((a, b) => a.localeCompare(b));

const part = (i: WorkMapInfo): number => (i.steps ? i.done / i.steps : 0);
const ORDER: Record<WorkSort, (a: WorkMapInfo, b: WorkMapInfo) => number> = {
  recent: (a, b) => b.updatedAt - a.updatedAt,
  oldest: (a, b) => a.updatedAt - b.updatedAt,
  title: (a, b) => a.title.localeCompare(b.title),
  progress: (a, b) => part(b) - part(a) || b.updatedAt - a.updatedAt,
};

/** The list as it is drawn: the sections with something in them. With words to search both tabs are searched (`infos` is
 *  then what main found: it also reads the ideas and the steps' titles, which a row does not carry). */
export function arrange(infos: readonly WorkMapInfo[], f: WorkFilter): { group: WorkGroup; items: WorkMapInfo[] }[] {
  const all = !!f.query.trim();
  const kept = infos.filter(i => (!f.project || projectsOf(i).includes(f.project)) && (all || (f.tab === 'finished') === (groupOf(i) === 'finished')));
  return WORK_GROUPS.flatMap(group => {
    const items = kept.filter(i => groupOf(i) === group).sort((a, b) => ORDER[f.sort](a, b) || a.id.localeCompare(b.id));
    return items.length ? [{ group, items }] : [];
  });
}

/** Of a chat's maps, the one of the job it is on now (main/workmap/service.ts ofChat, on the list's rows). */
export function mapOfChat(infos: readonly WorkMapInfo[], chatId: string): WorkMapInfo | null {
  const mine = infos.filter(i => i.ownerChatId === chatId);
  return mine.find(i => i.stopped?.by !== 'replaced' && i.state !== 'archived') ?? mine[mine.length - 1] ?? null;
}

/** The buttons in the order they are drawn; `seen` is never one (opening a finished map says it). */
export const WORK_BUTTONS: readonly Exclude<WorkMapAction, 'seen'>[] = ['approve', 'keep', 'start', 'resume', 'replan', 'stop', 'reopen', 'archive'];
export const buttonsOf = (i: Pick<WorkMapInfo, 'can'>): Exclude<WorkMapAction, 'seen'>[] => WORK_BUTTONS.filter(a => i.can.includes(a));

export type WorkCall =
  | { channel: 'workmap:approve' | 'workmap:keep'; args: { id: string; at: number } }
  | { channel: 'workmap:replan'; args: { id: string; text: string } }
  | { channel: 'workmap:start' | 'workmap:stop' | 'workmap:resume' | 'workmap:archive' | 'workmap:reopen' | 'workmap:seen'; args: { id: string } };
/** The IPC call of an action; null = the map does not allow it, or it misses what it needs (the plan's revision on
 *  screen, the words of a replan). */
export function callOf(i: Pick<WorkMapInfo, 'id' | 'can' | 'planAt'>, action: WorkMapAction, text = ''): WorkCall | null {
  if (!i.can.includes(action)) return null;
  const id = i.id;
  if (action === 'approve' || action === 'keep') return i.planAt === undefined ? null : { channel: `workmap:${action}`, args: { id, at: i.planAt } };
  if (action === 'replan') return text.trim() ? { channel: 'workmap:replan', args: { id, text: text.trim() } } : null;
  return { channel: `workmap:${action}`, args: { id } };
}

/** One row of the drawing: the boxes of one turn. `in`/`out` = an arrow comes into it, goes out of it. */
export interface WorkRow { wave: number; boxes: WorkBox[]; in: boolean; out: boolean }
/** The boxes in rows, turn by turn; the steps a replan takes away are apart (they lead nowhere). */
export function rowsOf(boxes: readonly WorkBox[], links: readonly WorkLink[]): { rows: WorkRow[]; dropped: WorkBox[] } {
  const live = boxes.filter(b => !b.drop), waves = [...new Set(live.map(b => b.wave))].sort((a, b) => a - b);
  const to = new Set(links.map(l => l.to)), from = new Set(links.map(l => l.from));
  return {
    rows: waves.map(wave => { const own = live.filter(b => b.wave === wave); return { wave, boxes: own, in: own.some(b => to.has(b.n)), out: own.some(b => from.has(b.n)) }; }),
    dropped: boxes.filter(b => b.drop),
  };
}
