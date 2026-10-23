// One concrete durable proposal inside QuestionsWindow, with exact-version yes/no actions and optional evidence.
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
export function WorkApproval({ ask, onEscape }: { ask: DurableAsk; onEscape: () => void }) {
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const key = `${ask.chatId}/${ask.id}`;
  const [changing, setChanging] = useState(() => !!decisionDraft(key)), [feedback, setFeedback] = useState(() => decisionDraft(key));
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
  return <div className={`wq ${busy ? 'sent' : ''}`} tabIndex={0} role="group" aria-label={ask.title} aria-busy={busy}
    data-request-key={`${ask.chatId}/${ask.id}`} data-testid={`qwin-${ask.type}`} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); }
    }}>
    <div className="wq-kicker">{work ? WORK_LABELS[work.stage] : t('cmp.durable.approval.lesson')}</div>
    <p className="wq-lead">{ask.title}</p>
    {lesson && <p className="wq-lead"><strong>{t('cmp.durable.approval.scope')}</strong> {lesson.target === 'rule' ? t('cmp.durable.approval.rules') : lesson.target === 'skill' ? t('cmp.durable.approval.skill', { name: lesson.skill ?? t('cmp.durable.approval.missingName') }) : t('cmp.durable.approval.role', { name: lesson.agentId })}</p>}
    <h2 className="wq-q">{withoutImages(work?.proposal?.text ?? lesson?.rule ?? '')}</h2>
    {links.length > 0 && <div className="ctx-links">{links.map(link => link.kind === 'file'
      ? <button key={link.href} type="button" className="ctx-link file" onClick={() => void openFile(link.href, work?.chatIds[0] ?? lesson?.fromChat)}>{link.label}</button>
      : <a key={link.href} className="ctx-link" href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>)}</div>}
    <AskImages images={images} testBase="work-proposal" size="l" />
    {work && <details><summary>{t('cmp.durable.approval.context')}</summary>{work.summary !== work.proposal?.text && <p>{work.summary}</p>}{work.evidence && <p>{work.evidence}</p>}{work.nextAction && <p>{t('cmp.durable.approval.next', { action: work.nextAction })}</p>}</details>}
    {lesson && <><details><summary>{t('cmp.durable.approval.sources')}</summary><p>{lesson.evidence}</p><LessonEvidence proposal={lesson} brainRoot={brainRoot} /></details></>}
    {!canApprove && <p className="wq-lead" role="status">{t('cmp.durable.approval.insufficient')}</p>}
    <div className="wq-perm">
      <button type="button" className="btn btn-primary btn-l" disabled={busy || !canApprove} onClick={() => void decide(true)} data-testid="work-approve">{work ? t('cmp.durable.approval.proceed') : t('cmp.durable.approval.apply')}{canApprove ? t('cmp.durable.approval.recommended') : ''}</button>
      <button type="button" className="btn btn-ghost btn-l" disabled={busy} onClick={() => void decide(false)} data-testid="work-reject">{work ? t('cmp.durable.approval.reject') : t('cmp.durable.approval.no')}{!canApprove ? t('cmp.durable.approval.recommended') : ''}</button>
      <button type="button" className="btn btn-ghost btn-l" disabled={busy} onClick={() => setChanging(x => !x)} aria-expanded={changing}>{t('ui.other')}</button>
    </div>
    {changing && <div className="pa-change"><label className="wq-label" htmlFor="work-feedback">{t('cmp.durable.approval.answer')}</label>
      <textarea id="work-feedback" value={feedback} onChange={e => { setFeedback(e.target.value); saveDecisionDraft(key, e.target.value); }} rows={3} maxLength={2000} disabled={busy} autoFocus />
      <p className="wq-lead">{orchestratorReady ? t('cmp.durable.approval.feedbackHint') : t('cmp.durable.approval.openOrchestrator')}</p>
      <button type="button" className="btn btn-primary btn-l" disabled={busy || !feedback.trim() || !orchestratorReady} onClick={() => void decide(false, feedback.trim())}>{t('cmp.durable.approval.send')}</button>
    </div>}
  </div>;
}
