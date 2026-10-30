// A lesson being prepared (ADR 0188): the research as it goes, phase by phase (the material read; the web searched,
// seeing only the user's question; the files read: material, brain, app; each fact checked by a second model; the
// questions; the plan), with what each found and why one was skipped, the sources found once checked, and, when the ask can mean different things, the
// questions to answer (an option, a few words of one's own, or «Salta, decidi tu») while the facts are checked. The
// public topics the files research found (ADR 0206) show as chips «Dai tuoi file · cercherò sul web»: ✕ drops one,
// «Cerca ora» starts them, else they start by themselves after 5 seconds. Used by ImparaPlayer.tsx; styles impara.css
// (.ip-prep*, .ip-topics*).
import { useEffect, useState, type ReactNode } from 'react';
import { PREP_PHASES, type Lesson, type PrepPhase } from '@shared/lesson';
import type { LessonTopics } from '@shared/web-topics';
import { clarifyLesson, dropTopic, searchTopicsNow } from '../../lib/impara';
import { t } from '../../i18n';
import { Button } from '../ui';
import { SourceChips } from './ImparaSources';
import { IconCheck, IconGlobe, IconSpinner, IconX } from '../Icons';

function why(code: string | undefined): string {
  if (!code) return '';
  if (code === 'pr' || code === 'off' || code === 'none' || code === 'noask' || code === 'filtered' || code === 'dropped') return t(`impara.prep.why.${code}`);
  return t('impara.prep.why.failed');
}

function Phase({ state, label, extra }: { state: 'now' | 'done' | 'skip' | undefined; label: string; extra?: ReactNode }) {
  return (
    <li className={state ?? ''} data-state={state ?? 'wait'}>
      <span className="ip-prep-ic">{state === 'done' ? <IconCheck size={12} /> : state === 'now' ? <IconSpinner size={12} /> : state === 'skip' ? '–' : <span className="ip-dot" />}</span>
      <span className="ip-prep-l">{label}{extra ? <small>{extra}</small> : null}</span>
    </li>
  );
}

export function ImparaPrep({ lesson }: { lesson: Lesson }) {
  const p = lesson.prep ?? { phases: { gather: 'now' } };
  const ph = p.phases;
  const label = (k: PrepPhase): string => k === 'gather' ? t(lesson.kind === 'pr' ? 'impara.preparing.readPr' : lesson.kind === 'text' ? 'impara.preparing.readText' : 'impara.preparing.topic')
    : k === 'plan' ? t('impara.preparing.plan') : t(`impara.prep.${k}`);
  const extra = (k: PrepPhase): ReactNode => {
    if (ph[k] === 'skip') return why(p.why?.[k]);
    if (k === 'web' && p.web !== undefined) return t('impara.prep.found', { n: p.web });
    if (k === 'files' && p.files !== undefined) return t('impara.prep.found', { n: p.files });
    if (k === 'refs' && p.refs !== undefined) return t('impara.prep.found', { n: p.refs });
    if (k === 'verify' && ph.verify === 'done') return t('impara.prep.checked', { ok: p.ok ?? 0, fixed: p.fixed ?? 0, unsure: p.unsure ?? 0, dropped: p.dropped ?? 0 });
    if (p.why?.[k]) return why(p.why[k]);
    return null;
  };
  // the ask and refs phases show only when there is something to ask or search, or once it is settled
  const shown = PREP_PHASES.filter(k => (k !== 'ask' && k !== 'refs') || ph[k]);
  return (
    <div className="ip-preparing" data-testid="impara-preparing" role="status" aria-live="polite">
      <div className="ip-sketch" aria-hidden="true"><i /><i /><i /><b /><b /></div>
      <h3>{t('impara.preparing.title')}</h3>
      <ol className="ip-prep-steps" data-testid="impara-prep-steps">
        {shown.map(k => <Phase key={k} state={ph[k]} label={label(k)} extra={extra(k)} />)}
      </ol>
      {p.topics && p.topics.list.length > 0 && <Topics id={lesson.id} topics={p.topics} />}
      {lesson.facts?.length ? <SourceChips facts={lesson.facts} /> : null}
      {lesson.clarify && !lesson.clarify.answers && <Clarify lesson={lesson} />}
      <p className="ip-muted">{t('impara.preparing.hint')}</p>
    </div>
  );
}

/** The public topics from the user's files (ADR 0206): what goes to the web, each with why (from which file: the
 *  file stays here); while they wait, ✕ drops one and a countdown says when they start. */
