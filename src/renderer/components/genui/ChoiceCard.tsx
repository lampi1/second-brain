// Rich request choices shared by all RequestPanel sizes. Inspecting content never submits an answer.
// The existing preview contract carries markdown or validated sb-ui cards with pros, cons, effort and risk. In the
// questions window the preview starts open (`previewOpen`: nothing there is folded, the owner 2026-10-22).
// A yes/no question's two answers (`yn`, ADR 0135) are big tiles: a round check or cross, the word large, the key as a
// small hint, each in its own color (green / coral, the same weight: the recommended one glows, the color never
// pushes toward «Sì»), lifting under the pointer (the owner, 2026-10-23: «i box devono essere molto più fighi»).
import { useId, type ReactNode } from 'react';
import type { QuestionOption } from '@shared/contract';
import { cleanDescription, cleanLabel } from '../../lib/keys';
import { withoutImages } from '../../lib/askImages';
import { t } from '../../i18n';
import { UiPreview } from '../GenUi';
import { IconCheck, IconX } from '../Icons';

export function ChoiceCard({ option, number, recommended, picked, multi, current, disabled, onChoose, testid, tone, previewOpen, yn }: {
  option: QuestionOption; number: ReactNode; recommended?: boolean; picked?: boolean; multi?: boolean;
  current?: boolean; disabled?: boolean; onChoose: () => void; testid: string; tone?: 'deny'; previewOpen?: boolean;
  /** the answer of a yes/no question: drawn as a big tile */
  yn?: 'yes' | 'no';
}) {
  const id = useId();
  const description = option.description ? cleanDescription(withoutImages(option.description)) : '';
  const preview = option.preview?.trim() && (
    <details className="gu-choice-preview" data-option-preview open={previewOpen} onKeyDown={e => {
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
  );
  if (yn) return (
    <div className={`gu-choice gu-yn ${yn} ${recommended ? 'rec' : ''} ${current ? 'cur' : ''}`}>
      <button type="button" className="gu-choice-answer gu-yn-answer" onClick={onChoose} disabled={disabled}
        aria-describedby={description ? `${id}-description` : undefined} data-testid={testid}>
        <span className="gu-yn-icon" aria-hidden="true">{yn === 'yes' ? <IconCheck size={18} /> : <IconX size={18} />}</span>
        <strong className="gu-yn-label">{cleanLabel(option.label)}</strong>
        {description && <span id={`${id}-description`} className="gu-choice-description gu-yn-desc">{description}</span>}
        <span className="gu-yn-key" aria-hidden="true">{number}</span>
        {recommended && <span className="gu-rec gu-yn-rec">{t('tools.genui.recommended')}</span>}
      </button>
      {preview}
    </div>
  );
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
      {preview}
    </div>
  );
}
