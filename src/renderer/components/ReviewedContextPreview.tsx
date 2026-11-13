// Human-readable draft data with optional exact payload inspection; escaped text, never HTML or automatic send.
import type { ReviewedContextDraft } from '../lib/reviewed-context';
import { t } from '../i18n';
import './reviewed-context.css';
export function ReviewedContextPreview({ context, onRemove }: { context: ReviewedContextDraft; onRemove: () => void }) {
  const labels: Record<string, string> = { work: t('reviewedContext.memory.work'), goals: t('reviewedContext.memory.goals'), style: t('reviewedContext.memory.style'), constraints: t('reviewedContext.memory.constraints') };
  return <section className="reviewed-context-preview" aria-label={t('reviewedContext.draft')} data-testid="reviewed-context-preview">
    <div className="reviewed-context-heading"><strong>{t('reviewedContext.draft')} · {context.facts.length}</strong><button type="button" className="btn btn-ghost" onClick={onRemove}>{t('reviewedContext.remove')}</button></div>
    <dl>{context.facts.map((fact, index) => <div key={index}><dt>{fact.sourceId === 'essential' ? Object.hasOwn(labels, fact.key) ? labels[fact.key] : fact.key : fact.sourceLabel}</dt><dd>{fact.value}</dd></div>)}</dl>
    <details><summary>{t('reviewedContext.exactPayload')}</summary><pre>{context.payload}</pre></details>
  </section>;
}
