// Read-only routine PR/QA recap from the Task service; the cockpit offers its existing refresh without a model turn.
import { locale, t } from '../i18n';
import type { TasksState } from '@shared/contract';
import { workRecap } from '@shared/work-recap';

export function WorkRecap({ tasks, refresh, now = Date.now() }: { tasks: TasksState | null; refresh: () => void; now?: number }) {
  const recap = workRecap(tasks, now);
  const stamp = (at: number | null) => at ? new Date(at).toLocaleString(locale()) : t('cmp.durable.recap.neverRead');
  const fresh = { missing: t('cmp.durable.recap.missing'), stale: t('cmp.durable.recap.stale'), current: t('cmp.durable.recap.current'), error: t('cmp.durable.recap.error') };
  return <details className="work-routine" data-testid="work-routine">
    <summary>{t('cmp.durable.recap.summary', { count: recap.prs.length, freshness: fresh[recap.qaFreshness] })}</summary>
    <div className="work-routine-heading"><p>PR: {stamp(recap.readAt)} · {fresh[recap.freshness]}<br />QA: {stamp(recap.qaAt)} · {fresh[recap.qaFreshness]}</p>
      <button type="button" className="btn btn-ghost btn-s" onClick={refresh} disabled={tasks?.running}>{tasks?.running ? t('cmp.durable.recap.reading') : t('cmp.durable.recap.refresh')}</button></div>
    {tasks?.error && <p role="status">{tasks.error.message}</p>}
    {tasks?.qaError && <p role="status">{t('cmp.durable.recap.qaError', { error: tasks.qaError })}</p>}
    {!recap.prs.length && <p>{recap.readAt ? t('cmp.durable.recap.noPr') : t('cmp.durable.recap.readData')}</p>}
    {recap.prs.map(({ pr, risks, qaKnown }) => <article key={`${pr.project}/${pr.repo}/${pr.id}`} className="work-routine-pr">
      <strong>#{pr.id} · {pr.title}</strong><small>{pr.repo} → {pr.target}{pr.draft ? t('cmp.durable.recap.draft') : ''}{pr.autoComplete ? t('cmp.durable.recap.autoComplete') : ''}</small>
      {risks.length > 0 && <p className="work-routine-risk">{risks.join(' · ')}</p>}
      <p>{t('cmp.durable.recap.build', { build: pr.build?.result ?? pr.build?.status ?? t('cmp.durable.recap.unavailable'), reviews: pr.reviewers.filter(r => r.required && r.vote === 0).length })}</p>
      {!qaKnown && <p>{t('cmp.durable.recap.noQa')}</p>}
      {qaKnown && !risks.length && <p>{t('cmp.durable.recap.noIssues')}</p>}
    </article>)}
    <small>{t('cmp.durable.recap.authority')}</small>
  </details>;
}
