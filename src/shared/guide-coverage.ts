// Which Guida card explains each page and each Settings section (ADR 0208, an extension of the anchors of ADR 0196: the
// anchors say when a card's code changed, this says when a page or a section has no card at all). Every page id of
// BRAIN_PAGES (renderer/brain/index.tsx, aliases excluded) and every SETTINGS_SECTION_IDS entry
// (renderer/lib/settings-sections.ts) names its card here; the card must exist with title and summary in Italian,
// English and German. A page or section that is going away may be exempt, with the reason, until it is removed. The
// pure check is here; main/guide/coverage.ts reads the ids from the sources, and scripts/guide-anchors.mjs --check and
// test/unit/guide-anchors.test.ts fail with coverageMessage's fix. No Node, no DOM.
import type { Bi } from './concept-guide';

/** page id → card id */
export const PAGE_CARDS: Readonly<Record<string, string>> = {
  home: 'grindhouse', agenti: 'agents', task: 'tasks', flussi: 'routines', idee: 'memory-hub', costi: 'costs',
  qualita: 'quality', apprendimento: 'memory-hub', script: 'brain-scripts', log: 'log', skill: 'skills',
  impostazioni: 'settings', regole: 'errors-rules', memoria: 'memory-hub', classificatori: 'classifiers',
  collegamenti: 'brain-map', guida: 'guide', browser: 'personal-browser', registrazioni: 'recordings', impara: 'impara',
};

/** Settings section id → card id */
export const SETTINGS_CARDS: Readonly<Record<string, string>> = {
  profile: 'settings', update: 'updates', connectors: 'mcp-servers', accounts: 'settings', roles: 'delegation',
  space: 'brain', voice: 'voice', appearance: 'settings', notifications: 'notifications', advanced: 'mcp-servers',
};

/** "page:<id>" or "settings:<id>" → why it has no card (only for something being removed). */
export const COVERAGE_EXEMPT: Readonly<Record<string, string>> = {
  'page:confronto': 'Confronto modelli is being removed (owner, 2026-10-30, Impara v3 cuts); drop this line with the page',
  'settings:writing': 'the AI typing suggestions are being removed (owner, 2026-10-30, Impara v3 cuts); drop this line with the section',
};

export interface CoverageCard { readonly id: string; readonly title: Bi; readonly summary: Bi }
export interface CoverageGap { readonly key: string; readonly message: string }

const FILE = 'src/shared/guide-coverage.ts';

/** The pages and sections without a complete card, and the stale lines of this file. */
export function coverageGaps(o: { pages: readonly string[]; sections: readonly string[]; cards: readonly CoverageCard[]; de: Readonly<Record<string, string>>;
  pageCards?: Readonly<Record<string, string>>; settingsCards?: Readonly<Record<string, string>>; exempt?: Readonly<Record<string, string>> }): CoverageGap[] {
  const pageCards = o.pageCards ?? PAGE_CARDS, settingsCards = o.settingsCards ?? SETTINGS_CARDS, exempt = o.exempt ?? COVERAGE_EXEMPT;
  const out: CoverageGap[] = [];
  const cards = new Map(o.cards.map(c => [c.id, c]));
  const check = (kind: 'page' | 'settings', ids: readonly string[], map: Readonly<Record<string, string>>, table: string) => {
    const what = kind === 'page' ? 'page' : 'Settings section';
    for (const id of ids) {
      const key = `${kind}:${id}`;
      if (exempt[key]) { if (map[id]) out.push({ key, message: `${what} "${id}" is both mapped and exempt in ${FILE}: keep one` }); continue; }
      const cardId = map[id];
      if (!cardId) { out.push({ key, message: `${what} "${id}" has no Guida card: write one in src/shared/concept-guide.ts (it, en, de in concept-guide.de.ts, id in concept-ids.ts) or pick an existing one that explains it, and map it in ${FILE} ${table}` }); continue; }
      const card = cards.get(cardId);
      if (!card) { out.push({ key, message: `${what} "${id}" maps to card "${cardId}", which does not exist: fix ${FILE} ${table} or add the card` }); continue; }
      const missing = (['title', 'summary'] as const).flatMap(f => [
        ...(card[f].it.trim() ? [] : [`${f} it`]), ...(card[f].en.trim() ? [] : [`${f} en`]), ...(o.de[card[f].en]?.trim() ? [] : [`${f} de`])]);
      if (missing.length) out.push({ key, message: `card "${cardId}" (for ${what} "${id}") lacks ${missing.join(', ')}: complete it in src/shared/concept-guide.ts / concept-guide.de.ts` });
    }
    for (const id of Object.keys(map)) if (!ids.includes(id)) out.push({ key: `${kind}:${id}:stale`, message: `${FILE} ${table} maps "${id}", which is no longer a ${what}: remove the line` });
    for (const key of Object.keys(exempt)) if (key.startsWith(`${kind}:`) && !ids.includes(key.slice(kind.length + 1))) out.push({ key: `${key}:stale`, message: `${FILE} COVERAGE_EXEMPT has "${key}", which no longer exists: remove the line` });
  };
  check('page', o.pages, pageCards, 'PAGE_CARDS');
  check('settings', o.sections, settingsCards, 'SETTINGS_CARDS');
  return out;
}
