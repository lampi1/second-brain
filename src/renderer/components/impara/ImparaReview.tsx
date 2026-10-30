// A review session of Impara (ADR 0189; quiz look ADR 0204): today's due cards, or one subject's quiz with its lessons
// mixed. One card at a time, full screen like a lesson: a question to answer in one's head and then check (recall:
// «Mostra la risposta», then Non ricordavo / Difficile / Giusto / Facile), a question of shared/quiz.ts (ImparaQuiz.tsx:
// pick one, true or false, complete the code, put in order, match the pairs: a wrong one counts as forgotten, a right
// one asks how it felt), or a part of the lesson's diagram to click (LessonStage with pickable nodes). The answer shows
// at once (colour, the app's sound, a short animation), then why and the verified facts the card stands on. Above: a bar
// with one segment per card, green or red as they are answered, and the streak of right answers. At the end: the score,
// the time, the cards FSRS strengthened, and «Rifai le sbagliate» (a practice round: no grade, the cards already have
// theirs). «Sfida a tempo» (never on by itself) gives each question CHALLENGE_S seconds. The grade goes to main at
// once (FSRS schedules the next review), so leaving halfway loses nothing. Used by ImparaPage.tsx; styles impara.css
// (.rv-*) and impara-quiz.css (.qz-*, .rv-seg, .rv-end2).
import { useEffect, useMemo, useRef, useState } from 'react';
import { REVIEW_GRADES, gradeOf, type ReviewCard, type ReviewGrade, type ReviewItem } from '@shared/review';
import { quizRight, type QuizBody, type QuizKind, type QuizResponse } from '@shared/quiz';
import { go } from '../../actions';
import { gradeCard, imparaPrefs, reviewQueue, setImparaPrefs } from '../../lib/impara';
import { app } from '../../store/store';
import { playSound } from '../../lib/sounds';
import { t } from '../../i18n';
import { Button, Kbd } from '../ui';
import { IconArrowLeft, IconArrowRight, IconBolt, IconCheck, IconFile, IconGlobe, IconLightbulb, IconMaximize, IconMinimize, IconRefresh, IconSpinner } from '../Icons';
import { LessonStage } from './LessonStage';
import { hostOf, openFact } from './ImparaSources';
import { ImparaQuiz, answerSound, type QuizDone } from './ImparaQuiz';
import { ScoreRing } from './ImparaScore';

/** seconds per question in «Sfida a tempo» */
export const CHALLENGE_S = 20;
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]') !== null;
const quizOf = (c: ReviewCard): QuizBody | null => (c.kind === 'recall' || c.kind === 'node' ? null
  : { kind: c.kind as QuizKind, q: c.q, options: c.options ?? [], correct: c.correct ?? 0, ...(c.items ? { items: c.items } : {}), ...(c.pairs ? { pairs: c.pairs } : {}), ...(c.code ? { code: c.code } : {}) });

/** One answered card: right at the first try, and whether FSRS strengthened it (its stability grew). */
interface Result { id: string; right: boolean; strengthened: boolean }

/** The streak of right answers at the end of the list, and the best one. */
export function streaks(results: readonly { right: boolean }[]): { now: number; best: number } {
  let now = 0, best = 0;
  for (const r of results) { now = r.right ? now + 1 : 0; best = Math.max(best, now); }
  return { now, best };
}

