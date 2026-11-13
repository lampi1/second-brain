// One question of Impara, whatever its kind (ADR 0204, shared/quiz.ts): pick one option (choice and predict, A-D or
// 1-4), true or false (V/F, 1-2), complete the code (the blank lit in the code, its candidates as options), put the
// steps in order (click them in order: each gets its number; a click on a numbered one takes it and the ones after it
// back; 1-9 picks, Backspace undoes, Enter checks), match the pairs (a term, then what it does; Enter checks). The
// answer is shown at once like Duolingo and Brilliant do: colour on each option, the app's own sound (lib/sounds.ts,
// ADR 0151, when the app's sounds are on) and a short pop or shake, off for reduced motion. Used by ImparaCheck.tsx (a
// lesson's check) and ImparaReview.tsx (a review card); styles impara-quiz.css (.qz-*).
import { useEffect, useMemo, useRef, useState } from 'react';
import { shuffled, BLANK, type QuizBody, type QuizResponse } from '@shared/quiz';
import { app } from '../../store/store';
import { playSound } from '../../lib/sounds';
import { t } from '../../i18n';
import { Button, Kbd } from '../ui';
import { IconCheck, IconX } from '../Icons';
import '../../styles/impara-quiz.css';

export const LETTERS = ['A', 'B', 'C', 'D'];
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]') !== null;

/** The feedback sound of an answer: the app's success or error sound, when its sounds are on (Settings → Avvisi). */
export function answerSound(right: boolean): void {
  if (app.get().settings?.tasks?.sound === false) return;
  playSound(right ? 'success' : 'error');
}

export interface QuizDone { response: QuizResponse; right: boolean }

/** `keys`: this component answers the pick kinds' keys itself (the lesson's player does it for its checks). `fresh`:
 *  the answer was just given here (sound and animation), not reopened. */
export function ImparaQuiz({ body, seed, done, onAnswer, keys, fresh, testid = 'impara-quiz', opt = 'impara-opt' }: {
  body: QuizBody; seed: string; done: QuizDone | null; onAnswer: (r: QuizResponse) => void; keys: boolean; fresh: boolean; testid?: string; opt?: string;
}) {
  const fx = done && fresh ? (done.right ? 'qz-ok' : 'qz-ko') : '';
  return (
    <div className={`qz qz-is-${body.kind} ${fx}`} data-testid={testid} data-kind={body.kind} data-state={done ? (done.right ? 'right' : 'wrong') : 'open'}>
      {body.kind === 'order' ? <Order body={body} seed={seed} done={done} onAnswer={onAnswer} />
        : body.kind === 'match' ? <Match body={body} seed={seed} done={done} onAnswer={onAnswer} />
        : <Pick body={body} done={done} onAnswer={onAnswer} keys={keys} opt={opt} />}
    </div>
  );
}

