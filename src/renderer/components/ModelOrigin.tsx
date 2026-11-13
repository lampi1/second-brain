// Shows only an individual event's preserved provider observation. Legacy records never borrow the active model.
import { readEventOrigin } from '@shared/event-origin';
import { t } from '../i18n';

export function ModelOrigin({ human = false, origin }: { human?: boolean; origin?: unknown }) {
  const observed = readEventOrigin(origin);
  const isHuman = human || observed?.kind === 'human';
  const model = isHuman ? null : observed?.modelObserved;
  const title = isHuman ? undefined : model ? [observed?.engine, observed?.source, observed?.sessionId].filter(Boolean).join(' · ') : t('origin.missingHint');
  return <small className="model-origin" title={title} data-testid="model-origin">{isHuman ? t('origin.user') : `${t('product.model')}: ${model || t('origin.unavailable')}`}</small>;
}
