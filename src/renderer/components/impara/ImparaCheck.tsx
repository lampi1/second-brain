// A check under the lesson's board (ADR 0185; mockup /mnt/project-files/ui-review/impara/3-A-verifica.png): the question
// (predict or choose), its options (click, 1-4 / A-D, or said aloud: «la b»), then the right one and why, the user's
// own marked, and «Eri sicuro?» (tirato a caso, abbastanza, sicurissimo: a wrong answer given with certainty is the one
// to look at again). No grade: it is there to fix the piece in memory (practice testing, Dunlosky et al. 2013). The
// first answer stays. Used by ImparaPlayer.tsx.
import type { LessonCheck, LessonConfidence } from '@shared/lesson';
import { t } from '../../i18n';
import { Button, Kbd } from '../ui';
import { IconArrowRight, IconRefresh } from '../Icons';

const LETTERS = ['A', 'B', 'C', 'D'];

export function ImparaCheck({ check, n, total, onAnswer, onConfidence, onNext, onReview, last }: {
  check: LessonCheck; n: number; total: number; onAnswer: (i: number) => void; onConfidence: (c: LessonConfidence) => void; onNext: () => void; onReview: () => void; last: boolean;
}) {
  const a = check.answer;
  const right = a ? a.choice === check.correct : false;
  return (
    <div className="ip-quiz" data-testid="impara-check" role="group" aria-label={check.q}>
      <div className="ip-row">
        <span className="ip-tag blue">{t('impara.check.nOf', { n, total })}</span>
        <span className="ip-tag">{t(`impara.check.kind.${check.kind}`)}</span>
        <span className="sp" /><span className="ip-muted">{t('impara.check.noGrade')}</span>
      </div>
      <h3 data-testid="impara-check-q">{check.q}</h3>
      {check.options.map((o, i) => {
        const cls = !a ? '' : i === check.correct ? 'good' : i === a.choice ? 'bad' : 'off';
        return (
          <button key={i} type="button" className={`ip-opt ${cls}`} disabled={!!a} onClick={() => onAnswer(i)} data-testid={`impara-opt-${i}`}>
            <span className="ip-opt-k">{LETTERS[i]}</span><span className="ip-opt-t">{o}</span>
            {a && i === a.choice && <span className="ip-opt-mine">{t('impara.check.yours')}</span>}
            {a && i === check.correct && i !== a.choice && <span className="ip-opt-right">{t('impara.check.right')}</span>}
          </button>
        );
      })}
      {!a && <p className="ip-muted ip-check-hint">{t('impara.check.hint')} <Kbd>1</Kbd>–<Kbd>{String(check.options.length)}</Kbd></p>}
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