function Pick({ body, done, onAnswer, keys, opt }: { body: QuizBody; done: QuizDone | null; onAnswer: (r: number) => void; keys: boolean; opt: string }) {
  const mine = typeof done?.response === 'number' ? done.response : null;
  const tf = body.kind === 'truefalse';
  useEffect(() => {
    if (!keys || done) return;
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('.modal-backdrop, .backdrop')) return;
      const k = e.key.toLowerCase();
      let i = '1234'.indexOf(k) >= 0 ? '1234'.indexOf(k) : 'abcd'.indexOf(k);
      if (tf && (k === 'v' || k === 't')) i = 0;
      if (tf && k === 'f') i = 1;
      if (i >= 0 && i < body.options.length) { e.preventDefault(); onAnswer(i); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [keys, done, tf, body.options.length, onAnswer]);
  return (
    <>
      {body.kind === 'cloze' && body.code && <Code code={body.code} fill={done ? body.options[body.correct] ?? null : null} right={done?.right ?? null} />}
      <div className={tf ? 'qz-tf' : 'qz-opts'} role="group">
        {body.options.map((o, i) => {
          const cls = !done ? '' : i === body.correct ? 'good' : i === mine ? 'bad' : 'off';
          return (
            <button key={i} type="button" className={`ip-opt ${tf ? 'qz-tf-opt' : ''} ${body.kind === 'cloze' ? 'qz-mono' : ''} ${cls}`} disabled={!!done} onClick={() => onAnswer(i)} data-testid={`${opt}-${i}`} aria-pressed={i === mine}>
              <span className="ip-opt-k">{tf ? (i === 0 ? <IconCheck size={12} /> : <IconX size={12} />) : LETTERS[i]}</span>
              <span className="ip-opt-t">{o}</span>
              {done && i === mine && <span className="ip-opt-mine">{t('impara.check.yours')}</span>}
              {done && i === body.correct && i !== mine && <span className="ip-opt-right">{t('impara.check.right')}</span>}
            </button>
          );
        })}
      </div>
      {!done && keys && <p className="ip-muted qz-hint">{t('impara.check.hint')} {tf ? <><Kbd>V</Kbd> / <Kbd>F</Kbd></> : <><Kbd>1</Kbd>–<Kbd>{String(body.options.length)}</Kbd></>}</p>}
    </>
  );
}

/** The cloze's code, its blank lit (filled with the right answer once given). */
function Code({ code, fill, right }: { code: string; fill: string | null; right: boolean | null }) {
  const [a, b] = code.split(BLANK);
  return (
    <pre className="qz-code" data-testid="impara-quiz-code"><code>{a}<mark className={`qz-blank ${right === null ? '' : right ? 'good' : 'bad'}`}>{fill ?? '  ?  '}</mark>{b}</code></pre>
  );
}

function useCheckKeys(on: boolean, check: () => void, undo?: () => void, pick?: (i: number) => void) {
  const ref = useRef({ check, undo, pick });
  ref.current = { check, undo, pick };
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('.modal-backdrop, .backdrop')) return;
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); ref.current.check(); }
      else if (e.key === 'Backspace' && ref.current.undo) { e.preventDefault(); ref.current.undo(); }
      else if (ref.current.pick && /^[1-9]$/.test(e.key)) { e.preventDefault(); ref.current.pick(Number(e.key) - 1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [on]);
}

