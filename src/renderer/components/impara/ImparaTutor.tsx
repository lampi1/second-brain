// The tutor beside a lesson (ADR 0190; owner, 2026-10-29: «devo poter capire concetti … EFFICACE»): ask anything at
// any moment, by writing, by voice («Rispondo a voce»: what is not a command comes here) or by clicking a part of the
// diagram; the answer arrives word by word ('impara:tutor', lib/impara.ts tutorLive) from a session main started while
// the tutor opened (warmTutor), grounded in the lesson's verified facts, each cited as a chip that opens its source.
// «Prima provo io» (on by default) makes the tutor give a hint and a question back before explaining a why or a how
// (Bastani et al. 2024); «Dimmelo e basta» asks for the answer straight away. An explanation the verified facts support
// becomes a review card (shown on the answer). Read aloud when «Voce dell'app» is on. Since ADR 0205 it is the «Tutor»
// tab of the column beside the lesson (the «Studio» tab is the other; the column's head is ImparaPlayer's), and
// «Mettimi alla prova» (a Studio tile) starts its quiz mode: it asks one question at a time and judges each answer
// until «Basta così». Used by ImparaPlayer.tsx; styles impara.css (.ip-tutor*).
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { isAskingMode, tutorShown, type Lesson, type LessonFact, type TutorMode, type TutorTurn } from '@shared/lesson';
import { askTutor, imparaPrefs, setImparaPrefs, tutorLive, warmTutor } from '../../lib/impara';
import { narrate } from '../../lib/voice';
import { renderMarkdown } from '../../lib/markdown';
import { t } from '../../i18n';
import { Button } from '../ui';
import { IconCheck, IconMic, IconRefresh, IconSend, IconTarget, IconEdit } from '../Icons';
import { ImparaSwitch } from './ImparaSwitch';
import { hostOf, openFact } from './ImparaSources';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** The answer's markdown with each [f1] of a known fact as a small chip (its source on hover, opened on click); only
 *  in the text, never inside a tag. Not cached while it streams (every word is a new text). Also the «Studio» summary's
 *  and glossary's (ImparaStudio.tsx). */
/** The sessions where the tutor asks one thing after another (ADR 0205, 0213): what starts them, what ends them. */
export type AskingMode = Extract<TutorMode, 'quiz' | 'oral' | 'practice'>;
export const startText = (m: AskingMode) => t(m === 'quiz' ? 'impara.tutor.quizStart' : `impara.tutor.${m}Start`);
export const stopText = (m: AskingMode) => t(m === 'quiz' ? 'impara.tutor.quizStop' : `impara.tutor.${m}Stop`);
/** the asking session the tutor is in, if any: its mode and how many questions (or exercises) it asked */
export function askingNow(turns: readonly TutorTurn[] | undefined): { mode: AskingMode; n: number } | null {
  const last = turns?.at(-1);
  if (!last || !isAskingMode(last.mode)) return null;
  const mode = last.mode as AskingMode;
  if (last.q === stopText(mode) && last.state !== 'failed') return null;
  let n = 0;
  for (let i = turns!.length - 1; i >= 0 && turns![i]!.mode === mode; i--) { n++; if (turns![i]!.q === startText(mode)) break; }
  return { mode, n };
}

export function citedHtml(text: string, facts: readonly LessonFact[], streaming: boolean): string {
  const n = new Map(facts.map((f, i) => [f.id, { f, i: i + 1 }]));
  return renderMarkdown(text, !streaming).split(/(<[^>]*>)/).map(part => (part.startsWith('<') ? part : part.replace(/\[(f\d+)\]/g, (all, id: string) => {
    const hit = n.get(id);
    if (!hit) return all;
    const where = hit.f.from === 'web' ? hostOf(hit.f.ref) : hit.f.from === 'file' ? hit.f.ref.split(/[\\/]/).pop() ?? hit.f.ref : t('impara.src.known');
    return `<button type="button" class="ip-tcite" data-fact="${esc(id)}" data-tip="${esc(`${hit.f.claim}|${where}`)}">${hit.i}</button>`;
  }))).join('');
}

