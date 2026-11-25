// The plans' place in the app (ADR 0359): page 'piani', with a plan's id as its argument (`piani` = the list). Rendered by App.tsx
// PageFrame.
import { t } from '../../i18n';
import { ui } from '../../store/ui';
import { PlansPage } from './PlansPage';

export function PlansRoute() {
  const arg = ui.use(s => (s.page === 'piani' ? s.pageArg : null));
  return <div className="dashboard bm-dash bm-map" data-testid="plans-page">
    {!arg && <header className="dash-header"><div><span className="dash-eyebrow">{t('plans.title').toUpperCase()}</span><h1>{t('plans.title')}</h1><p>{t('plans.lead')}</p></div></header>}
    <PlansPage id={arg || null} />
  </div>;
}
