// What the ☰ menu of the sidebar lists (ADR 0366, issue #491), in three groups. «Attività pianificate» (ADR 0373) took
// Task's place under Lavoro, always listed: the owner never opened Task and wants to switch activities on and off. Registrazioni,
// Collegamenti and Log are hidden from it, not removed: they stay reachable from the command palette (Ctrl+K), their G-letter
// keys and the Orchestrator (app_ui). Pure: used by components/Sidebar.tsx and lib/app-map.ts (the rail the Orchestrator
// reads); pinned by test/unit/nav-menu.test.ts.
import type { BrainPageId } from '../brain';

export interface MenuGroup { id: 'work' | 'leisure' | 'system'; pages: readonly BrainPageId[] }

export const MENU_GROUPS: readonly MenuGroup[] = [
  { id: 'work', pages: ['home', 'piani', 'attivita'] },
  { id: 'leisure', pages: ['impara', 'scacchi'] },
  { id: 'system', pages: ['agenti', 'memoria', 'andamento', 'impostazioni'] },
];

/** Pages kept out of the menu (reachable elsewhere). */
export const MENU_HIDDEN: readonly BrainPageId[] = ['registrazioni', 'collegamenti', 'log'];

/** The dictionary key of a page's name in the menu, when it differs from the page's own label. */
export const menuLabelKey = (id: BrainPageId): 'catalog.title' | 'dialogs.sidebar.news' | null =>
  id === 'agenti' ? 'catalog.title' : id === 'impara' ? 'dialogs.sidebar.news' : null;

/** Whether ☰ wears its dot: memory proposals waiting. */
export const menuAlert = (proposals: number): boolean => proposals > 0;
