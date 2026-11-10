// Impara's three tabs (ADR 0264; owner 2026-11-10: «tab separate "Giornale" "Pull Request"»): «Giornale» (the AI news,
// news/NewsPage.tsx), «Pull Request» (the user's PRs to study, ImparaPrTab.tsx) and «Lezioni» (a lesson on anything,
// the saved lessons and the review, ImparaStart.tsx). The address is impara/giornale, impara/pr, impara/lezioni; plain
// impara opens the tab used last (localStorage, a convenience). Used by ImparaPage.tsx; styles news.css (.ip-tabs).
import { go } from '../../actions';
import { t } from '../../i18n';
import '../../styles/news.css';

export type ImparaTab = 'giornale' | 'pr' | 'lezioni';
export const IMPARA_TABS: readonly ImparaTab[] = ['giornale', 'pr', 'lezioni'];
const KEY = 'sb.impara.tab';
export const isImparaTab = (v: unknown): v is ImparaTab => typeof v === 'string' && (IMPARA_TABS as readonly string[]).includes(v);
export function lastTab(): ImparaTab {
  try { const v = localStorage.getItem(KEY); return isImparaTab(v) ? v : 'giornale'; } catch { return 'giornale'; }
}
export function rememberTab(v: ImparaTab): void { try { localStorage.setItem(KEY, v); } catch { /* a convenience only */ } }

export function ImparaTabs({ tab }: { tab: ImparaTab }) {
  return (
    <div className="ip-tabs" role="tablist" aria-label={t('brainPages.nav.impara')}>
      {IMPARA_TABS.map(k => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { rememberTab(k); go({ page: 'impara', arg: k }); }} data-testid={`impara-tab-${k}`}>
          {t(`impara.tab.${k}`)}
        </button>
      ))}
    </div>
  );
}
