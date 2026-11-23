// The Memoria hub's places (ADR 0122): its tabs in order, the page arg that opens one ("memoria/<tab>[/<more>]"), and
// the old pages that became tabs (Skill, Script: their ids, links and G-keys still exist and land on the Skill tab;
// Script lands on Skill since ADR 0263). Owner 2026-11-23 («io voglio solo vedere il diario gli artifact e le skill e la
// parte proposte della manutenzione»): only Diario (id 'file', MemoryBrowser), Artifact, Skill and Proposte are left; the
// Approvate, Sempre caricato and Idee tabs are deleted, and their old tab names open the default tab. Pure: used by actions.ts go() (the redirect), components/brain-model/MemoryPage.tsx (the
// tab bar) and Sidebar.tsx (which entries leave the rail). Tests: test/unit/memory-hub.test.ts.

export const HUB_TABS = ['file', 'artifact', 'skill', 'proposte'] as const;
export type HubTab = (typeof HUB_TABS)[number];
export const DEFAULT_TAB: HubTab = 'proposte';

/** The former pages that are tabs of Memoria now: page id → tab. */
export const HUB_PAGES: Readonly<Record<string, HubTab>> = { skill: 'skill', script: 'skill' };
/** A few tab names people (and the Orchestrator) may type: they open the same tab. */
const TAB_ALIAS: Readonly<Record<string, HubTab>> = { skills: 'skill', app: 'proposte', 'idee-app': 'proposte', 'app-ideas': 'proposte', files: 'file', diario: 'file', journal: 'file', note: 'file', artifacts: 'artifact', artefatti: 'artifact', report: 'artifact', reports: 'artifact', stats: 'skill', statistiche: 'skill', proposals: 'proposte', manutenzione: 'proposte' };

const isTab = (s: string): s is HubTab => (HUB_TABS as readonly string[]).includes(s);
/** The «Script & Query» tab is gone (ADR 0263): scripts and queries are files of their skill. Its links open the Skill
 *  tab on that skill: "script/<skill>/<file>" → "skill/<skill>"; a bare file name (one still in the old folder) → Skill. */
const SCRIPT_TABS = new Set(['script', 'scripts', 'query', 'queries']);

/** "skill/note-di-rilascio" → { tab: 'skill', rest: 'note-di-rilascio' }; anything else → the default tab. */
export function parseHubArg(arg: string | null | undefined): { tab: HubTab; rest: string | null } {
  const [head = '', ...more] = String(arg ?? '').split('/');
  const key = head.trim().toLowerCase();
  if (SCRIPT_TABS.has(key)) {
    const raw = more.join('/');
    let id = raw;
    try { id = decodeURIComponent(raw); } catch { /* a malformed link: as written */ }
    return { tab: 'skill', rest: id.includes('/') ? id.slice(0, id.indexOf('/')) : null };
  }
  const tab = isTab(key) ? key : TAB_ALIAS[key];
  if (!tab) return { tab: DEFAULT_TAB, rest: null };
  const rest = more.join('/');
  return { tab, rest: rest || null };
}

/** The page arg of a tab (with its own arg). */
export const hubArg = (tab: HubTab, rest?: string | null): string => (rest ? `${tab}/${rest}` : tab);

/** An old page and its arg → the Memoria place that replaces it, or null when the page is not one of them. */
export function hubRedirect(page: string, arg: string | null | undefined): { page: 'memoria'; arg: string } | null {
  const tab = HUB_PAGES[page];
  if (!tab) return null;
  // the old Script page's arg is a script id: its skill (above) is the Skill tab's arg
  if (page === 'script') return { page: 'memoria', arg: hubArg(tab, parseHubArg(`script/${arg ?? ''}`).rest) };
  return { page: 'memoria', arg: hubArg(tab, arg ?? null) };
}
