// The Andamento page's places (ADR 0202): its tabs in order (Costi, Qualità, Apprendimento, Uso), the page arg that
// opens one ("andamento/<tab>[/<more>]", e.g. "andamento/costi/30"), and the old pages that became tabs: costi, qualita
// and classificatori were pages of their own, apprendimento a tab of Memoria; their ids, links ("costi/30",
// "memoria/apprendimento") and G-keys still exist and land on the matching tab. Classificatori was a tab too until the
// routing table left (ADR 0210): its cards are a section of Qualità, and its old ids open Qualità. Pure: used by
// actions.ts go() and placeOf (the redirect), brain/index.tsx parseTarget, components/andamento/AndamentoPage.tsx (the
// tab bar), lib/app-map.ts and lib/use-counter.ts (a tab counts as its own place). Tests: test/unit/andamento.test.ts.

export const TREND_TABS = ['costi', 'qualita', 'apprendimento', 'uso'] as const;
export type TrendTab = (typeof TREND_TABS)[number];
export const DEFAULT_TREND_TAB: TrendTab = 'costi';

/** Old page ids (and words people or the Orchestrator may type) → the tab that replaces them. */
export const TREND_PAGES: Readonly<Record<string, TrendTab>> = {
  costi: 'costi', costs: 'costi', cost: 'costi', spesa: 'costi',
  qualita: 'qualita', quality: 'qualita', errori: 'qualita',
  // Confronto modelli went (ADR 0201): its old links open the agents' quality
  confronto: 'qualita',
  apprendimento: 'apprendimento', learning: 'apprendimento',
  // the Classificatori tab folded into Qualità (ADR 0210)
  classificatori: 'qualita', classifiers: 'qualita',
  uso: 'uso', usage: 'uso', 'uso-app': 'uso',
};

const isTab = (s: string): s is TrendTab => (TREND_TABS as readonly string[]).includes(s);

/** "costi/30" → { tab: 'costi', rest: '30' }; anything else → the default tab. */
export function parseTrendArg(arg: string | null | undefined): { tab: TrendTab; rest: string | null } {
  const [head = '', ...more] = String(arg ?? '').split('/');
  const key = head.trim().toLowerCase();
  const tab = isTab(key) ? key : TREND_PAGES[key];
  if (!tab) return { tab: DEFAULT_TREND_TAB, rest: null };
  const rest = more.join('/');
  return { tab, rest: rest || null };
}

/** The page arg of a tab (with its own arg). */
export const trendArg = (tab: TrendTab, rest?: string | null): string => (rest ? `${tab}/${rest}` : tab);

/** An old page and its arg → the Andamento place that replaces it, or null when it is not one of them. Memoria's old
 *  «Apprendimento» tab ("memoria/apprendimento") moved here too. */
export function trendRedirect(page: string, arg: string | null | undefined): { page: 'andamento'; arg: string } | null {
  if (page === 'memoria') {
    const [head = '', ...more] = String(arg ?? '').split('/');
    const k = head.trim().toLowerCase();
    return k === 'apprendimento' || k === 'learning' ? { page: 'andamento', arg: trendArg('apprendimento', more.join('/') || null) } : null;
  }
  const tab = page === 'andamento' ? null : TREND_PAGES[page];
  return tab ? { page: 'andamento', arg: trendArg(tab, arg ?? null) } : null;
}
