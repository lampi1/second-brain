// One lesson of Impara, the blackboard (ADR 0181, style A chosen by the owner 2026-10-29: mockup
// /mnt/project-files/ui-review/impara/2-A-lavagna-lezione.png): on the left the pieces (seen, now, still to come, the
// extras asked and the checks), in the middle the diagram that grows piece by piece, under it the narration (read
// aloud by the app's voice when «Voce dell'app» is on: then the short spoken text with «Testo completo»; off: the
// written text), the buttons (Avanti, Spiegamelo meglio, Fammi un esempio, Mostrami il codice, a question), the real
// code of the piece and its new words. The user goes at their own pace: → ← and the rail move, Space pauses or repeats
// the voice; with «Rispondo a voce» the microphone takes commands («avanti», «ripeti», «non ho capito», «la b»…), and
// anything else is a question. Checks open over the board (ImparaCheck.tsx), the end is «Spiegalo tu» (ImparaEnd.tsx).
// Every move is saved by main at once, so the lesson reopens where it was. Used by ImparaPage.tsx; styles impara.css.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { checkKey, doneNodes, parseLessonCommand, parseSpokenChoice, playlist, rootOf, stepKey, type Lesson, type LessonCheck, type LessonExtraKind, type LessonStep, type PlayItem } from '@shared/lesson';
import { answerCheck, askExtra, explainBack, impara, imparaPrefs, loadLesson, moveTo, removeLesson, retryLesson, setImparaPrefs } from '../../lib/impara';
import { narrate, onImparaHeard, stopSpeaking, stopVoice, toggleVoice, useVoice, voice } from '../../lib/voice';
import { renderMarkdown } from '../../lib/markdown';
import { go } from '../../actions';
import { askConfirm, toast } from '../../store/ui';
import { locale, t } from '../../i18n';
import { Button, Kbd } from '../ui';
import { IconArrowLeft, IconArrowRight, IconBook, IconCheck, IconLightbulb, IconMic, IconQuestion, IconRefresh, IconSpinner, IconTerminal, IconTrash, IconX } from '../Icons';
import { LessonDiagram } from './LessonDiagram';
import { ImparaCheck } from './ImparaCheck';
import { ImparaEnd } from './ImparaEnd';
import { ImparaSwitch } from './ImparaSwitch';

const EXTRA_ICON: Record<LessonExtraKind, ReactNode> = { better: <IconLightbulb size={11} />, example: <IconBook size={11} />, code: <IconTerminal size={11} />, question: <IconQuestion size={11} /> };
const LETTERS = ['A', 'B', 'C', 'D'];

export function ImparaPlayer({ id }: { id: string }) {
  const lesson = impara.use(s => s.lessons[id] ?? null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { let alive = true; void loadLesson(id).then(l => { if (alive && !l) setMissing(true); }); return () => { alive = false; }; }, [id]);
  // leaving the lesson: the voice stops, the microphone it opened closes
  useEffect(() => () => { stopSpeaking(false); const v = voice.get(); if (v.phase !== 'off' && v.target === 'impara') stopVoice(); }, []);
  if (!lesson) return <div className="ip-player ip-center" data-testid="impara-player">{missing ? <p className="ip-muted">{t('impara.notFound')}</p> : <IconSpinner size={18} />}</div>;
  if (lesson.state === 'preparing') return <Preparing lesson={lesson} />;
  if (lesson.state === 'failed' || !lesson.steps.length) return <Failed lesson={lesson} />;
  return <Board lesson={lesson} />;
}

function Head({ lesson, right }: { lesson: Lesson; right?: ReactNode }) {
  const kind = lesson.pr ? `PR #${lesson.pr.number}` : t(`impara.kind.${lesson.kind}`);
  return (
    <header className="ip-head">
      <Button variant="ghost" size="s" onClick={() => go({ page: 'impara' })} testid="impara-back" tip={t('impara.backList')} aria-label={t('impara.backList')}><IconArrowLeft size={13} /></Button>
      <div className="ip-head-title">
        <div className="ip-kicker">{t('impara.lessonKicker')} · {kind} · {t(`impara.depth.${lesson.depth}.short`)}</div>
        <h2 data-testid="impara-title">{lesson.title}</h2>
      </div>
      <span className="sp" />
      {right}
    </header>
  );
}