export function ImparaReview({ subject }: { subject?: string }) {
  const full = imparaPrefs.use(p => p.full);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [round, setRound] = useState(0);
  const [practice, setPractice] = useState(false);
  const [timed, setTimed] = useState(false);
  const started = useRef(Date.now());
  const [ended, setEnded] = useState<number | null>(null);
  const all = useRef<ReviewItem[]>([]);
  useEffect(() => {
    let alive = true;
    setItems(null); setI(0); setResults([]); setPractice(false); setEnded(null); started.current = Date.now();
    void reviewQueue(subject ? 'quiz' : 'due', subject).then(x => { if (alive) { all.current = x ?? []; setItems(x ?? []); } });
    return () => { alive = false; };
  }, [subject, round]);

  const item = items?.[i] ?? null;
  const total = items?.length ?? 0;
  useEffect(() => { if (items && total && i >= total && ended === null) setEnded(Date.now()); }, [items, total, i, ended]);
  const title = subject ? t('impara.rv.quizOf', { subject }) : t('impara.rv.today');
  const finish = (g: ReviewGrade, right: boolean) => {
    if (!item) return;
    const id = item.card.id, before = item.card.mem?.s ?? 0;
    setResults(r => [...r, { id, right, strengthened: false }]);
    // a practice round («Rifai le sbagliate») grades nothing: the cards already have today's grade
    if (!practice) {
      void gradeCard(id, g).then(c => {
        if (c?.mem && g > 1 && c.mem.s > before) setResults(rs => rs.map(x => (x.id === id ? { ...x, strengthened: true } : x)));
      });
    }
    setI(n => n + 1);
  };
  const redo = () => {
    const wrong = new Set(results.filter(r => !r.right).map(r => r.id));
    setItems(all.current.filter(x => wrong.has(x.card.id)));
    setI(0); setResults([]); setPractice(true); setEnded(null); started.current = Date.now();
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

  const streak = streaks(results);
  return (
    <div className={`ip-player rv ${full ? 'ip-full' : ''}`} data-testid="impara-review" data-full={full ? 'true' : 'false'}>
      <header className="ip-head">
        <Button variant="ghost" size="s" onClick={() => go({ page: 'impara' })} testid="impara-back" tip={t('impara.backList')} aria-label={t('impara.backList')}><IconArrowLeft size={13} /></Button>
        <div className="ip-head-title">
          <div className="ip-kicker">{practice ? t('impara.q.practiceKicker') : t('impara.rv.kicker')}</div>
          <h2 data-testid="impara-review-title">{title}</h2>
        </div>
        <span className="sp" />
        {streak.now >= 2 && item && <span className="rv-streak" data-testid="impara-review-streak"><IconBolt size={12} />{t('impara.q.streak', { n: streak.now })}</span>}
        {items && item && <span className="rv-count" data-testid="impara-review-count">{t('impara.rv.nOf', { n: Math.min(i + 1, total), total })}</span>}
        {item && <Button variant="ghost" size="s" className={`rv-timed ${timed ? 'on' : ''}`} aria-pressed={timed} onClick={() => setTimed(x => !x)} testid="impara-review-timed" tip={t('impara.q.timedTip', { s: CHALLENGE_S })}>{t('impara.q.timed')}</Button>}
        <Button variant="ghost" size="s" onClick={() => setImparaPrefs({ full: !full })} testid="impara-fullscreen" aria-pressed={full}
          tip={full ? `${t('impara.fullOff')}|Esc` : t('impara.fullOn')} aria-label={full ? t('impara.fullOff') : t('impara.fullOn')}>{full ? <IconMinimize size={13} /> : <IconMaximize size={13} />}</Button>
      </header>
      {items && total > 0 && (
        <div className="rv-seg" aria-hidden="true" data-testid="impara-review-progress">
          {items.map((x, k) => <i key={`${x.card.id}/${k}`} className={k < results.length ? (results[k]!.right ? 'ok' : 'ko') : k === i ? 'now' : ''} />)}
        </div>
      )}
      {!items ? <div className="ip-center"><IconSpinner size={18} /></div>
        : !item ? <End results={results} empty={!total} ms={(ended ?? Date.now()) - started.current} practice={practice} onRedo={redo} onAgain={subject ? () => setRound(r => r + 1) : undefined} />
        : <Card key={`${item.card.id}/${i}/${round}/${practice ? 'p' : ''}`} item={item} practice={practice} timed={timed} onGrade={finish} />}
    </div>
  );
}

function Card({ item, practice, timed, onGrade }: { item: ReviewItem; practice: boolean; timed: boolean; onGrade: (g: ReviewGrade, right: boolean) => void }) {
  const c = item.card;
  const quiz = useMemo(() => quizOf(c), [c]);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState<QuizDone | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [late, setLate] = useState(false);
  const answered = c.kind === 'recall' ? shown : quiz ? done !== null : pick !== null;
  const right = quiz ? done?.right ?? null : c.kind === 'node' ? (pick === null ? null : pick === c.node) : null;
  const answerQuiz = (r: QuizResponse) => {
    if (done || !quiz) return;
    const ok = quizRight(quiz, r);
    setDone({ response: r, right: ok });
    answerSound(ok);
  };
  const choosePick = (id: string) => { if (pick !== null) return; setPick(id); answerSound(id === c.node); };
  // «Non lo so» (and the end of the time in «Sfida a tempo»): counts as forgotten and shows the answer (also the way
  // past a diagram that cannot be drawn)
  const dunno = () => { if (quiz) { if (!done) setDone({ response: quiz.options.length ? -1 : [], right: false }); } else if (pick === null) setPick(''); };
  const marks = useMemo(() => (pick && c.node ? { [c.node]: 'right' as const, ...(pick !== c.node ? { [pick]: 'wrong' as const } : {}) } : undefined), [pick, c.node]);
  const clock = timed && c.kind !== 'recall' && !answered;
  const giveUp = useRef(dunno);
  giveUp.current = dunno;
  useEffect(() => {
    if (!clock) return;
    const id = setTimeout(() => { setLate(true); giveUp.current(); }, CHALLENGE_S * 1000);
    return () => clearTimeout(id);
  }, [clock]);
  const next = (g: ReviewGrade) => onGrade(g, right === null ? g > 1 : right);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('.modal-backdrop, .backdrop')) return;
      // Enter or Space on a focused button is that button's click, not a grade (an option already answered is disabled)
      const on = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('button, a, [role=button]') : null;
      if ((e.key === 'Enter' || e.key === ' ') && on && !(on instanceof HTMLButtonElement && on.disabled)) return;
      if (!answered) {
        if (c.kind === 'recall' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setShown(true); }
        return;
      }
      // wrong or practice: Enter goes on; recall: 1-4 = the four grades; right: 1-3 = hard, good, easy; Enter = good
      if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next(right === false ? 1 : 3); return; }
      if (practice) return;
      const n = '1234'.indexOf(e.key) + 1;
      if (right === null && n >= 1) { e.preventDefault(); next(n as ReviewGrade); }
      else if (right === true && n >= 1 && n <= 3) { e.preventDefault(); next((n + 1) as ReviewGrade); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <div className={`rv-card ${c.kind === 'node' ? 'rv-wide' : ''}`} data-testid="impara-review-card" data-kind={c.kind}>
      <div className="rv-meta"><span className="ip-tag">{t(`impara.rv.kind.${c.kind}`)}</span><span className="ip-muted">{item.lesson}</span></div>
      {clock && <div className="rv-clock" style={{ animationDuration: `${CHALLENGE_S}s` }} aria-hidden="true" data-testid="impara-review-clock"><i /></div>}
      <h3 className="rv-q" data-testid="impara-review-q">{c.q}</h3>

      {quiz && <ImparaQuiz body={quiz} seed={c.id} done={done} onAnswer={answerQuiz} keys fresh testid="impara-review-quiz" opt="impara-review-opt" />}
      {c.kind === 'node' && item.diagram && (
        <>
          <div className={`rv-stage ${pick === null ? '' : pick === c.node ? 'qz-ok' : 'qz-ko'}`}>
            <LessonStage code={item.diagram} beat={{ focus: [] }} done={[]} whole onWhole={() => {}} caption={c.q} beatKey={c.id} onPick={pick === null ? choosePick : undefined} marks={marks} />
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
          {late ? <b>{t('impara.q.late')}</b> : right !== null && <b>{right ? t('impara.check.rightTitle') : t('impara.check.wrongTitle')}</b>} {c.answer}
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
          {right === false || practice
            ? <Button variant="primary" onClick={() => next(right === false ? gradeOf(false) : 3)} testid="impara-review-next">{t('impara.next')} <IconArrowRight size={13} /></Button>
            : <>
              <span className="ip-muted">{t('impara.rv.how')}</span>
              {(right === null ? REVIEW_GRADES : REVIEW_GRADES.slice(1)).map(g => (
                <button key={g} type="button" className={`rv-g g${g}`} onClick={() => next(g)} data-testid={`impara-review-grade-${g}`}>
                  <b>{t(`impara.rv.grade.${g}`)}</b><small>{right === null ? g : g - 1}</small>
                </button>
              ))}
            </>}
        </div>
      </>}
    </div>
  );
}

