// When a little person speaks (ADR 0303): the timing of its small bubble of nonsense, and which moment the line is
// for. The lines are in shared/agent-quips.ts; this file decides when one is said and about what. A person on a
// Grindhouse strip speaks now and then by itself about what its chat is really doing (quipMoment: its state, or the
// tool it is using with the real file, command or site; zero tokens, read from the transcript the app already has),
// and any person says a `pat` or `whack` line when the user clicks it. While its chat works it speaks nearly all the
// time, each line staying a few seconds (the owner, 2026-11-14: «che le frasi si vedano finché lavorano», ADR 0305);
// otherwise now and then. A few voices at a time on the page; none by itself while the window is hidden, on the
// frozen demo clock (screenshots stay equal) or under prefers-reduced-motion. One pending timeout per speaking
// person, nothing per frame. Used by AgentSprite.tsx and StripFace.tsx.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatItem } from '@shared/contract';
import { pickQuip, quipOfTool, type QuipKind, type QuipRole } from '@shared/agent-quips';
import { lang } from '../i18n';
import { isFrozen } from './clock';
import type { SpriteState } from './agent-sprites';

/** What a line is about: the moment and, when there is one, the real thing's name. */
export interface QuipMoment { kind: QuipKind; x?: string }
/** How far back the last tool is looked for: an older one is no longer what it is doing. */
const RECENT = 6;
/** The moment of a chat: its state, or at work the tool it used last (the file, command, search or site with it).
 *  With `shown` (the kind of work its person is drawn doing, StripFace.tsx: it changes a little later than the tools
 *  do) the line is about that kind, with the last thing of that kind: the words and the animation say the same. */
export function quipMoment(state: SpriteState, items: readonly ChatItem[] | undefined, shown?: QuipKind | null): QuipMoment {
  if (state !== 'work') return { kind: state };
  let last: QuipMoment | null = null;
  for (let i = (items?.length ?? 0) - 1, seen = 0; i >= 0 && seen < RECENT; i--, seen++) {
    const it = items![i]!;
    if (it.kind !== 'tool') continue;
    const m = quipOfTool(it.name, it.input);
    if (!shown || m.kind === shown) return m;
    last ??= m;
  }
  return shown ? { kind: shown } : last ?? { kind: 'work' };
}
/** One line in three is the role's plain nonsense, for variety; the others are about what it is doing. */
export const PLAIN_SHARE = 1 / 3;

/** How long a bubble stays, in ms: a click's line and a line outside work («che duri poco»). */
export const QUIP_MS = 2600;
/** A line said while the chat works stays longer (the owner, 2026-11-14: «che le frasi si vedano finché lavorano»). */
export const QUIP_WORK_MS = 6000;
/** The pause before a person speaks by itself, after its last bubble is gone (`rnd` in 0..1). At work (`lively`) it
 *  speaks nearly all the time: 1.5-4.5 s the first time, then 2.5-6 s. Otherwise 15-60 s the first time, then 60-150 s. */
export const quipDelay = (rnd: number, first: boolean, lively = false): number => Math.round(lively
  ? (first ? 1500 + rnd * 3000 : 2500 + rnd * 3500) : (first ? 15_000 + rnd * 45_000 : 60_000 + rnd * 90_000));
/** How many people may speak by themselves at the same time on the page. */
export const QUIP_VOICES = 3;
/** When the line of a click starts, in ms: after the stick has landed and gone, at the first pat (the bubble would
 *  cover them, the owner, 2026-11-14: «il testo a volte nasconde il bastone»). */
export const QUIP_REACTION_AT = { pat: 250, whack: 1000 } as const;

/** A person's turn to speak by itself: silent (null: it tries again soon) when it must be quiet or enough others are
 *  speaking; else its line and for how long. The moment is asked only when it is really about to speak (asking uses
 *  up the one line about an end). One line in three (`rnd` under PLAIN_SHARE) is plain nonsense; an end is always
 *  said as an end. At work the line stays longer. Pure. */