/** A click on a cited fact's chip opens its source (a web page, a file of this PC). */
export function openCite(e: MouseEvent, facts: readonly LessonFact[]): void {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-fact]')?.dataset.fact;
  const f = id ? facts.find(x => x.id === id) : null;
  if (!f) return;
  e.preventDefault();
  if (f.from === 'web') window.open(f.ref, '_blank', 'noopener');
  else if (f.from === 'file') openFact(f.ref);
}

function Turn({ turn, facts, last, again, onTell, onRetry }: { turn: TutorTurn; facts: readonly LessonFact[]; last: boolean; again: boolean; onTell: () => void; onRetry: () => void }) {
  const live = tutorLive.use(s => s[turn.id]);
  const text = turn.state === 'asking' ? live ?? '' : tutorShown(turn.a);
  const html = useMemo(() => citedHtml(text, facts, turn.state === 'asking'), [text, facts, turn.state]);
  const open = (e: MouseEvent) => openCite(e, facts);
  return (
    <div className="ip-tturn" data-testid="impara-tutor-turn" data-state={turn.state}>
      {/* «Dimmelo e basta» after a hint: the same question again, said as what the learner pressed */}
      <div className={`ip-tq ${isAskingMode(turn.mode) ? 'quiz' : ''}`}>{again ? t('impara.tutor.tell') : turn.q}</div>
      <div className="ip-ta" aria-live={turn.state === 'asking' ? 'polite' : undefined}>
        {turn.state === 'failed'
          ? <div className="ip-terr" role="alert">{t('impara.tutor.failed', { error: turn.error ?? '' })} <Button size="s" onClick={onRetry} testid="impara-tutor-retry"><IconRefresh size={11} />{t('impara.retry')}</Button></div>
          : text
            ? <div className={`md ip-ttext ${turn.state === 'asking' ? 'streaming' : ''}`} onClick={open} data-testid="impara-tutor-answer" dangerouslySetInnerHTML={{ __html: html }} />
            : <div className="ip-tdots" aria-label={t('impara.tutor.thinking')}><i /><i /><i /></div>}
        {turn.state === 'done' && turn.card && <div className="ip-tcard" data-testid="impara-tutor-card"><IconCheck size={11} />{t('impara.tutor.card')}</div>}
        {turn.state === 'done' && last && turn.mode === 'coach' && !turn.card && (
          <button type="button" className="ip-ttell" onClick={onTell} data-testid="impara-tutor-tell">{t('impara.tutor.tell')}</button>
        )}
      </div>
    </div>
  );
}

