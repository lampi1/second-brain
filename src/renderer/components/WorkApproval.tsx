// One concrete durable proposal inside QuestionsWindow as the decision card (DecisionCard.tsx, ADR 0149): exact-version
// Sì / No, its text and evidence always open, «Scrivi una risposta…» to the Orchestrator, «Non voglio rispondere» drops it.
// The shared window owns focus, queue navigation and postponement; no summary board is mounted on Home.
import { t } from '../i18n';
import { useMemo, useRef, useState } from 'react';
import { WORK_LABELS } from '@shared/workflows';
import type { DurableAsk } from '../lib/work-ask';
import { decideWork, decideLesson } from '../store/workflows';
import { linksIn } from '../lib/askContext';
import { decisionDraft, saveDecisionDraft } from '../lib/decision-drafts';
import { imagesIn, withoutImages } from '../lib/askImages';
import { AskImages } from './AskImages';
import { openFile } from './GenUi';
import { useApp } from '../store/store';
import { LessonEvidence, lessonCanApprove } from './LessonEvidence';
import { DecisionCard } from './DecisionCard';
export function WorkApproval({ ask, onEscape }: { ask: DurableAsk; onEscape: () => void }) {
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const key = `${ask.chatId}/${ask.id}`;
  const orchestratorReady = useApp(s => Object.values(s.chats).some(c => c.isOrchestrator && !c.closedAt));
  const brainRoot = useApp(s => s.info?.brainRoot);
  const work = ask.type === 'work' ? ask.row : null;
  const lesson = ask.type === 'lesson' ? ask.proposal : null;
  const sources = useMemo(() => work ? [work.proposal?.text ?? '', work.summary, work.evidence] : [lesson?.rule ?? '', lesson?.evidence ?? ''], [work, lesson]);
  const links = useMemo(() => linksIn(sources), [sources]);
  const images = useMemo(() => imagesIn(sources.map(text => ({ text }))), [sources]);
  const canApprove = !lesson || lessonCanApprove(lesson);
  const decide = async (yes: boolean, note?: string) => {
    if (submitting.current || (yes && !canApprove) || (note && !orchestratorReady)) return;
    submitting.current = true; setBusy(true);
    const ok = work ? await decideWork(work, yes, note) : lesson ? await decideLesson(lesson, yes, note) : false;
    if (ok) saveDecisionDraft(key, '');
    if (!ok) { submitting.current = false; setBusy(false); }
  };
  return <DecisionCard testBase={`qwin-${ask.type}`} className="wq" busy={busy} laterButton={false} onLater={onEscape}
    rootProps={{ 'data-request-key': key, 'aria-label': ask.title }}
    head={<><span className="dc-chip">{work ? WORK_LABELS[work.stage] : t('cmp.durable.approval.lesson')}</span><b className="dc-who">{ask.title}</b></>}
    question={withoutImages(work?.proposal?.text ?? lesson?.rule ?? '')}
    ifYes={t('genui.decision.workYes')} ifNo={t('genui.decision.workNo')}
    yes={{ onChoose: () => void decide(true), label: work ? t('cmp.durable.approval.proceed') : t('cmp.durable.approval.apply'), recommended: canApprove, disabled: !canApprove, testid: 'work-approve' }}
    no={{ onChoose: () => void decide(false), label: work ? t('cmp.durable.approval.reject') : t('cmp.durable.approval.no'), recommended: !canApprove, testid: 'work-reject' }}
    write={{ onSend: note => void decide(false, note), initial: decisionDraft(key) || undefined, onDraft: v => saveDecisionDraft(key, v), disabled: !orchestratorReady,
      hint: orchestratorReady ? t('cmp.durable.approval.feedbackHint') : t('cmp.durable.approval.openOrchestrator') }}
    skip={{ onChoose: () => void decide(false), hint: t('genui.decision.skipDiscard') }}>
    {lesson && <p className="dc-nobrief"><strong>{t('cmp.durable.approval.scope')}</strong> {lesson.target === 'rule' ? t('cmp.durable.approval.rules') : lesson.target === 'skill' ? t('cmp.durable.approval.skill', { name: lesson.skill ?? t('cmp.durable.approval.missingName') }) : t('cmp.durable.approval.role', { name: lesson.agentId })}</p>}
    {work && (work.summary !== work.proposal?.text || work.evidence || work.nextAction) && <div className="dc-brief-k">{t('cmp.durable.approval.context')}</div>}
    {work && work.summary !== work.proposal?.text && <p className="dc-nobrief">{work.summary}</p>}
    {work?.evidence && <p className="dc-nobrief">{work.evidence}</p>}
    {work?.nextAction && <p className="dc-nobrief">{t('cmp.durable.approval.next', { action: work.nextAction })}</p>}
    {lesson && <><div className="dc-brief-k">{t('cmp.durable.approval.sources')}</div><p className="dc-nobrief">{lesson.evidence}</p><LessonEvidence proposal={lesson} brainRoot={brainRoot} /></>}
    <AskImages images={images} testBase="work-proposal" size="l" />
    {links.length > 0 && <div className="ctx-links">{links.map(link => link.kind === 'file'
      ? <button key={link.href} type="button" className="ctx-link file" onClick={() => void openFile(link.href, work?.chatIds[0] ?? lesson?.fromChat)}>{link.label}</button>
      : <a key={link.href} className="ctx-link" href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>)}</div>}
    {!canApprove && <p className="dc-nobrief" role="status">{t('cmp.durable.approval.insufficient')}</p>}
  </DecisionCard>;
}
