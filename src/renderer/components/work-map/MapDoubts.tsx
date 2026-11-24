// What was not clear in a job, on its map (ADR 0343, 0344), over the drawing and under the buttons: every doubt of the plan
// with its state and how it was closed (the user's answer, the code, the brain, the Strategist's choice) and the source;
// every question a chat of the map asked, its way up, who holds it or who answered and why. An open doubt says that it
// holds the approval. Used by WorkMapView.tsx.
import { ladderText, type LadderStep } from '@shared/question-ladder';
import type { PlanDoubt } from '@shared/plan-doubts';
import type { WorkAsk, WorkMapView as View } from '@shared/work-map';
import { openChatRef } from '../../actions';
import { t } from '../../i18n';
import { ago } from '../../lib/format';
import { IconChat } from '../Icons';

function Doubt({ d, i }: { d: PlanDoubt; i: number }) {
  // his answer to a question with the doubt's own words: the source says nothing more
  const source = d.source && !(d.by === 'user' && (d.source === d.text || d.source === d.answer)) ? d.source : '';
  return <li className="wm-doubt" data-s={d.state} data-testid={`wm-doubt-${i}`}>
    <i aria-hidden="true">{d.state === 'open' ? '?' : '✓'}</i>
    <div>
      <b>{d.text}</b>
      {d.state === 'open' ? <em>{t('wm.doubt.open')}</em> : <>
        <span data-testid={`wm-doubt-answer-${i}`}>{d.answer}</span>
        <small data-by={d.by}>{d.by ? t(`wm.doubt.by.${d.by}`) : ''}{source && <> · {source}</>}</small>
      </>}
    </div>
  </li>;
}

const whoOf = (s: Pick<LadderStep, 'level' | 'name'>): string => (s.level === 'user' ? t('wm.q.you') : s.name);
function Way({ trail }: { trail: readonly LadderStep[] }) {
  // the answer has its own line
  const steps = trail.filter(s => s.action !== 'answered');
  return <ol className="wm-way">{steps.map((s, i) => <li key={i}>{t(`wm.q.${s.action as 'asked' | 'passed' | 'skipped'}`, { who: whoOf(s) })}{s.why ? `: ${s.why}` : ''}</li>)}</ol>;
}

function Question({ a, i, now }: { a: WorkAsk; i: number; now: number }) {
  const { question: q } = a, done = q.answered;
  const state = done ? 'done' : q.level === 'user' ? 'you' : 'held';
  const holder = q.trail.findLast(s => s.level === q.level)?.name ?? '';
  return <li className="wm-q" data-s={state} data-testid={`wm-q-${i}`}>
    <div className="wm-q-head">
      <button type="button" className="wm-boxchat" onClick={() => openChatRef(a.chatId)} title={a.title} data-testid={`wm-q-chat-${i}`}><IconChat size={11} /><span>{a.title}</span></button>
      {a.n !== undefined && <small>{t('wm.side.step', { n: a.n })}</small>}
      <small>{ago(q.at, now)}</small>
    </div>
    <b className="wm-pre">{ladderText(q)}</b>
    <Way trail={q.trail} />
    {done ? <p data-testid={`wm-q-answer-${i}`}>{done.by === 'user' ? t('wm.q.youAnswered', { answer: done.answer }) : t('wm.q.answered', { who: done.name, answer: done.answer })}{done.by !== 'user' && done.why ? <small>{t('wm.q.why', { why: done.why })}</small> : null}</p>
      : <p data-testid={`wm-q-holder-${i}`}>{state === 'you' ? t('wm.waits.user') : t('wm.q.held', { who: holder })}</p>}
  </li>;
}

export function MapDoubts({ view, now }: { view: View; now: number }) {
  const { map, questions } = view, doubts = map.plan?.doubts ?? [], over = map.state === 'finished' || map.state === 'archived';
  const open = over ? 0 : doubts.filter(d => d.state === 'open').length, asking = questions.filter(q => !q.question.answered).length;
  if (!doubts.length && !questions.length) return null;
  return <section className="wm-doubts" data-testid="wm-doubts" aria-label={t('wm.doubts.label')}>
    {doubts.length > 0 && <details open={!over} data-open={open ? '' : undefined} data-testid="wm-doubts-list">
      <summary>{t('wm.doubts.title')} <small>{open ? t('wm.doubts.open', { n: open }) : t('wm.doubts.closed', { n: doubts.length })}</small></summary>
      <ul>{doubts.map((d, i) => <Doubt key={i} d={d} i={i} />)}</ul>
    </details>}
    {questions.length > 0 && <details open={!over} data-testid="wm-questions">
      <summary>{t('wm.q.title')} <small>{asking ? t('wm.q.open', { n: asking }) : t('wm.q.allAnswered', { n: questions.length })}</small></summary>
      <ul>{questions.map((a, i) => <Question key={a.question.id} a={a} i={i} now={now} />)}</ul>
    </details>}
  </section>;
}
