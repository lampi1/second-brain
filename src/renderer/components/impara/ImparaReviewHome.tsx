// The review on Impara's start (ADR 0189): how many cards are due today (and new ones), the days in a row, «Ripassa
// ora»; then one tile per subject with its lessons, cards, what is due and the FSRS estimate of recall today over the
// cards already studied (never a score made up: «mai ripassata» until one is), and its «Quiz» (the subject's lessons
// mixed), and its level (ADR 0204: Iniziato, Familiare, Competente, Padroneggiato, ImparaScore.tsx MasteryBadge).
// `SubjectChip` moves a lesson to another subject. Used by ImparaStart.tsx; styles impara.css (.rv-*).
import { useRef, useState } from 'react';
import type { ReviewSummary } from '@shared/review';
import { go } from '../../actions';
import { reviewArg, setLessonSubject } from '../../lib/impara';
import { t } from '../../i18n';
import { Button, MenuItem, MenuLabel, MenuSep, Popover } from '../ui';
import { IconArrowRight, IconCheck } from '../Icons';
import { MasteryBadge } from './ImparaScore';

export function ImparaReviewHome({ review }: { review: ReviewSummary }) {
  if (!review.subjects.length) return null;
  const can = review.due + review.fresh > 0;
  const facts = [review.fresh ? t('impara.rv.fresh', { n: review.fresh }) : '', review.streak ? t('impara.rv.streak', { n: review.streak }) : '', review.reviewedToday ? t('impara.rv.doneToday', { n: review.reviewedToday }) : ''].filter(Boolean);
  return (
    <section className="rv-home" data-testid="impara-review-home">
      <div className="rv-today">
        <div className="rv-today-in">
          <div className="ip-kicker">{t('impara.rv.kicker')}</div>
          <h3 data-testid="impara-review-due">{review.due ? t('impara.rv.due', { n: review.due }) : t('impara.rv.noDue')}</h3>
          {facts.length > 0 && <p className="ip-muted">{facts.join(' · ')}</p>}
        </div>
        <Button variant="primary" disabled={!can} onClick={() => go({ page: 'impara', arg: reviewArg() })} testid="impara-review-start">{t('impara.rv.start')} <IconArrowRight size={13} /></Button>
      </div>
      <div className="rv-subjects" data-testid="impara-subjects">
        {review.subjects.map(s => {
          const pct = s.recall === null ? null : Math.round(s.recall * 100);
          return (
            <div key={s.name} className="rv-subj" data-testid="impara-subject" data-subject={s.name}>
              <div className="rv-subj-h"><b>{s.name}</b>{s.due ? <span className="ip-tag amber">{t('impara.rv.dueShort', { n: s.due })}</span> : s.cards && !s.fresh ? <span className="ip-tag green"><IconCheck size={10} />{t('impara.rv.upToDate')}</span> : null}</div>
              <span className="ip-muted">{t('impara.rv.counts', { lessons: s.lessons, cards: s.cards })}</span>
              {s.mastery && <MasteryBadge m={s.mastery} />}
              <div className="rv-recall-row" data-tip={t('impara.rv.recallTip')}>
                <span className="ip-bar"><i style={{ width: `${pct ?? 0}%` }} className={pct === null ? 'none' : pct < 70 ? 'weak' : ''} /></span>
                <span className="rv-recall-l" data-testid="impara-subject-recall">{pct === null ? t('impara.rv.never') : t('impara.rv.recall', { pct })}</span>
              </div>
              <Button size="s" disabled={!s.cards} onClick={() => go({ page: 'impara', arg: reviewArg(s.name) })} testid="impara-subject-quiz">{t('impara.rv.quiz')}</Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A lesson's subject on its card: a click moves it (and its cards) to another subject, or a new one. */
export function SubjectChip({ lessonId, subject, subjects }: { lessonId: string; subject: string; subjects: readonly string[] }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const save = (v: string) => { const s = v.trim(); setOpen(false); if (s && s !== subject) void setLessonSubject(lessonId, s); };
  return (
    <>
      <button ref={anchor} type="button" className="ip-subject" onClick={() => { setName(''); setOpen(o => !o); }} aria-haspopup="menu" aria-expanded={open} data-tip={t('impara.rv.moveTip')} data-testid="impara-subject-chip">{subject}</button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} testid="impara-subject-pop" width={240} align="start">
        <MenuLabel>{t('impara.rv.moveTo')}</MenuLabel>
        {subjects.map(s => <MenuItem key={s} checked={s === subject} onSelect={() => save(s)} testid={`impara-subject-pick-${s}`}>{s}</MenuItem>)}
        <MenuSep />
        <form className="ip-subject-new" onSubmit={e => { e.preventDefault(); save(name); }}>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder={t('impara.rv.newSubject')} aria-label={t('impara.rv.newSubject')} data-testid="impara-subject-input" />
          <Button size="s" variant="primary" type="submit" disabled={!name.trim()} testid="impara-subject-save">{t('impara.rv.save')}</Button>
        </form>
      </Popover>
    </>
  );
}