function Order({ body, seed, done, onAnswer }: { body: QuizBody; seed: string; done: QuizDone | null; onAnswer: (r: number[]) => void }) {
  const items = body.items ?? [];
  const shown = useMemo(() => shuffled(items.length, seed), [items.length, seed]);
  const [seq, setSeq] = useState<number[]>([]);
  const given = Array.isArray(done?.response) ? done.response : done ? null : seq;
  const tap = (i: number) => { if (done) return; setSeq(s => (s.includes(i) ? s.slice(0, s.indexOf(i)) : [...s, i])); };
  const full = seq.length === items.length;
  const check = () => { if (!done && full) onAnswer(seq); };
  useCheckKeys(!done, check, () => setSeq(s => s.slice(0, -1)), k => { const i = shown[k]; if (i !== undefined) tap(i); });
  return (
    <>
      <ol className="qz-order" data-testid="impara-quiz-order">
        {shown.map((i, k) => {
          const pos = given ? given.indexOf(i) : -1;
          const cls = !done ? (pos >= 0 ? 'on' : '') : given ? (pos === i ? 'good' : 'bad') : (pos === i ? 'good' : 'off');
          return (
            <li key={i}>
              <button type="button" className={`qz-item ${cls}`} onClick={() => tap(i)} disabled={!!done} data-testid={`impara-order-${k}`} aria-pressed={pos >= 0}>
                <span className="qz-badge">{pos >= 0 ? pos + 1 : ''}</span>
                <span className="qz-item-t">{items[i]}</span>
                {done && <span className="qz-item-right">{pos === i ? <IconCheck size={12} /> : t('impara.q.goesAt', { n: i + 1 })}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {!done && (
        <div className="qz-act">
          <span className="ip-muted qz-hint">{t('impara.q.orderHint')}</span>
          <span className="sp" />
          {seq.length > 0 && <Button variant="ghost" size="s" onClick={() => setSeq([])} testid="impara-quiz-reset">{t('impara.q.reset')}</Button>}
          <Button variant="primary" disabled={!full} onClick={check} testid="impara-quiz-check">{t('impara.q.check')} <Kbd>↵</Kbd></Button>
        </div>
      )}
    </>
  );
}

function Match({ body, seed, done, onAnswer }: { body: QuizBody; seed: string; done: QuizDone | null; onAnswer: (r: number[]) => void }) {
  const left = body.items ?? [], right = body.pairs ?? [];
  const shown = useMemo(() => shuffled(right.length, `${seed}:m`), [right.length, seed]);
  // pick[i] = the right side paired with left i, or -1
  const [pick, setPick] = useState<number[]>(() => left.map(() => -1));
  const [sel, setSel] = useState<number | null>(null);
  const given = Array.isArray(done?.response) ? done.response : done ? left.map((_, i) => i) : pick;
  // a click on a term selects it (a paired one is unpaired first); the next click on the right pairs it
  const tapLeft = (i: number) => { if (done) return; if (pick[i]! >= 0) setPick(p => p.map((x, k) => (k === i ? -1 : x))); setSel(i); };
  const tapRight = (j: number) => {
    if (done) return;
    const owner = pick.indexOf(j);
    if (sel === null) { if (owner >= 0) setPick(p => p.map(x => (x === j ? -1 : x))); return; }
    setPick(p => p.map((x, k) => (k === sel ? j : x === j ? -1 : x)));
    // the next term still to pair, so a pair is two clicks
    setSel(() => { const next = pick.findIndex((x, k) => k !== sel && x < 0); return next >= 0 ? next : null; });
  };
  const full = pick.every(x => x >= 0);
  const check = () => { if (!done && full) onAnswer(pick); };
  useCheckKeys(!done, check);
  return (
    <>
      <div className="qz-match" data-testid="impara-quiz-match">
        <div className="qz-col">
          {left.map((l, i) => {
            const ok = done ? given[i] === i : null;
            return (
              <button key={i} type="button" className={`qz-item ${sel === i ? 'sel' : ''} ${pick[i]! >= 0 && !done ? 'on' : ''} ${ok === null ? '' : ok ? 'good' : 'bad'}`} onClick={() => tapLeft(i)} disabled={!!done} data-testid={`impara-match-l-${i}`}>
                <span className={`qz-badge c${i}`}>{i + 1}</span><span className="qz-item-t">{l}</span>
              </button>
            );
          })}
        </div>
        <div className="qz-col">
          {shown.map(j => {
            const owner = given.indexOf(j);
            const ok = done ? owner === j : null;
            return (
              <button key={j} type="button" className={`qz-item ${owner >= 0 && !done ? 'on' : ''} ${ok === null ? '' : ok ? 'good' : 'bad'}`} onClick={() => tapRight(j)} disabled={!!done} data-testid={`impara-match-r-${j}`}>
                <span className={`qz-badge ${owner >= 0 ? `c${owner}` : ''}`}>{owner >= 0 ? owner + 1 : ''}</span><span className="qz-item-t">{right[j]}</span>
                {done && !ok && <span className="qz-item-right">{t('impara.q.goesWith', { n: j + 1 })}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {!done && (
        <div className="qz-act">
          <span className="ip-muted qz-hint">{t('impara.q.matchHint')}</span>
          <span className="sp" />
          <Button variant="primary" disabled={!full} onClick={check} testid="impara-quiz-check">{t('impara.q.check')} <Kbd>↵</Kbd></Button>
        </div>
      )}
    </>
  );
}
