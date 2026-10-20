// The morning block's state in the renderer (ADR 0102): tells main the user is here (at start, then on a click, a key,
// the window's focus or visibility, at most once a minute) through 'morning:brief' presence, and keeps what main
// answers (whether the block shows now, the brief). Esc / Ok dismisses it for the day; Ctrl+J reads the brief now
// (actions.ts nextThing). Used by MorningBlock.tsx (the empty Grindhouse, the line atop the Orchestrator).
import { useEffect } from 'react';
import type { MorningBrief, MorningState } from '@shared/contract';
import { sb } from '../sb';
import { createStore } from './createStore';

const NONE: MorningState = { history: false, show: false, brief: null };
/** block = the full block is on screen (the empty Grindhouse): the Orchestrator's line then stays away */
export const morning = createStore<{ state: MorningState | null; block?: boolean }>({ state: null });
let started = false, last = 0, inflight = false;

async function presence(force = false): Promise<void> {
  const now = Date.now();
  if (inflight || (!force && now - last < 60_000)) return;
  last = now; inflight = true;
  try { const state = await sb.invoke('morning:brief', { op: 'presence' }); morning.set(s => ({ ...s, state })); }
  catch { if (!morning.get().state) morning.set(s => ({ ...s, state: NONE })); }
  finally { inflight = false; }
}
const onActivity = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void presence(); };

function start(): void {
  if (started) return;
  started = true;
  for (const ev of ['pointerdown', 'keydown', 'focus'] as const) window.addEventListener(ev, onActivity, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onActivity);
  void presence(true); // the app is open in front of the user: a presence
}

export function useMorning(): MorningState | null { useEffect(start, []); return morning.use(s => s.state); }

/** Esc / Ok: not again today. */
export async function dismissMorning(): Promise<void> {
  morning.set(s => ({ ...s, state: s.state ? { ...s.state, show: false, brief: null } : NONE }));
  try { const state = await sb.invoke('morning:brief', { op: 'dismiss' }); morning.set(s => ({ ...s, state })); } catch { /* hidden here anyway */ }
}

/** The brief now, shown or not (Ctrl+J's fallback). */
export async function morningBriefNow(): Promise<MorningBrief | null> {
  try { return (await sb.invoke('morning:brief', { op: 'get' })).brief; } catch { return null; }
}
