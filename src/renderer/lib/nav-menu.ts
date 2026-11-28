// What the ☰ menu of the sidebar lists (ADR 0366, issue #491: «solo Grindhouse, Piani, Impara, Scacchi, Agenti, Memoria,
// Andamento, Impostazioni»), in three groups. Task, Registrazioni, Collegamenti and Log are hidden from it, not removed:
// they stay reachable from the command palette (Ctrl+K), their G-letter keys and the Orchestrator (app_ui). Task comes
// back under Lavoro while it has unread items, so the dot on ☰ always leads somewhere. Pure: used by
// components/Sidebar.tsx and lib/app-map.ts (the rail the Orchestrator reads); pinned by test/unit/nav-menu.test.ts.
import type { BrainPageId } from '../brain';
import type { TasksState } from '@shared/contract';

export interface MenuGroup { id: 'work' | 'leisure' | 'system'; pages: readonly BrainPageId[] }

export const MENU_GROUPS: readonly MenuGroup[] = [
  { id: 'work', pages: ['home', 'piani'] },
  { id: 'leisure', pages: ['impara', 'scacchi'] },
  { id: 'system', pages: ['agenti', 'memoria', 'andamento', 'impostazioni'] },
];

/** Pages kept out of the menu (reachable elsewhere). */
export const MENU_HIDDEN: readonly BrainPageId[] = ['task', 'registrazioni', 'collegamenti', 'log'];

/** The menu as shown: Task joins Lavoro while it has unread items (and the Task section is on). */
export function menuGroups(tasksUnread: number): readonly MenuGroup[] {
  if (tasksUnread <= 0) return MENU_GROUPS;
  return MENU_GROUPS.map(g => g.id === 'work' ? { ...g, pages: [...g.pages, 'task' as const] } : g);
}

/** The unread Task items that count for the menu: none while the Task section is off (no state, or no script). */
export const menuTasksUnread = (s: TasksState | null): number => s !== null && s.error?.kind !== 'script' ? s.unread ?? 0 : 0;

/** The dictionary key of a page's name in the menu, when it differs from the page's own label. */
export const menuLabelKey = (id: BrainPageId): 'catalog.title' | 'dialogs.sidebar.news' | null =>
  id === 'agenti' ? 'catalog.title' : id === 'impara' ? 'dialogs.sidebar.news' : null;

/** Whether ☰ wears its dot: memory proposals waiting, or unread Task items (only while the Task section is on). */
export const menuAlert = (proposals: number, tasksUnread: number): boolean => proposals + Math.max(0, tasksUnread) > 0;
