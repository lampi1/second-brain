// Rich request choices shared by all RequestPanel sizes. Inspecting content never submits an answer.
// The existing preview contract carries markdown or validated sb-ui cards with pros, cons, effort and risk.
import { useId, type ReactNode } from 'react';
import type { QuestionOption } from '@shared/contract';
import { cleanDescription, cleanLabel } from '../../lib/keys';
import { withoutImages } from '../../lib/askImages';
import { t } from '../../i18n';
import { UiPreview } from '../GenUi';
import { IconCheck } from '../Icons';

export function ChoiceCard({ option, number, recommended, picked, multi, current, disabled, onChoose, testid, tone }: {
  option: QuestionOption; number: ReactNode; recommended?: boolean; picked?: boolean; multi?: boolean;
  current?: boolean; disabled?: boolean; onChoose: () => void; testid: string; tone?: 'deny';
}) {
  const id = useId();
  const description = option.description ? cleanDescription(withoutImages(option.description)) : '';
  return (
    <div className={`gu-choice ${recommended ? 'rec' : ''} ${picked ? 'picked' : ''} ${current ? 'cur' : ''} ${tone ?? ''}`}>
      <button type="button" className="gu-choice-answer" onClick={onChoose} disabled={disabled}
        role={multi ? 'checkbox' : undefined} aria-checked={multi ? !!picked : undefined}
        aria-describedby={description ? `${id}-description` : undefined} data-testid={testid}>
        <span className="gu-choice-key" aria-hidden="true">{multi && picked ? <IconCheck size={16} /> : number}</span>
        <span className="gu-choice-copy"><strong>{cleanLabel(option.label)}</strong>
          {description && <span id={`${id}-description`} className="gu-choice-description">{description}</span>}
        </span>
        {recommended && <span className="gu-rec">{t('tools.genui.recommended')}</span>}
      </button>
      {option.preview?.trim() && (
        <details className="gu-choice-preview" data-option-preview onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            e.currentTarget.open = false;
            e.currentTarget.querySelector('summary')?.focus();
          }
        }}>
          <summary>{t('genui.choice.preview')}</summary>
          <div className="gu-choice-preview-body"><UiPreview text={option.preview} /></div>
        </details>
      )}
    </div>
  );
}