function Topics({ id, topics }: { id: string; topics: LessonTopics }) {
  const waiting = topics.state === 'wait';
  const left = useCountdown(waiting ? topics.at : undefined);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const fileName = (ref: string) => ref.replace(/:\d+(?:[-:]\d+)?$/, '').split(/[\\/]/).pop() ?? '';
  return (
    <div className={`ip-topics ${topics.state}`} data-testid="impara-topics" data-state={topics.state} role="group" aria-label={t('impara.topics.title')}>
      <div className="ip-topics-head">
        <IconGlobe size={13} />
        <span className="ip-topics-title">{t('impara.topics.title')}</span>
        <span className="ip-topics-status" aria-live="polite">
          {waiting ? t('impara.topics.wait', { n: left }) : topics.state === 'go' ? <><IconSpinner size={11} /> {t('impara.topics.go')}</> : topics.state === 'done' ? t('impara.topics.done') : null}
        </span>
        {waiting && <Button variant="primary" size="s" onClick={() => void act(() => searchTopicsNow(id))} disabled={busy} testid="impara-topics-go">{t('impara.topics.now')}</Button>}
      </div>
      {waiting && topics.at && <i key={topics.at} className="ip-topics-bar" style={{ animationDuration: `${Math.max(0, topics.at - Date.now())}ms` }} aria-hidden="true" />}
      <ul className="ip-topics-list">
        {topics.list.map(x => (
          <li key={x.id} className="ip-topic" data-testid="impara-topic" data-tip={[x.why, fileName(x.ref) && t('impara.topics.from', { file: fileName(x.ref) })].filter(Boolean).join(' · ') || undefined}>
            <span className="ip-topic-q">{x.q}</span>
            {waiting && <button type="button" className="ip-topic-x" onClick={() => void act(() => dropTopic(id, x.id))} disabled={busy} aria-label={t('impara.topics.drop', { q: x.q })} data-testid="impara-topic-drop"><IconX size={10} /></button>}
          </li>
        ))}
      </ul>
      <p className="ip-topics-note">{t('impara.topics.note')}{topics.dropped ? ` ${t('impara.topics.filtered', { n: topics.dropped })}` : ''}</p>
    </div>
  );
}

/** Whole seconds left until `at` (ms of the real clock), ticking; 0 once past or without a deadline. */
function useCountdown(at: number | undefined): number {
  const calc = () => (at ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 0);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!at) return;
    const timer = setInterval(() => setLeft(calc()), 250);
    return () => clearInterval(timer);
  }, [at]);
  return left;
}

function Clarify({ lesson }: { lesson: Lesson }) {
  const qs = lesson.clarify!.qs;
  const [answers, setAnswers] = useState<string[]>(() => qs.map(() => ''));
  const [other, setOther] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const send = async (list: string[]) => { if (sending) return; setSending(true); await clarifyLesson(lesson.id, list); setSending(false); };
  const set = (i: number, v: string) => setAnswers(a => a.map((x, k) => (k === i ? v : x)));
  return (
    <div className="ip-clarify" data-testid="impara-clarify" role="group" aria-label={t('impara.clarify.title')}>
      <div className="ip-kicker">{t('impara.clarify.title')}</div>
      {qs.map((q, i) => (
        <div key={i} className="ip-clarify-q">
          <b>{q.q}</b>
          <div className="ip-chips" role="radiogroup" aria-label={q.q}>
            {q.options.map((o, k) => (
              <button key={k} type="button" role="radio" aria-checked={answers[i] === o} className={`ip-chip ${answers[i] === o ? 'on' : ''}`} onClick={() => { set(i, o); setOther(null); }} data-testid={`impara-clarify-${i}-${k}`}>{o}</button>
            ))}
            <button type="button" className={`ip-chip ${other === i ? 'on' : ''}`} onClick={() => { setOther(i); set(i, ''); }} data-testid={`impara-clarify-${i}-other`}>{t('impara.clarify.other')}</button>
          </div>
          {other === i && <input className="ip-clarify-in" autoFocus value={answers[i]} onChange={e => set(i, e.target.value)} maxLength={300} placeholder={t('impara.clarify.otherPlaceholder')} data-testid={`impara-clarify-${i}-text`} />}
        </div>
      ))}
      <div className="ip-row">
        <Button variant="primary" onClick={() => void send(answers)} disabled={sending || answers.every(a => !a.trim())} testid="impara-clarify-send">{t('impara.clarify.send')}</Button>
        <Button variant="ghost" onClick={() => void send(qs.map(() => ''))} disabled={sending} testid="impara-clarify-skip">{t('impara.clarify.skip')}</Button>
        <span className="ip-muted">{t('impara.clarify.hint')}</span>
      </div>
    </div>
  );
}
