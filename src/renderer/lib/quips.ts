// When a little person speaks (ADR 0303): the timing of its small bubble of nonsense, and which moment the line is
// for. The lines are in shared/agent-quips.ts; this file decides when one is said and about what. A person on a
// Grindhouse strip speaks now and then by itself about what its chat is really doing (quipMoment: its state, or the
// tool it is using with the real file, command or site; zero tokens, read from the transcript the app already has),
// and any person says a `pat` or `whack` line when the user clicks it. One voice at a time on the page; none by
// itself while the window is hidden, on the frozen demo clock (screenshots stay equal) or under
// prefers-reduced-motion. One pending timeout per speaking person, nothing per frame. Used by AgentSprite.tsx and
// StripFace.tsx.
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
/** The moment of a chat: its state, or at work the tool it used last (the file, command, search or site with it). */
export function quipMoment(state: SpriteState, items: readonly ChatItem[] | undefined): QuipMoment {
  if (state !== 'work') return { kind: state };
  for (let i = (items?.length ?? 0) - 1, seen = 0; i >= 0 && seen < RECENT; i--, seen++) {
    const it = items![i]!;
    if (it.kind === 'tool') return quipOfTool(it.name, it.input);
  }
  return { kind: 'work' };
}
/** One line in three is the role's plain nonsense, for variety; the others are about what it is doing. */
export const PLAIN_SHARE = 1 / 3;

/** How long a bubble stays, in ms («che duri poco»). */
export const QUIP_MS = 2600;
/** The wait before a person speaks by itself: 15-60 s the first time, then 60-150 s (`rnd` in 0..1). */
export const quipDelay = (rnd: number, first: boolean): number => Math.round(first ? 15_000 + rnd * 45_000 : 60_000 + rnd * 90_000);

/** The air after a line before another person may speak, in ms. */
export const QUIP_AIR = 1500;
/** A person's turn to speak by itself: silent (null: it tries again soon) when it must be quiet or somebody else is
 *  speaking; else its line and until when the voice is taken. The moment is asked only when it is really about to
 *  speak (asking uses up the one line about an end). One line in three (`rnd` under PLAIN_SHARE) is plain nonsense;
 *  an end is always said as an end. Pure. */
export function quipTurn(o: { quiet: boolean; at: number; busyUntil: number; moment: () => QuipMoment | null | undefined; rnd: number }): { say: QuipMoment; busyUntil: number } | null {
  if (o.quiet || o.at < o.busyUntil) return null;
  const m = o.moment();
  if (!m) return null;
  return { say: m.kind !== 'done' && o.rnd < PLAIN_SHARE ? { kind: 'work' } : m, busyUntil: o.at + QUIP_MS + QUIP_AIR };
}

// one voice at a time: until when somebody is speaking by itself, and a little air after
let busyUntil = 0;
const quiet = (): boolean => document.hidden || isFrozen() || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The bubble of one person: `text` while it speaks (`n` counts the lines, to restart the bubble), `say` for a click.
 *  `mood` makes it speak by itself: asked each time it is about to, it gives the moment, or null to stay silent. */
export function useQuip(role: QuipRole, mood?: () => QuipMoment | null): { text: string | null; n: number; say: (kind: QuipKind, x?: string) => void } {
  const [quip, setQuip] = useState<{ text: string | null; n: number }>({ text: null, n: 0 });
  const last = useRef<string | undefined>(undefined), hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const say = useCallback((kind: QuipKind, x?: string) => {
    const text = pickQuip(role, kind, lang(), Math.random, last.current, x);
    last.current = text;
    setQuip(q => ({ text, n: q.n + 1 }));
    clearTimeout(hide.current);
    hide.current = setTimeout(() => setQuip(q => ({ text: null, n: q.n })), QUIP_MS);
  }, [role]);
  useEffect(() => () => clearTimeout(hide.current), []);
  // the latest `mood` without restarting the wait at every render
  const moodRef = useRef(mood);
  useEffect(() => { moodRef.current = mood; });
  const chatty = !!mood;
  useEffect(() => {
    if (!chatty) return;
    let next: ReturnType<typeof setTimeout>;
    const wait = (first: boolean) => {
      next = setTimeout(() => {
        // not now (hidden, frozen, somebody else is speaking, nothing to say): it tries again soon, without a line
        const turn = quipTurn({ quiet: quiet(), at: Date.now(), busyUntil, moment: () => moodRef.current?.(), rnd: Math.random() });
        if (!turn) return wait(true);
        busyUntil = turn.busyUntil;
        say(turn.say.kind, turn.say.x);
        wait(false);
      }, quipDelay(Math.random(), first));
    };
    wait(true);
    return () => clearTimeout(next);
  }, [chatty, say]);
  return { ...quip, say };
}