export function quipTurn(o: { quiet: boolean; speaking: number; busy?: boolean; lively?: boolean; moment: () => QuipMoment | null | undefined; rnd: number }): { say: QuipMoment; ms: number } | null {
  // `busy`: a line of its own is on the page or about to be (a click's line waits for the stick to leave): not over it
  if (o.quiet || o.busy || o.speaking >= QUIP_VOICES) return null;
  const m = o.moment();
  if (!m) return null;
  return { say: m.kind !== 'done' && o.rnd < PLAIN_SHARE ? { kind: 'work' } : m, ms: o.lively ? QUIP_WORK_MS : QUIP_MS };
}

// a few voices at a time: until when each person speaking by itself goes on
let voices: number[] = [];
// the lines on the page right now, each until when: two people do not say the same one at once
const onAir = new Map<string, number>();
const quiet = (): boolean => document.hidden || isFrozen() || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** One line on screen: its text and how long it stays (`n` counts the lines, to restart the bubble); `aside`: it is a
 *  click's line and stands clear of the hand and the stick. */
export interface Quip { text: string | null; n: number; ms: number; aside: boolean }
/** The bubble of one person: `text` while it speaks, `say` for a click (`delay`: the line comes that much later, once
 *  the hand or the stick has left the head). `mood` makes it speak by itself: asked each time it is about to, it gives
 *  the moment, or null to stay silent. `lively` (its chat works): it speaks nearly all the time, each line staying
 *  longer. */
export function useQuip(role: QuipRole, mood?: () => QuipMoment | null, lively = false): Quip & { say: (kind: QuipKind, x?: string, o?: { ms?: number; delay?: number }) => void } {
  const [quip, setQuip] = useState<Quip>({ text: null, n: 0, ms: QUIP_MS, aside: false });
  const last = useRef<string | undefined>(undefined), hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), show = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // until when this person's own line is on the page
  const until = useRef(0);
  const say = useCallback((kind: QuipKind, x?: string, o?: { ms?: number; delay?: number }) => {
    const ms = o?.ms ?? QUIP_MS, delay = o?.delay ?? 0, at = Date.now();
    // not the line another person is saying right now, when a few tries find another one
    let text = pickQuip(role, kind, lang(), Math.random, last.current, x);
    for (let i = 0; i < 3 && (onAir.get(text) ?? 0) > at; i++) text = pickQuip(role, kind, lang(), Math.random, text, x);
    if (onAir.size > 24) for (const [q, end] of onAir) if (end <= at) onAir.delete(q);
    onAir.set(text, at + delay + ms);
    last.current = text;
    until.current = at + delay + ms;
    clearTimeout(show.current); clearTimeout(hide.current);
    const put = () => setQuip(q => ({ text, n: q.n + 1, ms, aside: delay > 0 }));
    // a line that waits is not on the page before its time (so also with no animation: reduced motion)
    if (delay > 0) { setQuip(q => (q.text === null ? q : { ...q, text: null })); show.current = setTimeout(put, delay); } else put();
    hide.current = setTimeout(() => setQuip(q => ({ ...q, text: null })), delay + ms);
  }, [role]);
  useEffect(() => () => { clearTimeout(hide.current); clearTimeout(show.current); }, []);
  // the latest `mood` without restarting the wait at every render
  const moodRef = useRef(mood);
  useEffect(() => { moodRef.current = mood; });
  const chatty = !!mood;
  useEffect(() => {
    if (!chatty) return;
    let next: ReturnType<typeof setTimeout>;
    const wait = (first: boolean, after = 0) => {
      next = setTimeout(() => {
        // not now (hidden, frozen, enough others are speaking, nothing to say): it tries again soon, without a line
        const at = Date.now();
        voices = voices.filter(end => end > at);
        const turn = quipTurn({ quiet: quiet(), speaking: voices.length, busy: until.current > at, lively, moment: () => moodRef.current?.(), rnd: Math.random() });
        if (!turn) return wait(true);
        voices.push(at + turn.ms);
        say(turn.say.kind, turn.say.x, { ms: turn.ms });
        wait(false, turn.ms);
      }, after + quipDelay(Math.random(), first, lively));
    };
    // its chat started or stopped working while a line is on the page: that line is let finish first
    wait(true, Math.max(0, until.current - Date.now()));
    return () => clearTimeout(next);
  }, [chatty, lively, say]);
  return { ...quip, say };
}
