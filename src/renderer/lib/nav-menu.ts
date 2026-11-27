// What the ☰ menu of the sidebar lists (ADR 0366, issue #491: «solo Grindhouse, Piani, Impara, Scacchi, Agenti, Memoria,
// Andamento, Impostazioni»), in three groups. Task, Registrazioni, Collegamenti and Log are hidden from it, not removed:
// they stay reachable from the command palette (Ctrl+K), their G-letter keys and the Orchestrator (app_ui). Pure: used by
// components/Sidebar.tsx; pinned by test/unit/nav-menu.test.ts.
import type { BrainPageId } from '../brain';

export interface MenuGroup { id: 'work' | 'leisure' | 'system'; pages: readonly BrainPageId[] }

export const MENU_GROUPS: readonly MenuGroup[] = [
  { id: 'work', pages: ['home', 'piani'] },
  { id: 'leisure', pages: ['impara', 'scacchi'] },
  { id: 'system', pages: ['agenti', 'memoria', 'andamento', 'impostazioni'] },
];

/** Pages kept out of the menu (reachable elsewhere). */
export const MENU_HIDDEN: readonly BrainPageId[] = ['task', 'registrazioni', 'collegamenti', 'log'];
