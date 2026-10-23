// One concrete durable proposal inside QuestionsWindow, with exact-version yes/no actions and optional evidence.
// The shared window owns focus, queue navigation and postponement; no summary board is mounted on Home.
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
    <div className="wq-kicker">{work ? WORK_LABELS[work.stage] : 'Miglioramento da approvare'}</div>
    <p className="wq-lead">{ask.title}</p>
    {lesson && <p className="wq-lead"><strong>Ambito:</strong> {lesson.target === 'rule' ? 'Regole del brain · tutti i ruoli' : lesson.target === 'skill' ? `Skill ${lesson.skill ?? '(nome non disponibile)'}` : `Ruolo ${lesson.agentId}`}</p>}
    <h2 className="wq-q">{withoutImages(work?.proposal?.text ?? lesson?.rule ?? '')}</h2>
    {links.length > 0 && <div className="ctx-links">{links.map(link => link.kind === 'file'
      ? <button key={link.href} type="button" className="ctx-link file" onClick={() => void openFile(link.href, work?.chatIds[0] ?? lesson?.fromChat)}>{link.label}</button>
      : <a key={link.href} className="ctx-link" href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>)}</div>}
    <AskImages images={images} testBase="work-proposal" size="l" />
    {work && <details><summary>Contesto e verifiche</summary>{work.summary !== work.proposal?.text && <p>{work.summary}</p>}{work.evidence && <p>{work.evidence}</p>}{work.nextAction && <p>Prossimo passo: {work.nextAction}</p>}</details>}
    {lesson && <><details><summary>Fonti e verifiche</summary><p>{lesson.evidence}</p><LessonEvidence proposal={lesson} brainRoot={brainRoot} /></details></>}
    {!canApprove && <p className="wq-lead" role="status">Evidenze insufficienti: chiedi una modifica con Altro o rifiuta la proposta.</p>}
    <div className="wq-perm">
      <button type="button" className="btn btn-primary btn-l" disabled={busy || !canApprove} onClick={() => void decide(true)} data-testid="work-approve">Sì, {work ? 'procedi' : 'applica'}{canApprove ? ' (consigliato)' : ''}</button>
      <button type="button" className="btn btn-ghost btn-l" disabled={busy} onClick={() => void decide(false)} data-testid="work-reject">No{work ? ', proponi altro' : ''}{!canApprove ? ' (consigliato)' : ''}</button>
      <button type="button" className="btn btn-ghost btn-l" disabled={busy} onClick={() => setChanging(x => !x)} aria-expanded={changing}>Altro…</button>
    </div>
    {changing && <div className="pa-change"><label className="wq-label" htmlFor="work-feedback">La tua risposta</label>
      <textarea id="work-feedback" value={feedback} onChange={e => { setFeedback(e.target.value); saveDecisionDraft(key, e.target.value); }} rows={3} maxLength={2000} disabled={busy} autoFocus />
      <p className="wq-lead">{orchestratorReady ? 'La proposta non viene approvata. L’Orchestrator riparte dalla tua risposta.' : 'Apri un Orchestrator per inviare la risposta.'}</p>
      <button type="button" className="btn btn-primary btn-l" disabled={busy || !feedback.trim() || !orchestratorReady} onClick={() => void decide(false, feedback.trim())}>Invia risposta</button>
    </div>}
  </div>;
}
