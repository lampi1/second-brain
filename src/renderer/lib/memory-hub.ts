// The Memoria hub's places (ADR 0122; the «Idee dell'app» tab of ADR 0132 is gone since ADR 0153: its ideas are in Idee
// and its issues are cards in Proposte, so 'app' opens Proposte): its tabs in order, the page arg that opens one ("memoria/<tab>[/<more>]"), and
// the old pages that became tabs (Skill, Regole, Script, Idee: their ids, links and G-keys still exist and land on the
// matching tab; Script lands on Skill since ADR 0263). Apprendimento left for Andamento (ADR 0202, lib/andamento.ts redirects "memoria/apprendimento"); Statistiche is gone (ADR 0248): "memoria/statistiche" opens Skill, where skill use lives. Pure: used by actions.ts go() (the redirect), components/brain-model/MemoryPage.tsx (the
// tab bar) and Sidebar.tsx (which entries leave the rail). Tests: test/unit/memory-hub.test.ts.

export const HUB_TABS = ['proposte', 'approvate', 'skill', 'regole', 'idee', 'file'] as const;
export type HubTab = (typeof HUB_TABS)[number];
export const DEFAULT_TAB: HubTab = 'proposte';

/** The former pages that are tabs of Memoria now: page id → tab. */
export const HUB_PAGES: Readonly<Record<string, HubTab>> = { skill: 'skill', regole: 'regole', script: 'skill', idee: 'idee' };
/** A few tab names people (and the Orchestrator) may type: they open the same tab. */
const TAB_ALIAS: Readonly<Record<string, HubTab>> = { skills: 'skill', rules: 'regole',  ideas: 'idee', app: 'proposte', 'idee-app': 'proposte', 'app-ideas': 'proposte', files: 'file', stats: 'skill', statistiche: 'skill', proposals: 'proposte', approved: 'approvate' };

const isTab = (s: string): s is HubTab => (HUB_TABS as readonly string[]).includes(s);
/** The «Script & Query» tab is gone (ADR 0263): scripts and queries are files of their skill. Its links open the Skill
 *  tab on that skill: "script/<skill>/<file>" → "skill/<skill>"; a bare file name (one still in the old folder) → Skill. */
const SCRIPT_TABS = new Set(['script', 'scripts', 'query', 'queries']);

/** "skill/note-di-rilascio" → { tab: 'skill', rest: 'note-di-rilascio' }; anything else → the default tab. */
export function parseHubArg(arg: string | null | undefined): { tab: HubTab; rest: string | null } {
  const [head = '', ...more] = String(arg ?? '').split('/');
  const key = head.trim().toLowerCase();
  if (SCRIPT_TABS.has(key)) {
    const id = decodeURIComponent(more.join('/'));
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

/** «Rispolvera» (Memoria → Idee): an idea at random, preferring the ones still open and at least 30 days old, then any
 *  still open, then any; never the one shown now when there is another. `rnd` is injectable for the tests. */
export function pickOld<T extends { data: string; stato: string; titolo: string }>(list: readonly T[], today: string, current: string | null, rnd: () => number = Math.random): T | null {
  const open = list.filter(i => !/fatta|scartata/i.test(i.stato));
  const cutoff = Date.parse(`${today}T12:00:00Z`) - 30 * 864e5;
  const old = open.filter(i => Date.parse(`${i.data}T12:00:00Z`) <= cutoff);
  const pool = old.length ? old : open.length ? open : [...list];
  const fresh = pool.length > 1 ? pool.filter(i => i.titolo !== current) : pool;
  return fresh.length ? fresh[Math.min(fresh.length - 1, Math.floor(rnd() * fresh.length))]! : null;
}
