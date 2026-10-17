// Human-readable draft data with optional exact payload inspection; escaped text, never HTML or automatic send.
import type { ReviewedContextDraft } from '../lib/reviewed-context';
import { t } from '../i18n';
import './reviewed-context.css';
export function ReviewedContextPreview({ context, onRemove }: { context: ReviewedContextDraft; onRemove: () => void }) {
  const labels: Record<string, string> = { work: t('sections.memory.work'), goals: t('sections.memory.goals'), style: t('sections.memory.style'), constraints: t('sections.memory.constraints') };
  return <section className="reviewed-context-preview" aria-label={t('sections.draftContext')} data-testid="reviewed-context-preview">
    <div className="reviewed-context-heading"><strong>{t('sections.draftContext')} · {context.facts.length}</strong><button type="button" className="btn btn-ghost" onClick={onRemove}>{t('sections.removeContext')}</button></div>
    <dl>{context.facts.map((fact, index) => <div key={index}><dt>{fact.sourceId === 'essential' ? Object.hasOwn(labels, fact.key) ? labels[fact.key] : fact.key : fact.sourceLabel}</dt><dd>{fact.value}</dd></div>)}</dl>
    <details><summary>{t('sections.exactPayload')}</summary><pre>{context.payload}</pre></details>
  </section>;
}
