// The Giornale & Fonti page (mounted under the `impara` page route in Svago): renders the curated multi-edition
// newspaper with sources and filters directly (NewsPage.tsx). The slow paid Lessons/FSRS/PR tabs were retired so
// leisure stays fast, light and clean; asking for a deep dive on a story drafts directly to the Orchestrator.
import { t } from '../../i18n';
import { NewsPage } from './news/NewsPage';
import '../../styles/impara.css';

export function ImparaPage() {
  return (
    <div className="bx bx-page bx-scroll ip-page" data-testid="impara-page" role="region" aria-label={t('brainPages.nav.impara')}>
      <div className="bx-inner ip-inner ip-wide">
        <NewsPage />
      </div>
    </div>
  );
}
