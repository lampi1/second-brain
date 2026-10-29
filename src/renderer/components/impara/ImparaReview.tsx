// A review session of Impara (ADR 0189; owner, 2026-10-29: «una sorta di ripasso a quiz su ogni materia»): today's due
// cards, or one subject's quiz with its lessons mixed. One card at a time, full screen like a lesson: a question to
// answer in one's head and then check (recall: «Mostra la risposta», then Non ricordavo / Difficile / Giusto / Facile),
// a choice (A-D: a wrong one counts as forgotten; a right one asks how it felt), or a part of the lesson's diagram to
// click (LessonStage with pickable nodes). After each answer: why, and the verified facts the card stands on with their
// sources. A forgotten card comes back once at the end of the session. The grade goes to main at once (FSRS schedules
// the next review), so leaving halfway loses nothing. Used by ImparaPage.tsx; styles impara.css (.rv-*).
import { useEffect, useMemo, useRef, useState } from 'react';
import { REVIEW_GRADES, gradeOf, type ReviewGrade, type ReviewItem } from '@shared/review';
import { go } from '../../actions';
import { gradeCard, imparaPrefs, reviewQueue, setImparaPrefs } from '../../lib/impara';
import { t } from '../../i18n';
import { Button, Kbd } from '../ui';
import { IconArrowLeft, IconArrowRight, IconCheck, IconFile, IconGlobe, IconLightbulb, IconMaximize, IconMinimize, IconSpinner } from '../Icons';
import { LessonStage } from './LessonStage';
import { hostOf, openFact } from './ImparaSources';

const LETTERS = ['A', 'B', 'C', 'D'];
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]') !== null;

type Done = { id: string; grade: ReviewGrade };

export function ImparaReview({ subject }: { subject?: string }) {
  const full = imparaPrefs.use(p => p.full);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [i, setI] = useState(0);
  const [done, setDone] = useState<Done[]>([]);
  const [round, setRound] = useState(0);
  const again = useRef(new Set<string>());
  useEffect(() => {
    let alive = true;
    setItems(null); setI(0); setDone([]); again.current = new Set();
    void reviewQueue(subject ? 'quiz' : 'due', subject).then(x => { if (alive) setItems(x ?? []); });
    return () => { alive = false; };
  }, [subject, round]);

  const item = items?.[i] ?? null;
  const title = subject ? t('impara.rv.quizOf', { subject }) : t('impara.rv.today');
  const finish = (g: ReviewGrade) => {
    if (!item) return;
    void gradeCard(item.card.id, g);
    setDone(d => [...d, { id: item.card.id, grade: g }]);
    // a forgotten card comes back once, at the end of this session
    if (g === 1 && !again.current.has(item.card.id)) { again.current.add(item.card.id); setItems(xs => (xs ? [...xs, item] : xs)); }
    setI(n => n + 1);
  };

  // Esc leaves the full screen first, as in a lesson
  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTyping(e.target) || document.querySelector('.modal-backdrop, .backdrop, .qwin, .vw-layer, [role=dialog], [role=menu]')) return;
      e.preventDefault(); e.stopPropagation();
      setImparaPrefs({ full: false });
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [full]);

  const total = items?.length ?? 0;
  return (
    <div className={`ip-player rv ${full ? 'ip-full' : ''}`} data-testid="impara-review" data-full={full ? 'true' : 'false'}>
      <header className="ip-head">
        <Button variant="ghost" size="s" onClick={() => go({ page: 'impara' })} testid="impara-back" tip={t('impara.backList')} aria-label={t('impara.backList')}><IconArrowLeft size={13} /></Button>
        <div className="ip-head-title">
          <div className="ip-kicker">{t('impara.rv.kicker')}</div>
          <h2 data-testid="impara-review-title">{title}</h2>
        </div>
        <span className="sp" />
        {items && item && <span className="rv-count" data-testid="impara-review-count">{t('impara.rv.nOf', { n: Math.min(i + 1, total), total })}</span>}
        <Button variant="ghost" size="s" onClick={() => setImparaPrefs({ full: !full })} testid="impara-fullscreen" aria-pressed={full}
          tip={full ? `${t('impara.fullOff')}|Esc` : t('impara.fullOn')} aria-label={full ? t('impara.fullOff') : t('impara.fullOn')}>{full ? <IconMinimize size={13} /> : <IconMaximize size={13} />}</Button>
      </header>
      {items && total > 0 && <div className="rv-progress" aria-hidden="true"><i style={{ width: `${Math.round((Math.min(i, total) / total) * 100)}%` }} /></div>}
      {!items ? <div className="ip-center"><IconSpinner size={18} /></div>
        : !item ? <End done={done} empty={!total} onAgain={subject ? () => setRound(r => r + 1) : undefined} />
        : <Card key={`${item.card.id}/${i}`} item={item} onGrade={finish} />}
    </div>
  );
}

