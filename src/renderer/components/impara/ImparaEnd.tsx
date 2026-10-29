// The end of a lesson (ADR 0185): «Spiegalo tu», the learner explains the whole thing in their own words (typed or said
// with «Rispondo a voce»; ICAP: constructive), one short run grades it (what they got, what they left out); then how
// each piece went (its checks, the extras it needed) with «Rivedi» on the weak ones, and the checks' score. Skipping
// the explanation ends the lesson without a grade. Under the whole diagram. Used by ImparaPlayer.tsx.
import { pieceScores, progressOf, stepKey, type Lesson } from '@shared/lesson';
import { go } from '../../actions';
import { t } from '../../i18n';
import { Button } from '../ui';
import { IconRefresh, IconSpinner } from '../Icons';

export function ImparaEnd({ lesson, draft, setDraft, onSend, onReview }: { lesson: Lesson; draft: string; setDraft: (s: string) => void; onSend: (text: string) => void; onReview: (key: string) => void }) {
  const ex = lesson.explain;
  const p = progressOf(lesson);
  const scores = pieceScores(lesson);
  const pct = p.answered ? Math.round((p.right / p.answered) * 100) : null;
  const grading = lesson.busy?.kind === 'grade';
  const first = lesson.steps.find(s => !s.extra);
  return (
    <div className="ip-end" data-testid="impara-end">
      <div className="ip-end-ask">
        <div className="ip-kicker">{t('impara.end.kicker')}</div>
        <h3>{ex?.q ?? t('impara.end.spokenAsk')}</h3>
        {!ex?.answer && !lesson.doneAt
          ? <>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder={t('impara.end.placeholder')} rows={4} maxLength={4000} data-testid="impara-explain-input" />
            <div className="ip-row">
              <Button variant="primary" onClick={() => onSend(draft)} disabled={!draft.trim()} testid="impara-explain-send">{t('impara.end.send')}</Button>
              <Button variant="ghost" onClick={() => onSend('')} testid="impara-explain-skip">{t('impara.end.skip')}</Button>
              <span className="sp" /><span className="ip-muted">{t('impara.end.micHint')}</span>
            </div>
          </>
          : <>
            {ex?.answer && <blockquote className="ip-mine" data-testid="impara-explain-answer">«{ex.answer}»</blockquote>}
            {grading && <div className="ip-busy" role="status"><IconSpinner size={13} />{t('impara.busy.grade')}</div>}
            {ex?.answer && !ex.grade && !grading && !lesson.doneAt && (
              <div className="ip-busy err" role="alert" data-testid="impara-grade-error">{lesson.busyError ?? t('impara.end.gradeLost')}
                <Button size="s" onClick={() => onSend(ex.answer!)} testid="impara-grade-retry"><IconRefresh size={12} />{t('impara.retry')}</Button></div>
            )}
            {ex?.grade && (
              <div className="ip-grade" data-testid="impara-grade">
                <span className={`ip-tag ${ex.grade === 'ok' ? 'green' : ex.grade === 'partial' ? 'amber' : 'red'}`}>{t(`impara.grade.${ex.grade}`)}</span>
                <span>{ex.feedback}</span>
                {ex.missing && <><span className="ip-tag amber">{t('impara.grade.missing')}</span><span>{ex.missing}</span></>}
              </div>
            )}
          </>}
      </div>
      <div className="ip-end-sum">
        <div className="ip-ring" style={{ ['--p' as string]: `${pct ?? 0}%` }} data-testid="impara-score">
          <div><b>{pct === null ? '—' : `${pct}%`}</b><span>{t('impara.end.checks', { right: p.right, n: p.answered })}</span></div>
        </div>
        <div className="ip-pieces">
          <div className="ip-label">{t('impara.end.byPiece')}</div>
          {scores.map(s => (
            <div key={s.id} className="ip-piece">
              <span className="ip-piece-t">{s.title}</span>
              <span className="ip-bar"><i style={{ width: `${Math.round((s.score ?? 1) * 100)}%` }} className={s.score === null ? 'none' : s.score < 0.6 ? 'weak' : ''} /></span>
              {s.score !== null && s.score < 0.6 ? <Button size="s" onClick={() => onReview(stepKey(s.id))} testid={`impara-review-${s.id}`}>{t('impara.end.review')}</Button> : <span className="ip-piece-pad" />}
            </div>
          ))}
          <div className="ip-row ip-end-acts">
            {first && <Button onClick={() => onReview(stepKey(first.id))} testid="impara-restart"><IconRefresh size={12} />{t('impara.end.restart')}</Button>}
            <Button variant="primary" onClick={() => go({ page: 'impara' })} testid="impara-new">{t('impara.end.new')}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
