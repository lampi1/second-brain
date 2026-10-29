// A lesson being prepared (ADR 0188): the research as it goes, phase by phase (the material read; the web searched,
// seeing only the user's question; the files read: material, brain, app; each fact checked by a second model; the
// questions; the plan), with what each found and why one was skipped, the sources found once checked, and, when the ask can mean different things, the
// questions to answer (an option, a few words of one's own, or «Salta, decidi tu») while the facts are checked. Used by
// ImparaPlayer.tsx; styles impara.css (.ip-prep*).
import { useState, type ReactNode } from 'react';
import { PREP_PHASES, type Lesson, type PrepPhase } from '@shared/lesson';
import { clarifyLesson } from '../../lib/impara';
import { t } from '../../i18n';
import { Button } from '../ui';
import { SourceChips } from './ImparaSources';
import { IconCheck, IconSpinner } from '../Icons';

function why(code: string | undefined): string {
  if (!code) return '';
  if (code === 'pr' || code === 'off' || code === 'none') return t(`impara.prep.why.${code}`);
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
    if (k === 'verify' && ph.verify === 'done') return t('impara.prep.checked', { ok: p.ok ?? 0, fixed: p.fixed ?? 0, unsure: p.unsure ?? 0, dropped: p.dropped ?? 0 });
    if (p.why?.[k]) return why(p.why[k]);
    return null;
  };
  // the ask phase shows only when there is something to ask, or once it is settled
  const shown = PREP_PHASES.filter(k => k !== 'ask' || ph.ask);
  return (
    <div className="ip-preparing" data-testid="impara-preparing" role="status" aria-live="polite">
      <div className="ip-sketch" aria-hidden="true"><i /><i /><i /><b /><b /></div>
      <h3>{t('impara.preparing.title')}</h3>
      <ol className="ip-prep-steps" data-testid="impara-prep-steps">
        {shown.map(k => <Phase key={k} state={ph[k]} label={label(k)} extra={extra(k)} />)}
      </ol>
      {lesson.facts?.length ? <SourceChips facts={lesson.facts} /> : null}
      {lesson.clarify && !lesson.clarify.answers && <Clarify lesson={lesson} />}
      <p className="ip-muted">{t('impara.preparing.hint')}</p>
    </div>
  );
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