function Card({ item, onGrade }: { item: ReviewItem; onGrade: (g: ReviewGrade) => void }) {
  const c = item.card;
  const [shown, setShown] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const answered = c.kind === 'recall' ? shown : c.kind === 'choice' ? choice !== null : pick !== null;
  const right = c.kind === 'choice' ? choice === c.correct : c.kind === 'node' ? pick === c.node : null;
  const answer = (k: number) => { if (choice === null) setChoice(k); };
  // «Non lo so»: counts as forgotten and shows the answer (also the way past a diagram that cannot be drawn)
  const dunno = () => { if (c.kind === 'choice') setChoice(-1); else setPick(''); };
  const marks = useMemo(() => (pick && c.node ? { [c.node]: 'right' as const, ...(pick !== c.node ? { [pick]: 'wrong' as const } : {}) } : undefined), [pick, c.node]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('.modal-backdrop, .backdrop')) return;
      // Enter or Space on a focused button is that button's click, not a grade (an option already answered is disabled)
      const on = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('button, a, [role=button]') : null;
      if ((e.key === 'Enter' || e.key === ' ') && on && !(on instanceof HTMLButtonElement && on.disabled)) return;
      if (!answered) {
        if (c.kind === 'recall' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setShown(true); }
        if (c.kind === 'choice') {
          const k = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(e.key.toLowerCase());
          if (k >= 0 && k < (c.options?.length ?? 0)) { e.preventDefault(); answer(k); }
        }
        return;
      }
      // wrong: Enter goes on (forgotten); recall: 1-4 = the four grades; right: 1-3 = hard, good, easy; Enter = good
      if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); onGrade(right === false ? 1 : 3); return; }
      const n = '1234'.indexOf(e.key) + 1;
      if (right === null && n >= 1) { e.preventDefault(); onGrade(n as ReviewGrade); }
      else if (right === true && n >= 1 && n <= 3) { e.preventDefault(); onGrade((n + 1) as ReviewGrade); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <div className={`rv-card ${c.kind === 'node' ? 'rv-wide' : ''}`} data-testid="impara-review-card" data-kind={c.kind}>
      <div className="rv-meta"><span className="ip-tag">{t(`impara.rv.kind.${c.kind}`)}</span><span className="ip-muted">{item.lesson}</span></div>
      <h3 className="rv-q" data-testid="impara-review-q">{c.q}</h3>

      {c.kind === 'choice' && c.options?.map((o, k) => {
        const cls = choice === null ? '' : k === c.correct ? 'good' : k === choice ? 'bad' : 'off';
        return (
          <button key={k} type="button" className={`ip-opt ${cls}`} disabled={choice !== null} onClick={() => answer(k)} data-testid={`impara-review-opt-${k}`}>
            <span className="ip-opt-k">{LETTERS[k]}</span><span className="ip-opt-t">{o}</span>
          </button>
        );
      })}
      {c.kind === 'node' && item.diagram && (
        <>
          <div className="rv-stage">
            <LessonStage code={item.diagram} beat={{ focus: [] }} done={[]} whole onWhole={() => {}} caption={c.q} beatKey={c.id} onPick={pick === null ? setPick : undefined} marks={marks} />
          </div>
          {pick === null && <p className="ip-muted rv-hint">{t('impara.rv.pickHint')}</p>}
        </>
      )}
      {c.kind !== 'recall' && !answered && (
        <div className="rv-dunno"><Button variant="ghost" size="s" onClick={dunno} testid="impara-review-dunno">{t('impara.rv.dunno')}</Button></div>
      )}
      {c.kind === 'recall' && !shown && (
        <div className="rv-recall">
          <p className="ip-muted">{t('impara.rv.recallHint')}</p>
          <Button variant="primary" onClick={() => setShown(true)} testid="impara-review-show">{t('impara.rv.show')} <Kbd>Spazio</Kbd></Button>
        </div>
      )}

      {answered && <>
        <div className={`ip-fb ${right === false ? 'ko' : 'ok'} rv-answer`} data-testid="impara-review-answer">
          {right !== null && <b>{right ? t('impara.check.rightTitle') : t('impara.check.wrongTitle')}</b>} {c.answer}
        </div>
        {item.facts.length > 0 && (
          <ul className="rv-facts" data-testid="impara-review-facts">
            {item.facts.map(f => (
              <li key={f.id}>
                {f.from === 'web' ? <IconGlobe size={11} /> : f.from === 'file' ? <IconFile size={11} /> : <IconLightbulb size={11} />}
                <span>{f.claim}</span>
                {f.from === 'web' ? <a href={f.ref} target="_blank" rel="noreferrer" className="ip-src-link">{hostOf(f.ref)}</a>
                  : f.from === 'file' ? <button type="button" className="ip-link rv-file" onClick={() => openFact(f.ref)}>{f.ref.split(/[\\/]/).pop()}</button> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="rv-grades" role="group" aria-label={t('impara.rv.how')}>
          {right === false
            ? <Button variant="primary" onClick={() => onGrade(gradeOf(false))} testid="impara-review-next">{t('impara.next')} <IconArrowRight size={13} /></Button>
            : <>
              <span className="ip-muted">{t('impara.rv.how')}</span>
              {(right === null ? REVIEW_GRADES : REVIEW_GRADES.slice(1)).map(g => (
                <button key={g} type="button" className={`rv-g g${g}`} onClick={() => onGrade(g)} data-testid={`impara-review-grade-${g}`}>
                  <b>{t(`impara.rv.grade.${g}`)}</b><small>{right === null ? g : g - 1}</small>
                </button>
              ))}
            </>}
        </div>
      </>}
    </div>
  );
}

function End({ done, empty, onAgain }: { done: Done[]; empty: boolean; onAgain?: () => void }) {
  // the first answer of each card counts (a forgotten one asked again does not count twice)
  const first = new Map<string, ReviewGrade>();
  for (const d of done) if (!first.has(d.id)) first.set(d.id, d.grade);
  const right = [...first.values()].filter(g => g > 1).length;
  return (
    <div className="rv-end" data-testid="impara-review-end">
      {empty
        ? <><div className="rv-end-ic"><IconCheck size={22} /></div><h3>{t('impara.rv.nothing')}</h3><p className="ip-muted">{t('impara.rv.nothingHint')}</p></>
        : <>
          <div className="rv-end-ic">{right === first.size ? <IconCheck size={22} /> : <span>{right}/{first.size}</span>}</div>
          <h3 data-testid="impara-review-score">{t('impara.rv.endTitle', { right, n: first.size })}</h3>
          <p className="ip-muted">{t('impara.rv.endHint')}</p>
        </>}
      <div className="ip-row">
        <Button variant="primary" onClick={() => go({ page: 'impara' })} testid="impara-review-done">{t('impara.rv.backHome')}</Button>
        {!empty && onAgain && <Button onClick={onAgain} testid="impara-review-more">{t('impara.rv.again')}</Button>}
      </div>
    </div>
  );
}
