// The «Studio» column beside a lesson (ADR 0205; owner's report I3, NotebookLM's Studio as the reference): a tile for
// each thing the app can make from the lesson's VERIFIED facts only (one short hidden run each, no new research):
// Mappa mentale, Riassunto, Quiz, Flashcard, Glossario, Podcast, Linea del tempo, Mettimi alla prova. A tile that has
// nothing yet makes it on click; while it runs it says so; once made it opens over the board (StudioView), as it was
// saved with the lesson, with «Rifai» to make it again. The quiz plays as a review session (its answers become review
// cards), the flashcards are already in the review, «Mettimi alla prova» hands over to the tutor in quiz mode, the
// podcast is read by the app's local voices (two when two Italian voices are on disk, else one). Used by
// ImparaPlayer.tsx (the side column's «Studio» tab and the board's overlay); styles impara.css (.sd-*).
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { STUDIO_KINDS, type StudioItem, type StudioKind, type StudioOut } from '@shared/lesson-studio';
import { subjectOf, type Lesson } from '@shared/lesson';
import type { VoiceName } from '@shared/voice';
import type { CardKind } from '@shared/review';
import { go } from '../../actions';
import { makeStudio, reviewArg, studioQuizArg } from '../../lib/impara';
import { narrateLines, stopSpeaking, useVoice } from '../../lib/voice';
import { locale, t } from '../../i18n';
import { Button } from '../ui';
import { IconBook, IconBranch, IconCheck, IconFile, IconHistory, IconLayers, IconMic, IconPlay, IconQuestion, IconRefresh, IconSpinner, IconStop, IconTarget, IconX } from '../Icons';
import { LessonDiagram } from './LessonDiagram';
import { citedHtml, openCite } from './ImparaTutor';

const ICON: Record<StudioKind, ReactNode> = {
  mindmap: <IconBranch size={16} />, summary: <IconFile size={16} />, quiz: <IconQuestion size={16} />, flashcards: <IconLayers size={16} />,
  glossary: <IconBook size={16} />, podcast: <IconMic size={16} />, timeline: <IconHistory size={16} />, challenge: <IconTarget size={16} />,
};

/** The tiles, in the column. `onOpen` shows a made output over the board; `onChallenge` starts the tutor's quiz. */
export function ImparaStudio({ lesson, open, onOpen, onChallenge }: { lesson: Lesson; open: StudioKind | null; onOpen: (k: StudioKind) => void; onChallenge: () => void }) {
  const verified = (lesson.facts ?? []).filter(f => f.check !== 'unsure').length;
  const ready = lesson.state !== 'preparing' && lesson.state !== 'failed';
  const click = (k: StudioKind) => {
    if (k === 'challenge') return onChallenge();
    const it = lesson.studio?.[k];
    if (it?.out) return onOpen(k);
    if (it?.state !== 'making') void makeStudio(lesson.id, k);
  };
  return (
    <div className="sd" data-testid="impara-studio">
      <p className="sd-lead ip-muted">{verified ? t('impara.studio.lead', { n: verified }) : t('impara.studio.noFacts')}</p>
      <div className="sd-grid">
        {STUDIO_KINDS.map(k => {
          const it: StudioItem | undefined = lesson.studio?.[k];
          const state = k === 'challenge' ? 'live' : it?.state === 'making' ? 'making' : it?.out ? 'done' : it?.state === 'failed' ? 'failed' : 'new';
          return (
            <div key={k} className={`sd-tile ${state} ${open === k ? 'on' : ''}`} data-testid={`impara-studio-${k}`} data-state={state}>
              <button type="button" className="sd-tile-main" onClick={() => click(k)} disabled={!ready || (!verified && k !== 'challenge') || state === 'making'}
                aria-label={`${t(`impara.studio.${k}.t`)}: ${t(`impara.studio.${k}.d`)}`}>
                <span className={`sd-ico sd-ico-${k}`}>{ICON[k]}</span>
                <span className="sd-tile-t"><b>{t(`impara.studio.${k}.t`)}</b><small>{state === 'making' ? t('impara.studio.making') : state === 'failed' ? t('impara.studio.failed') : t(`impara.studio.${k}.d`)}</small></span>
                <span className="sd-state" aria-hidden="true">{state === 'making' ? <IconSpinner size={12} /> : state === 'done' ? <IconCheck size={12} /> : null}</span>
              </button>
              {(state === 'done' || state === 'failed') && (
                <button type="button" className="sd-redo" onClick={() => void makeStudio(lesson.id, k)} data-tip={t('impara.studio.redo')} aria-label={`${t('impara.studio.redo')}: ${t(`impara.studio.${k}.t`)}`} data-testid={`impara-studio-redo-${k}`}><IconRefresh size={11} /></button>
              )}
            </div>
          );
        })}
      </div>
      <p className="sd-foot ip-muted">{t('impara.studio.foot')}</p>
    </div>
  );
}

