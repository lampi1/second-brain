// A check under the lesson's board (ADR 0185; kinds and feedback ADR 0204): the question, of any kind of shared/quiz.ts
// (ImparaQuiz.tsx: pick one, true or false, complete the code, put in order, match the pairs; a pick also by keys 1-4 /
// A-D, which the player handles, or said aloud: «la b»), then at once the colour, the app's sound and a short
// animation, why, and «Eri sicuro?» (tirato a caso, abbastanza, sicurissimo: a wrong answer given with certainty is
// the one to look at again). No grade: it is there to fix the piece in memory (practice testing, Dunlosky et al.
// 2013). The first answer stays. Used by ImparaPlayer.tsx.
import { useEffect, useRef } from 'react';
import type { LessonCheck, LessonConfidence } from '@shared/lesson';
import { isPick, type QuizResponse } from '@shared/quiz';
import { t } from '../../i18n';
import { Button } from '../ui';
import { IconArrowRight, IconRefresh } from '../Icons';
import { ImparaQuiz, answerSound } from './ImparaQuiz';

export function ImparaCheck({ check, n, total, onAnswer, onConfidence, onNext, onReview, last }: {
  check: LessonCheck; n: number; total: number; onAnswer: (r: QuizResponse) => void; onConfidence: (c: LessonConfidence) => void; onNext: () => void; onReview: () => void; last: boolean;
}) {
  const a = check.answer;
  const right = a ? a.choice === check.correct : false;
  // the answer given now (not a check reopened already answered) rings and moves once
  const seen = useRef<{ id: string; open: boolean; rung: boolean }>({ id: check.id, open: !a, rung: !!a });
  if (seen.current.id !== check.id) seen.current = { id: check.id, open: !a, rung: !!a };
  const fresh = !!a && seen.current.open;
  useEffect(() => {
    if (!a || seen.current.rung) return;
    seen.current.rung = true;
    answerSound(a.choice === check.correct);
  }, [a, check.correct]);
  return (
    <div className="ip-quiz" data-testid="impara-check" role="group" aria-label={check.q}>
      <div className="ip-row">
        <span className="ip-tag blue">{t('impara.check.nOf', { n, total })}</span>
        <span className="ip-tag">{t(`impara.check.kind.${check.kind}`)}</span>
        <span className="sp" /><span className="ip-muted">{t('impara.check.noGrade')}</span>
      </div>
      <h3 data-testid="impara-check-q">{check.q}</h3>
      {/* the player answers a pick's keys; order and match take theirs here */}
      <ImparaQuiz body={check} seed={check.id} done={a ? { response: a.seq ?? a.choice, right } : null} onAnswer={onAnswer} keys={false} fresh={fresh} testid="impara-check-quiz" />
      {!a && isPick(check.kind) && <p className="ip-muted ip-check-hint">{t('impara.check.hint')} 1–{check.options.length}</p>}
      {a && <>
        <div className={`ip-fb ${right ? 'ok' : 'ko'}`} data-testid="impara-check-why"><b>{right ? t('impara.check.rightTitle') : t('impara.check.wrongTitle')}</b> {check.why}</div>
        <div className="ip-conf-l ip-muted">{t('impara.check.sure')}</div>
        <div className="ip-conf" role="radiogroup" aria-label={t('impara.check.sure')}>
          {([0, 1, 2] as LessonConfidence[]).map(c => (
            <button key={c} type="button" role="radio" aria-checked={a.confidence === c} className={a.confidence === c ? 'on' : ''} disabled={a.confidence !== undefined} onClick={() => onConfidence(c)} data-testid={`impara-conf-${c}`}>{t(`impara.check.conf.${c}`)}</button>
          ))}
        </div>
      </>}
      <div className="ip-row ip-quiz-acts">
        <Button onClick={onReview} testid="impara-check-review"><IconRefresh size={12} />{t('impara.check.review')}</Button>
        <span className="sp" />
        {a ? <Button variant="primary" onClick={onNext} disabled={last} testid="impara-check-next">{t('impara.next')} <IconArrowRight size={13} /></Button>
          : <Button variant="ghost" onClick={onNext} disabled={last} testid="impara-check-skip">{t('impara.check.skip')}</Button>}
      </div>
    </div>
  );
}