function Preparing({ lesson }: { lesson: Lesson }) {
  const gathered = lesson.sources.length > 0 || lesson.kind === 'topic';
  return (
    <div className="ip-player" data-testid="impara-player">
      <Head lesson={lesson} />
      <div className="ip-preparing" data-testid="impara-preparing" role="status" aria-live="polite">
        <div className="ip-sketch" aria-hidden="true"><i /><i /><i /><b /><b /></div>
        <h3>{t('impara.preparing.title')}</h3>
        <ol className="ip-prep-steps">
          <li className={gathered ? 'done' : 'now'}>{gathered ? <IconCheck size={12} /> : <IconSpinner size={12} />}{t(lesson.kind === 'pr' ? 'impara.preparing.readPr' : lesson.kind === 'text' ? 'impara.preparing.readText' : 'impara.preparing.topic')}</li>
          <li className={gathered ? 'now' : ''}>{gathered ? <IconSpinner size={12} /> : <span className="ip-dot" />}{t('impara.preparing.plan')}</li>
          <li><span className="ip-dot" />{t('impara.preparing.rest')}</li>
        </ol>
        <p className="ip-muted">{t('impara.preparing.hint')}</p>
      </div>
    </div>
  );
}

function Failed({ lesson }: { lesson: Lesson }) {
  return (
    <div className="ip-player" data-testid="impara-player">
      <Head lesson={lesson} />
      <div className="ip-failed" data-testid="impara-failed" role="alert">
        <h3>{t('impara.failed.title')}</h3>
        <p>{lesson.error ?? t('impara.failed.unknown')}</p>
        <div className="ip-row">
          <Button variant="primary" onClick={() => void retryLesson(lesson.id)} testid="impara-retry"><IconRefresh size={13} />{t('impara.retry')}</Button>
          <Button onClick={() => askConfirm({ title: t('impara.removeTitle'), body: t('impara.removeBody', { title: lesson.title }), confirmLabel: t('impara.remove'), danger: true, onConfirm: () => void removeLesson(lesson.id).then(ok => { if (ok) go({ page: 'impara' }); }) })} testid="impara-remove"><IconTrash size={13} />{t('impara.remove')}</Button>
        </div>
      </div>
    </div>
  );
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.closest('input, textarea, select, [contenteditable="true"]') !== null);
const spokenCheck = (c: LessonCheck) => `${t('impara.check.spoken')} ${c.q} ${c.options.map((o, i) => `${LETTERS[i]}: ${o}.`).join(' ')}`;

