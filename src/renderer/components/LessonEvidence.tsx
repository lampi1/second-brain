// Host-checked lesson provenance shown before the user's decision; source verification is not an efficacy claim.
import { locale, t } from '../i18n';
import type { LearnedRuleProposal } from '@shared/agent-pack';
import { LearningEvidenceInspector } from './brain-model/LearningEvidence';
export function lessonCanApprove(proposal: LearnedRuleProposal): boolean { return proposal.assessment?.state === 'supported'; }
export function LessonEvidence({ proposal, brainRoot }: { proposal: LearnedRuleProposal; brainRoot?: string | null }) {
  const assessment = proposal.assessment;
  const verdict = { success: t('cmp.durable.lesson.success'), partial: t('cmp.durable.lesson.partial'), fail: t('cmp.durable.lesson.fail') };
  return <div className="work-lesson-evidence">
    <p><strong>{lessonCanApprove(proposal) ? t('cmp.durable.lesson.verified') : t('cmp.durable.lesson.insufficient')}</strong> · {assessment?.reason ?? t('cmp.durable.lesson.newProposal')}</p>
    {!!assessment?.sources.length && <ul>{assessment.sources.map(source => <li key={source.runId}><code>{source.runId}</code> · {verdict[source.verdict]} · {source.basis === 'human' ? t('cmp.durable.lesson.human') : t('cmp.durable.lesson.review')} · {new Date(source.endedAt).toLocaleString(locale())}</li>)}</ul>}
    {brainRoot && assessment?.sources.map(source => <LearningEvidenceInspector key={`${brainRoot}:${source.runId}`} root={brainRoot} runId={source.runId} />)}
    <p>{t('cmp.durable.lesson.effect')}</p>
  </div>;
}
