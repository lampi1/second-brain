// What was not clear in a job, on its map (ADR 0343, 0344), over the drawing and under the buttons: every doubt of the plan
// with its state and how it was closed (the user's answer, the code, the brain, the Strategist's choice) and the source;
// every question a chat of the map asked, its way up, who holds it or who answered and why. An open doubt says that it
// holds the approval. Used by PlanFull.tsx.
import { ladderText, type LadderStep } from '@shared/question-ladder';
import type { PlanDoubt } from '@shared/plan-doubts';
import type { PlanAsk, PlanFull as View } from '@shared/plan';
import { openChatRef } from '../../actions';
import { t } from '../../i18n';
import { ago } from '../../lib/format';
import { IconChat } from '../Icons';

function Doubt({ d, i }: { d: PlanDoubt; i: number }) {
  // his answer to a question with the doubt's own words: the source says nothing more
  const source = d.source && !(d.by === 'user' && (d.source === d.text || d.source === d.answer)) ? d.source : '';
  return <li className="pl-doubt" data-s={d.state} data-testid={`pl-doubt-${i}`}>
    <i aria-hidden="true">{d.state === 'open' ? '?' : '✓'}</i>
    <div>
      <b>{d.text}</b>
      {d.state === 'open' ? <em>{t('plans.doubt.open')}</em> : <>
        <span data-testid={`pl-doubt-answer-${i}`}>{d.answer}</span>
        <small data-by={d.by}>{d.by ? t(`plans.doubt.by.${d.by}`) : ''}{source && <> · {source}</>}</small>
      </>}
    </div>
  </li>;
}

const whoOf = (s: Pick<LadderStep, 'level' | 'name'>): string => (s.level === 'user' ? t('plans.q.you') : s.name);
function Way({ trail }: { trail: readonly LadderStep[] }) {
  // the answer has its own line
  const steps = trail.filter(s => s.action !== 'answered');
  return <ol className="pl-way">{steps.map((s, i) => <li key={i}>{t(`plans.q.${s.action as 'asked' | 'passed' | 'skipped'}`, { who: whoOf(s) })}{s.why ? `: ${s.why}` : ''}</li>)}</ol>;
}

function Question({ a, i, now }: { a: PlanAsk; i: number; now: number }) {
  const { question: q } = a, done = q.answered;
  const state = done ? 'done' : q.level === 'user' ? 'you' : 'held';
  const holder = q.trail.findLast(s => s.level === q.level)?.name ?? '';
  return <li className="pl-q" data-s={state} data-testid={`pl-q-${i}`}>
    <div className="pl-q-head">
      <button type="button" className="pl-boxchat" onClick={() => openChatRef(a.chatId)} title={a.title} data-testid={`pl-q-chat-${i}`}><IconChat size={11} /><span>{a.title}</span></button>
      {a.n !== undefined && <small>{t('plans.chats.step', { n: a.n })}</small>}
      <small>{ago(q.at, now)}</small>
    </div>
    <b className="pl-pre">{ladderText(q)}</b>
    <Way trail={q.trail} />
    {done ? <p data-testid={`pl-q-answer-${i}`}>{done.by === 'user' ? t('plans.q.youAnswered', { answer: done.answer }) : t('plans.q.answered', { who: done.name, answer: done.answer })}{done.by !== 'user' && done.why ? <small>{t('plans.q.why', { why: done.why })}</small> : null}</p>
      : <p data-testid={`pl-q-holder-${i}`}>{state === 'you' ? t('plans.waits.user') : t('plans.q.held', { who: holder })}</p>}
  </li>;
}

export function PlanDoubts({ view, now }: { view: View; now: number }) {
  const { record: map, questions } = view, doubts = map.plan?.doubts ?? [], over = map.state === 'finished' || map.state === 'archived';
  const open = over ? 0 : doubts.filter(d => d.state === 'open').length, asking = questions.filter(q => !q.question.answered).length;
  if (!doubts.length && !questions.length) return null;
  return <section className="pl-doubts" data-testid="pl-doubts" aria-label={t('plans.doubts.label')}>
    {doubts.length > 0 && <details open={!over} data-open={open ? '' : undefined} data-testid="pl-doubts-list">
      <summary>{t('plans.doubts.title')} <small>{open ? t('plans.doubts.open', { n: open }) : t('plans.doubts.closed', { n: doubts.length })}</small></summary>
      <ul>{doubts.map((d, i) => <Doubt key={i} d={d} i={i} />)}</ul>
    </details>}
    {questions.length > 0 && <details open={!over} data-testid="pl-questions">
      <summary>{t('plans.q.title')} <small>{asking ? t('plans.q.open', { n: asking }) : t('plans.q.allAnswered', { n: questions.length })}</small></summary>
      <ul>{questions.map((a, i) => <Question key={a.question.id} a={a} i={i} now={now} />)}</ul>
    </details>}
  </section>;
}