/** A made output, over the board, as it was saved. */
export function StudioView({ lesson, kind, onClose }: { lesson: Lesson; kind: StudioKind; onClose: () => void }) {
  const it = lesson.studio?.[kind];
  const out = it?.out;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);
  const when = it?.at ? new Date(it.at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <section className="sd-view" data-testid="impara-studio-view" data-kind={kind} aria-label={t(`impara.studio.${kind}.t`)}>
      <header className="sd-view-h">
        <span className={`sd-ico sd-ico-${kind}`}>{ICON[kind]}</span>
        <div className="sd-view-t"><b>{t(`impara.studio.${kind}.t`)}</b><small className="ip-muted">{t('impara.studio.madeAt', { when })}</small></div>
        <span className="sp" />
        <Button size="s" variant="ghost" onClick={() => void makeStudio(lesson.id, kind)} disabled={it?.state === 'making'} testid="impara-studio-view-redo">
          {it?.state === 'making' ? <IconSpinner size={12} /> : <IconRefresh size={12} />}{t('impara.studio.redo')}</Button>
        <button type="button" className="ip-tutor-x" onClick={onClose} aria-label={t('impara.studio.close')} data-tip={`${t('impara.studio.close')}|Esc`} data-testid="impara-studio-close"><IconX size={13} /></button>
      </header>
      <div className="sd-view-body">{out ? <Out lesson={lesson} out={out} /> : <div className="ip-center"><IconSpinner size={18} /></div>}</div>
    </section>
  );
}

function Out({ lesson, out }: { lesson: Lesson; out: StudioOut }) {
  const [zoom, setZoom] = useState(false);
  const facts = lesson.facts ?? [];
  const html = useMemo(() => (out.kind === 'summary' ? citedHtml(out.md, facts, false) : ''), [out, facts]);
  if (out.kind === 'mindmap' || (out.kind === 'timeline' && out.src)) {
    const src = out.kind === 'mindmap' ? out.src : out.src!;
    return <div className="sd-diagram"><LessonDiagram base="" own={src} focus={[]} done={[]} whole caption={t(`impara.studio.${out.kind}.t`)} zoom={zoom} onZoom={setZoom} /></div>;
  }
  if (out.kind === 'timeline') return <p className="sd-none" data-testid="impara-studio-none">{t('impara.studio.timeline.none')} {out.none}</p>;
  if (out.kind === 'summary') return <div className="md sd-summary" onClick={(e: MouseEvent) => openCite(e, facts)} dangerouslySetInnerHTML={{ __html: html }} />;
  if (out.kind === 'glossary') {
    return (
      <dl className="sd-gloss">
        {out.terms.map(term => (
          <div key={term.term}><dt>{term.term}</dt><dd>{term.meaning}{term.cites.length > 0 && <span className="sd-cites" onClick={(e: MouseEvent) => openCite(e, facts)} dangerouslySetInnerHTML={{ __html: citedHtml(term.cites.map(c => `[${c}]`).join(''), facts, false) }} />}</dd></div>
        ))}
      </dl>
    );
  }
  if (out.kind === 'flashcards') return <Flashcards lesson={lesson} cards={out.cards} />;
  if (out.kind === 'quiz') {
    const kindOf = (q: (typeof out.qs)[number]): QuizKind => q.kind;
    const kinds = out.qs.reduce<Partial<Record<QuizKind, number>>>((m, q) => ({ ...m, [kindOf(q)]: (m[kindOf(q)] ?? 0) + 1 }), {});
    return (
      <div className="sd-quiz">
        <div className="sd-quiz-n"><b>{out.qs.length}</b><span>{t('impara.studio.quiz.questions')}</span></div>
        <div className="ip-row">{(Object.entries(kinds) as [QuizKind, number][]).map(([k, n]) => <span key={k} className="ip-tag">{t(`impara.studio.quiz.kind.${k}`)} · {n}</span>)}</div>
        <p className="ip-muted">{t('impara.studio.quiz.hint')}</p>
        <Button variant="primary" onClick={() => go({ page: 'impara', arg: studioQuizArg(lesson.id) })} testid="impara-studio-quiz-start">{t('impara.studio.quiz.start')}</Button>
      </div>
    );
  }
  return <Podcast out={out} />;
}