const clockOf = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function End({ results, empty, ms, practice, onRedo, onAgain }: { results: Result[]; empty: boolean; ms: number; practice: boolean; onRedo: () => void; onAgain?: () => void }) {
  const right = results.filter(r => r.right).length, n = results.length;
  const wrong = n - right;
  const pct = n ? Math.round((right / n) * 100) : 0;
  const strong = results.filter(r => r.strengthened).length;
  const best = streaks(results).best;
  const rang = useRef(false);
  useEffect(() => {
    if (rang.current || empty || !n) return;
    rang.current = true;
    if (pct >= 80 && app.get().settings?.tasks?.sound !== false) playSound('celebrate');
  }, [empty, n, pct]);
  if (empty) {
    return (
      <div className="rv-end" data-testid="impara-review-end">
        <div className="rv-end-ic"><IconCheck size={22} /></div><h3>{t('impara.rv.nothing')}</h3><p className="ip-muted">{t('impara.rv.nothingHint')}</p>
        <div className="ip-row"><Button variant="primary" onClick={() => go({ page: 'impara' })} testid="impara-review-done">{t('impara.rv.backHome')}</Button></div>
      </div>
    );
  }
  return (
    <div className="rv-end rv-end2" data-testid="impara-review-end">
      <ScoreRing value={pct} size={112} label={`${pct}%`} tone={pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'low'} />
      <h3 data-testid="impara-review-score">{t('impara.rv.endTitle', { right, n })}</h3>
      <p className="ip-muted">{practice ? t('impara.q.practiceEnd') : t('impara.rv.endHint')}</p>
      <div className="rv-end-stats">
        <div><b data-testid="impara-review-time">{clockOf(ms)}</b><span>{t('impara.q.time')}</span></div>
        {!practice && <div><b data-testid="impara-review-strong">{strong}</b><span>{t('impara.q.strong')}</span></div>}
        <div><b>{best}</b><span>{t('impara.q.bestStreak')}</span></div>
      </div>
      <div className="ip-row rv-end-acts">
        {wrong > 0 && <Button variant="primary" onClick={onRedo} testid="impara-review-redo"><IconRefresh size={12} />{t('impara.q.redo', { n: wrong })}</Button>}
        <Button variant={wrong > 0 ? 'ghost' : 'primary'} onClick={() => go({ page: 'impara' })} testid="impara-review-done">{t('impara.rv.backHome')}</Button>
        {onAgain && !practice && <Button variant="ghost" onClick={onAgain} testid="impara-review-more">{t('impara.rv.again')}</Button>}
      </div>
    </div>
  );
}