export function ImparaTutor({ lesson, at, seed, onSeed, onClose, challenge, onChallenged }: {
  lesson: Lesson; at: string; seed: string | null; onSeed: () => void; onClose: () => void;
  /** «Mettimi alla prova», «Interrogazione a voce» or «Esercitati» pressed in the Studio: that session starts, and
   *  onChallenged clears it */
  challenge: AskingMode | null; onChallenged: () => void;
}) {
  const coach = imparaPrefs.use(p => p.coach);
  const voiceOn = imparaPrefs.use(p => p.voice);
  const turns = lesson.tutor ?? [];
  const asking = turns.some(x => x.state === 'asking');
  const facts = lesson.facts ?? [];
  const [q, setQ] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const live = tutorLive.use(s => s);
  // «Mettimi alla prova» (ADR 0205): while the last turn is the quiz's, what the learner writes is an answer to it
  const session = askingNow(turns);

  // the engine starts as the tutor opens: by the time the question is written it is ready
  useEffect(() => { warmTutor(lesson.id); input.current?.focus(); }, [lesson.id]);
  // a node clicked, a sentence heard: into the box, to send or change
  useEffect(() => { if (seed !== null) { setQ(v => (v.trim() ? `${v} ${seed}` : seed)); onSeed(); input.current?.focus(); } }, [seed]);
  // the newest answer in view while it grows
  useEffect(() => { const b = body.current; if (b) b.scrollTop = b.scrollHeight; }, [turns.length, live]);
  // a finished answer is read aloud when the app's voice is on (once)
  const said = useRef(new Set(turns.filter(x => x.state !== 'asking').map(x => x.id)));
  useEffect(() => {
    for (const x of turns) {
      if (x.state === 'asking' || said.current.has(x.id)) continue;
      said.current.add(x.id);
      if ((voiceOn || x.mode === 'oral') && x.state === 'done') narrate(tutorShown(x.a).replace(/\[f\d+\]/g, ''));
    }
  }, [turns, voiceOn]);

  // a question from the box that did not go (no engine, an error said by a notice) comes back into the box
  const send = (text: string, mode: TutorMode = session ? session.mode : coach ? 'coach' : 'tell', fromBox = false) => {
    const v = text.trim();
    if (!v || asking) return;
    if (fromBox) setQ('');
    void askTutor(lesson.id, at, v, mode).then(l => { if (!l && fromBox) setQ(cur => cur.trim() ? cur : v); });
  };

  // a press of «Mettimi alla prova»: the first question comes
  // (a press while an answer still streams starts it once that answer ends; once started it is never sent again)
  useEffect(() => { if (challenge && !asking) { onChallenged(); send(startText(challenge), challenge); } }, [challenge, asking]);

  return (
    <div className="ip-tutor-pane" data-testid="impara-tutor" aria-label={t('impara.tutor.title')}>
      <div className="ip-tutor-body" ref={body}>
        {!turns.length && (
          <div className="ip-tutor-empty" data-testid="impara-tutor-empty">
            <p>{t('impara.tutor.empty')}</p>
            <p className="ip-muted">{t('impara.tutor.emptyHint')}</p>
          </div>
        )}
        {turns.map((x, i) => <Turn key={x.id} turn={x} facts={facts} last={i === turns.length - 1} again={x.mode === 'tell' && turns[i - 1]?.q === x.q} onTell={() => send(x.q, 'tell')} onRetry={() => send(x.q, x.mode)} />)}
      </div>
      <form className="ip-tutor-in" onSubmit={e => { e.preventDefault(); send(q, undefined, true); }}>
        <textarea ref={input} value={q} rows={2} maxLength={600} placeholder={t('impara.tutor.placeholder')} aria-label={t('impara.tutor.placeholder')} data-testid="impara-tutor-input"
          onChange={e => { setQ(e.target.value); warmTutor(lesson.id); }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(q, undefined, true); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          }} />
        <div className="ip-tutor-row">
          {session
            ? <span className="ip-tquiz" data-testid="impara-tutor-quizzing" data-mode={session.mode}>
              {session.mode === 'oral' ? <IconMic size={12} /> : session.mode === 'practice' ? <IconEdit size={12} /> : <IconTarget size={12} />}
              {session.mode === 'quiz' ? t('impara.tutor.quizzing') : t(`impara.tutor.${session.mode}Now`, { n: Math.min(session.n, session.mode === 'oral' ? 5 : 99) })}
              <button type="button" className="ip-link" onClick={() => send(stopText(session.mode), session.mode)} disabled={asking} data-testid="impara-tutor-quiz-stop">{t(session.mode === 'oral' ? 'impara.tutor.oralEnd' : 'impara.tutor.quizEnd')}</button></span>
            : <span data-tip={t('impara.tutor.coachTip')}><ImparaSwitch on={coach} onChange={on => setImparaPrefs({ coach: on })} label={t('impara.tutor.coach')} testid="impara-tutor-coach" /></span>}
          <span className="sp" />
          <Button variant="primary" size="s" type="submit" disabled={!q.trim() || asking} testid="impara-tutor-send">{t('impara.askSend')} <IconSend size={12} /></Button>
        </div>
      </form>
    </div>
  );
}