function Flashcards({ lesson, cards }: { lesson: Lesson; cards: { q: string; answer: string }[] }) {
  const [shown, setShown] = useState<Set<number>>(new Set());
  return (
    <div className="sd-cards">
      <div className="ip-row"><span className="ip-tag green"><IconCheck size={10} />{t('impara.studio.flashcards.inReview', { n: cards.length, subject: subjectOf(lesson) })}</span><span className="sp" />
        <Button size="s" onClick={() => go({ page: 'impara', arg: reviewArg(subjectOf(lesson)) })} testid="impara-studio-flash-review">{t('impara.rv.quizSubject')}</Button></div>
      <div className="sd-cards-grid">
        {cards.map((c, i) => (
          <button key={i} type="button" className={`sd-card ${shown.has(i) ? 'flip' : ''}`} onClick={() => setShown(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} aria-pressed={shown.has(i)}>
            <span className="sd-card-q">{c.q}</span>
            {shown.has(i) ? <span className="sd-card-a">{c.answer}</span> : <span className="sd-card-hint ip-muted">{t('impara.studio.flashcards.flip')}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Two local voices when two Italian voices are on disk (never downloading one), else the chosen one for both. */
function Podcast({ out }: { out: Extract<StudioOut, { kind: 'podcast' }> }) {
  const [voices, setVoices] = useState<[VoiceName | undefined, VoiceName | undefined]>([undefined, undefined]);
  const [at, setAt] = useState<number | null>(null);
  const narrating = useVoice(s => s.narrating);
  useEffect(() => {
    let live = true;
    void window.sb.invoke('voice:state', undefined).then(st => {
      if (!live) return;
      const other = (st.voices ?? []).find(v => v !== st.voice);
      setVoices([st.voice, other ?? st.voice]);
    }, () => {});
    return () => { live = false; stopSpeaking(false); };
  }, []);
  useEffect(() => { if (!narrating) setAt(null); }, [narrating]);
  const two = !!voices[0] && !!voices[1] && voices[0] !== voices[1];
  const play = (from = 0) => {
    const rest = out.lines.slice(from);
    narrateLines(rest.map(l => ({ text: l.say, ...(voices[l.who] ? { voice: voices[l.who] } : {}) })), i => setAt(from + i), () => setAt(null));
    setAt(from);
  };
  const playing = narrating && at !== null;
  return (
    <div className="sd-pod" data-testid="impara-studio-podcast">
      <div className="sd-pod-h">
        <button type="button" className={`sd-pod-play ${playing ? 'on' : ''}`} onClick={() => (playing ? stopSpeaking(false) : play(0))} aria-label={playing ? t('impara.studio.podcast.stop') : t('impara.studio.podcast.play')} data-testid="impara-studio-podcast-play">
          {playing ? <IconStop size={16} /> : <IconPlay size={16} />}
        </button>
        <div className="sd-pod-t"><b>{out.title || t('impara.studio.podcast.t')}</b>
          <small className="ip-muted">{two ? t('impara.studio.podcast.two', { a: voiceLabel(voices[0]!), b: voiceLabel(voices[1]!) }) : t('impara.studio.podcast.one')} · {t('impara.studio.podcast.lines', { n: out.lines.length })}</small></div>
      </div>
      <ol className="sd-pod-lines">
        {out.lines.map((l, i) => (
          <li key={i} className={`who${l.who} ${at === i ? 'on' : ''}`}>
            <button type="button" onClick={() => play(i)} data-tip={t('impara.studio.podcast.from')}><span className="sd-pod-who">{l.who === 0 ? t('impara.studio.podcast.host') : t('impara.studio.podcast.expert')}</span><span>{l.say}</span></button>
          </li>
        ))}
      </ol>
    </div>
  );
}
type QuizKind = CardKind;
const voiceLabel = (v: VoiceName) => v.charAt(0).toUpperCase() + v.slice(1);