function Board({ lesson }: { lesson: Lesson }) {
  const prefs = imparaPrefs.use(s => s);
  const phase = useVoice(s => s.phase), micOn = useVoice(s => s.phase !== 'off' && s.target === 'impara'), narrating = useVoice(s => s.narrating);
  const list = useMemo(() => playlist(lesson), [lesson]);
  const idx = Math.max(0, list.findIndex(p => p.key === lesson.at));
  const item: PlayItem = list[idx]!;
  const main = lesson.steps.filter(s => !s.extra);
  const piece: LessonStep | null = item.kind === 'step' ? item.step : item.kind === 'check' ? lesson.steps.find(s => s.id === item.check.after) ?? null : null;
  const root = rootOf(lesson, item.key) ?? (item.kind === 'end' ? main.at(-1) ?? null : null);
  const mainIndex = root ? main.findIndex(s => s.id === root.id) : main.length - 1;
  const total = Math.max(main.length, lesson.outline.length);
  const atLast = idx >= list.length - 1;
  const waitingRest = atLast && lesson.state === 'more';
  const [whole, setWhole] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [full, setFull] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [heard, setHeard] = useState<string | null>(null);
  const busy = !!lesson.busy;

  const next = () => { if (!atLast) void moveTo(lesson.id, list[idx + 1]!.key); };
  const back = () => { if (idx > 0) void moveTo(lesson.id, list[idx - 1]!.key); };
  const extra = (kind: LessonExtraKind, text?: string) => { if (!busy) { stopSpeaking(false); void askExtra(lesson.id, kind, item.key, text); } };
  const speakNow = () => {
    if (!prefs.voice) return;
    if (item.kind === 'step') narrate(item.step.say);
    else if (item.kind === 'check') narrate(item.check.answer ? item.check.why : spokenCheck(item.check));
    else narrate(lesson.explain?.feedback ?? lesson.explain?.q ?? t('impara.end.spokenAsk'));
  };
  const answer = (c: LessonCheck, choice: number) => {
    if (c.answer) return;
    void answerCheck(lesson.id, c.id, choice);
    if (prefs.voice) narrate(`${choice === c.correct ? t('impara.check.rightSpoken') : t('impara.check.wrongSpoken', { letter: LETTERS[c.correct]! })} ${c.why}`);
  };

  // each new item is read aloud once (a piece, a check; the end's question), at the user's pace: never an auto-advance
  useEffect(() => { setFull(false); setZoom(false); if (prefs.voice) speakNow(); else stopSpeaking(false); }, [item.key, prefs.voice]);
  // the end's grade arrives: its feedback is read
  useEffect(() => { if (item.kind === 'end' && lesson.explain?.feedback && prefs.voice) narrate(lesson.explain.feedback); }, [lesson.explain?.feedback]);
  // «Rispondo a voce» remembered: the microphone opens with the lesson
  useEffect(() => { if (prefs.mic && phase === 'off') void toggleVoice('impara'); }, []);

  // what the microphone heard: a command, a choice at a check, the «Spiegalo tu», else a question about this piece
  const onHeard = useRef<(text: string) => void>(() => {});
  onHeard.current = (text: string) => {
    setHeard(text);
    if (item.kind === 'check' && !item.check.answer) {
      const i = parseSpokenChoice(text, item.check.options.length);
      if (i !== null) { answer(item.check, i); return; }
    }
    const cmd = parseLessonCommand(text);
    if (cmd === 'next') return next();
    if (cmd === 'back') return back();
    if (cmd === 'repeat') return speakNow();
    if (cmd === 'pause') return stopSpeaking(false);
    if (cmd === 'better' || cmd === 'example' || cmd === 'code') return extra(cmd);
    if (item.kind === 'end' && !lesson.explain?.answer) { setDraft(d => (d.trim() ? `${d} ${text}` : text)); return; }
    if (asking !== null) { setAsking(a => (a?.trim() ? `${a} ${text}` : text)); return; }
    if (text.trim().split(/\s+/).length >= 3) extra('question', text);
  };
  useEffect(() => { onImparaHeard(text => onHeard.current(text)); return () => onImparaHeard(null); }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('.modal-backdrop')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key === ' ') { e.preventDefault(); if (narrating) stopSpeaking(false); else speakNow(); }
      else if (item.kind === 'check' && !item.check.answer) {
        const i = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(e.key.toLowerCase());
        if (i >= 0 && i < item.check.options.length) { e.preventDefault(); answer(item.check, i); }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const toggleMic = () => { const on = !micOn; setImparaPrefs({ mic: on }); if (on) void toggleVoice('impara'); else stopVoice(); };
  const toggleVoiceOut = () => {
    const on = !prefs.voice;
    setImparaPrefs({ voice: on });
    if (on) void window.sb.invoke('voice:state', undefined).then(st => { if (!st.ready.tts) { toast(t('impara.voicePreparing', { mb: st.missingMb }), 'info'); void window.sb.invoke('voice:prepare', undefined).catch(() => {}); } }, () => {});
  };

  const seenUpTo = idx;
  const posOf = (key: string) => list.findIndex(p => p.key === key);
  const focus = piece && !piece.diagram ? piece.focus : [];
  const done = item.kind === 'end' ? [] : doneNodes(lesson, item.key);
  const label = item.kind === 'end' ? t('impara.end.kicker') : piece?.extra ? t(`impara.extra.${piece.extra.kind}`) : t('impara.pieceOf', { n: mainIndex + 1, total });
  const saved = new Date(lesson.updatedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="ip-player" data-testid="impara-player" data-at={lesson.at}>
      <Head lesson={lesson} right={<>
        <ImparaSwitch on={prefs.voice} onChange={toggleVoiceOut} label={t('impara.voiceApp')} testid="impara-voice" />
        <ImparaSwitch on={micOn} onChange={toggleMic} label={t('impara.voiceMe')} testid="impara-mic" />
      </>} />
      <div className="ip-steps" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => <i key={i} className={i < mainIndex || item.kind === 'end' ? 'd' : i === mainIndex ? 'c' : i >= main.length ? 'w' : ''} />)}
      </div>
      <div className="ip-layout">
        <aside className="ip-rail" data-testid="impara-rail" aria-label={t('impara.pieces')}>
          {main.map((s, i) => {
            const key = stepKey(s.id), at = root?.id === s.id && item.kind !== 'end', seen = posOf(key) <= seenUpTo;
            const kids = lesson.steps.filter(x => x.extra && rootOf(lesson, stepKey(x.id))?.id === s.id);
            const checks = lesson.checks.filter(c => rootOf(lesson, checkKey(c.id))?.id === s.id);
            return (
              <div key={s.id} className="ip-rail-group">
                <button type="button" className={`ip-st ${at ? 'c' : seen ? 'd' : ''}`} onClick={() => void moveTo(lesson.id, key)} data-testid={`impara-rail-${i + 1}`} aria-current={at ? 'step' : undefined} data-tip={s.title}>
                  <span className="ip-st-dot">{seen && !at ? <IconCheck size={10} /> : i + 1}</span>
                  <span className="ip-st-t">{s.title}{at && <small>{t('impara.now')}</small>}</span>
                </button>
                {kids.map(x => (
                  <button key={x.id} type="button" className={`ip-st ip-st-x ${item.key === stepKey(x.id) ? 'c' : ''}`} onClick={() => void moveTo(lesson.id, stepKey(x.id))} data-testid={`impara-rail-x-${x.id}`} data-tip={x.title}>
                    <span className="ip-st-dot">{EXTRA_ICON[x.extra!.kind]}</span><span className="ip-st-t">{x.title}</span>
                  </button>
                ))}
                {checks.map(c => (
                  <button key={c.id} type="button" className={`ip-st ip-st-q ${item.key === checkKey(c.id) ? 'c' : ''} ${c.answer ? (c.answer.choice === c.correct ? 'ok' : 'ko') : ''}`} onClick={() => void moveTo(lesson.id, checkKey(c.id))} data-testid={`impara-rail-q-${c.id}`} data-tip={t('impara.check.rail')}>
                    <span className="ip-st-dot">{c.answer ? (c.answer.choice === c.correct ? <IconCheck size={10} /> : <IconX size={10} />) : '?'}</span><span className="ip-st-t">{t('impara.check.rail')}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {lesson.outline.slice(main.length).map((title, i) => (
            <div key={`o${i}`} className="ip-st w" data-testid="impara-rail-coming" data-tip={title}><span className="ip-st-dot">{lesson.state === 'more' && i === 0 ? <IconSpinner size={10} /> : main.length + i + 1}</span><span className="ip-st-t">{title}</span></div>
          ))}
          <button type="button" className={`ip-st ip-st-end ${item.kind === 'end' ? 'c' : ''}`} disabled={lesson.state !== 'ready'} onClick={() => void moveTo(lesson.id, 'end')} data-testid="impara-rail-end" data-tip={t('impara.end.rail')}>
            <span className="ip-st-dot">★</span><span className="ip-st-t">{t('impara.end.rail')}</span>
          </button>
          <div className="ip-sources">
            <div className="ip-label">{t('impara.sources')}</div>
            {lesson.pr && <a href={lesson.pr.url} target="_blank" rel="noreferrer" className="ip-src-link">{lesson.pr.repo} #{lesson.pr.number}</a>}
            {lesson.sources.map(s => <div key={s}>{s}</div>)}
            {!lesson.sources.length && <div>{t(`impara.kind.${lesson.kind}`)}</div>}
            <div className="ip-cost" data-testid="impara-cost">{lesson.costUsd !== null ? `≈ ${lesson.costUsd.toLocaleString(locale(), { maximumFractionDigits: 2, minimumFractionDigits: 2 })} $` : ''}{lesson.model ? ` · ${lesson.model}` : ''}</div>
          </div>
        </aside>

        <section className="ip-board">
          <div className="ip-canvas" data-testid="impara-canvas">
            <div className="ip-tools">
              <button type="button" className={`ip-pill ${whole ? 'on' : ''}`} onClick={() => setWhole(w => !w)} aria-pressed={whole} data-testid="impara-whole">{t('impara.whole')}</button>
              <button type="button" className="ip-pill" onClick={() => setZoom(true)} data-testid="impara-zoom">⤢ {t('impara.zoom')}</button>
            </div>
            <LessonDiagram base={lesson.diagram} own={piece?.diagram} focus={focus} done={done} whole={whole || item.kind === 'end'} note={item.kind === 'step' ? piece?.note : undefined}
              caption={piece?.title ?? lesson.title} zoom={zoom} onZoom={setZoom} />
          </div>

          {item.kind === 'check'
            ? <ImparaCheck check={item.check} n={lesson.checks.filter(c => posOf(checkKey(c.id)) <= idx).length} total={lesson.checks.length}
              onAnswer={i => answer(item.check, i)} onConfidence={c => void answerCheck(lesson.id, item.check.id, item.check.answer!.choice, c)}
              onNext={next} onReview={() => piece && void moveTo(lesson.id, stepKey(piece.id))} last={atLast} />
            : item.kind === 'end'
            ? <ImparaEnd lesson={lesson} draft={draft} setDraft={setDraft} onSend={text => { void explainBack(lesson.id, text); }} onReview={key => void moveTo(lesson.id, key)} />
            : <>
              <div className={`ip-narr ${narrating ? 'is-speaking' : ''}`} data-testid="impara-narration">
                <div className={`ip-ava ${narrating ? 'on' : ''}`} aria-hidden="true" />
                <div className="ip-narr-body">
                  <div className="ip-narr-head">
                    <b data-testid="impara-piece-label">{label}</b>
                    {narrating && <span className="ip-wave" aria-hidden="true">{[6, 12, 16, 9, 14, 5, 11].map((h, i) => <i key={i} style={{ height: h, animationDelay: `${i * 80}ms` }} />)}</span>}
                    <span className="ip-muted ip-narr-hint">{narrating ? <><Kbd>Spazio</Kbd> {t('impara.pause')}</> : prefs.voice ? <><Kbd>Spazio</Kbd> {t('impara.repeat')}</> : null}</span>
                  </div>
                  {piece?.extra?.ask && <p className="ip-asked">«{piece.extra.ask}»</p>}
                  {item.kind === 'step' && (prefs.voice
                    ? <>
                      <p className="ip-say" data-testid="impara-say">{item.step.say}</p>
                      {item.step.text && item.step.text !== item.step.say && <button type="button" className="ip-link" onClick={() => setFull(f => !f)} aria-expanded={full} data-testid="impara-full">{full ? t('impara.lessText') : t('impara.fullText')}</button>}
                      {full && <div className="md ip-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.step.text) }} />}
                    </>
                    : <div className="md ip-text ip-text-main" data-testid="impara-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.step.text) }} />)}
                </div>
              </div>

              {lesson.error && lesson.state === 'more' && <div className="ip-busy err" role="alert">{lesson.error}<Button size="s" onClick={() => void retryLesson(lesson.id)} testid="impara-rest-retry"><IconRefresh size={12} />{t('impara.retry')}</Button></div>}

              <div className="ip-acts">
                <Button variant="primary" onClick={next} disabled={atLast} testid="impara-next">
                  {waitingRest ? <><IconSpinner size={12} />{t('impara.writingRest')}</> : <>{t('impara.next')} <IconArrowRight size={13} /><Kbd>→</Kbd></>}
                </Button>
                <Button onClick={() => extra('better')} disabled={busy} testid="impara-better">{t('impara.better')}</Button>
                <Button onClick={() => extra('example')} disabled={busy} testid="impara-example">{t('impara.example')}</Button>
                <Button onClick={() => extra('code')} disabled={busy} testid="impara-code">{t('impara.code')}</Button>
                <Button onClick={() => setAsking(a => (a === null ? '' : null))} disabled={busy} testid="impara-ask" aria-expanded={asking !== null}><IconQuestion size={13} />{t('impara.ask')}</Button>
                <span className="sp" />
                {idx > 0 && <Button variant="ghost" size="s" onClick={back} testid="impara-prev" tip={`${t('impara.prev')}|←`}><IconArrowLeft size={12} /></Button>}
                <button type="button" className={`ip-mic ${micOn ? 'live' : ''}`} onClick={toggleMic} aria-pressed={micOn} aria-label={t('impara.voiceMe')} data-tip={`${t('impara.voiceMe')}|Ctrl M`} data-testid="impara-mic-btn"><IconMic size={14} /></button>
                {micOn && <span className="ip-heard" data-testid="impara-heard">{phase === 'preparing' ? t('impara.micPreparing') : phase === 'hearing' || phase === 'transcribing' ? t('impara.hearing') : heard ? `«${heard}»` : t('impara.listening')}</span>}
              </div>
              {asking !== null && (
                <form className="ip-askbox" onSubmit={e => { e.preventDefault(); if (asking.trim()) { extra('question', asking.trim()); setAsking(null); } }}>
                  <input autoFocus value={asking} onChange={e => setAsking(e.target.value)} placeholder={t('impara.askPlaceholder')} maxLength={600} data-testid="impara-ask-input"
                    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAsking(null); } }} />
                  <Button variant="primary" size="s" type="submit" disabled={!asking.trim()} testid="impara-ask-send">{t('impara.askSend')}</Button>
                </form>
              )}

              {piece?.code && (
                <div className="ip-code" data-testid="impara-code-panel">
                  <div className="ip-code-file">{piece.code.file || t('impara.codeNoFile')}</div>
                  {piece.code.diff.split('\n').map((line, i) => <div key={i} className={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''}>{line || ' '}</div>)}
                </div>
              )}
              <div className="ip-foot">
                {piece?.words?.length ? <><span className="ip-muted">{t('impara.words')}</span>{piece.words.map(w => <span key={w.term} className="ip-word" data-tip={w.meaning} tabIndex={0} aria-label={`${w.term}: ${w.meaning}`}>{w.term}</span>)}</> : null}
                <span className="sp" />
                <span className="ip-muted">{t('impara.saved', { time: saved })}</span>
              </div>
            </>}
          {/* an extra being written, or one that did not arrive: on a piece and on a check (the end shows its grade's own) */}
          {item.kind !== 'end' && busy && <div className="ip-busy" data-testid="impara-busy" role="status"><IconSpinner size={13} />{t(`impara.busy.${lesson.busy!.kind}`)}</div>}
          {item.kind !== 'end' && lesson.busyError && <div className="ip-busy err" data-testid="impara-busy-error" role="alert">{lesson.busyError}<Button size="s" onClick={() => void retryLesson(lesson.id)} testid="impara-busy-dismiss">{t('impara.ok')}</Button></div>}
        </section>
      </div>
    </div>
  );
}
