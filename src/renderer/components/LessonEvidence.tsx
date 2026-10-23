// Host-checked lesson provenance shown before the user's decision; source verification is not an efficacy claim.
import type { LearnedRuleProposal } from '@shared/agent-pack';
import { LearningEvidenceInspector } from './brain-model/LearningEvidence';
export function lessonCanApprove(proposal: LearnedRuleProposal): boolean { return proposal.assessment?.state === 'supported'; }
export function LessonEvidence({ proposal, brainRoot }: { proposal: LearnedRuleProposal; brainRoot?: string | null }) {
  const assessment = proposal.assessment;
  const verdict = { success: 'successo', partial: 'parziale', fail: 'fallimento' };
  return <div className="work-lesson-evidence">
    <p><strong>{lessonCanApprove(proposal) ? 'Fonti verificate' : 'Evidenze insufficienti'}</strong> · {assessment?.reason ?? 'Serve una nuova proposta con fonti verificabili.'}</p>
    {!!assessment?.sources.length && <ul>{assessment.sources.map(source => <li key={source.runId}><code>{source.runId}</code> · {verdict[source.verdict]} · {source.basis === 'human' ? 'verdetto utente' : 'review indipendente'} · {new Date(source.endedAt).toLocaleString()}</li>)}</ul>}
    {brainRoot && assessment?.sources.map(source => <LearningEvidenceInspector key={`${brainRoot}:${source.runId}`} root={brainRoot} runId={source.runId} />)}
    <p>Le fonti documentano l’esperienza. L’effetto della nuova regola non è ancora misurato.</p>
  </div>;
}
