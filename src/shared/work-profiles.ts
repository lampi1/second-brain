// The user's work profile (Impostazioni → Il mio spazio): which Brain pages the sidebar shows and which one is the
// reference page, for a developer, a tester, a product owner or a CTO. Navigation only: it never picks a role, an
// engine or a permission. Read tolerantly: an unknown saved id means "no profile" (every page shown). Used by
// renderer/components/WorkProfilePreferences.tsx and Sidebar.tsx; unit tests: test/unit/role-consumers.test.ts.
export interface WorkProfile { id: string; title: string; pageIds: readonly string[]; homePageId: string }

export const WORK_PROFILES: readonly WorkProfile[] = [
  { id: 'dev', title: 'Dev', pageIds: ['agenti', 'task', 'skill', 'fatto'], homePageId: 'agenti' },
  { id: 'qa', title: 'QA', pageIds: ['qualita', 'agenti', 'task', 'skill', 'fatto'], homePageId: 'qualita' },
  { id: 'po', title: 'PO', pageIds: ['idee', 'agenti', 'task', 'fatto'], homePageId: 'idee' },
  { id: 'cto', title: 'CTO', pageIds: ['costi', 'agenti', 'qualita', 'confronto', 'task', 'fatto'], homePageId: 'costi' },
];

/** The saved profile with only the pages this build has; null = none chosen, an unknown id, or a profile whose
 *  reference page is missing. */
export function workProfile(saved: unknown, pageIds: readonly string[]): WorkProfile | null {
  const p = typeof saved === 'string' ? WORK_PROFILES.find(x => x.id === saved) : undefined;
  if (!p || !pageIds.includes(p.homePageId)) return null;
  return { ...p, pageIds: p.pageIds.filter(id => pageIds.includes(id)) };
}
