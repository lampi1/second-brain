// A lesson's state as a small tag (in preparation, failed, done, half, new): the saved lessons of the «Lezioni» tab
// (ImparaStart.tsx) and the PRs of the «Pull Request» tab (ImparaPrTab.tsx). Styles impara.css (.ip-tag).
import type { LessonSummary } from '@shared/lesson';
import { t } from '../../i18n';
import { IconSpinner } from '../Icons';

export function lessonState(s: LessonSummary) {
  if (s.state === 'preparing') return <span className="ip-tag blue"><IconSpinner size={10} />{t('impara.state.preparing')}</span>;
  if (s.state === 'failed') return <span className="ip-tag red">{t('impara.state.failed')}</span>;
  if (s.done) return <span className="ip-tag green">{t('impara.state.done')}</span>;
  return s.seen ? <span className="ip-tag amber">{t('impara.state.half')}</span> : <span className="ip-tag">{t('impara.state.new')}</span>;
}
