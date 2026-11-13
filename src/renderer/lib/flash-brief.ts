// «Fanne un lavoro» (ADR 0209), the wait for Flash's brief, kept at module level so it survives the tile: switching the
// column to the Orchestrator unmounts LampoTile, and the draft must still land when Flash finishes. startBrief records
// the click time and the fallback (the last question and answer); a watcher on the app store drafts Flash's brief into
// the Orchestrator's input once the turn after the ask has ended (lib/lampo.ts briefStep), the fallback when it brought
// none or after BRIEF_WAIT_MS. Used by LampoTile.tsx.
import { useSyncExternalStore } from 'react';
import { app } from '../store/store';
import { isBusy } from '../store/state';
import { brainBridge } from '../actions';
import { briefStep } from './lampo';

/** how long «Fanne un lavoro» waits for Flash's brief before drafting the last exchange */
export const BRIEF_WAIT_MS = 120_000;

type Pending = { chatId: string; since: number; fallback: string; timer: ReturnType<typeof setTimeout>; stop: () => void };
let pending: Pending | null = null;
const listeners = new Set<() => void>();
const changed = () => { for (const fn of listeners) fn(); };

function finish(text: string): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.stop();
  pending = null;
  changed();
  brainBridge.draftToOrchestrator(text, () => {});
}

function check(): void {
  if (!pending) return;
  const s = app.get(), chat = s.chats[pending.chatId];
  if (!chat || chat.closedAt) return finish(pending.fallback);
  const step = briefStep(s.items[pending.chatId], isBusy(chat), pending.since);
  if (step.done) finish(step.brief ?? pending.fallback);
}

/** Starts waiting for the brief Flash writes in `chatId` (the ask was just sent); a new click replaces the old wait. */
export function startBrief(chatId: string, fallback: string, now = Date.now()): void {
  if (pending) { clearTimeout(pending.timer); pending.stop(); }
  // the ask's time comes from main: a little slack for clocks read a moment apart
  pending = { chatId, since: now - 2_000, fallback, timer: setTimeout(() => finish(fallback), BRIEF_WAIT_MS), stop: app.subscribe(check) };
  changed();
  check();
}

/** Whether Flash is writing a brief for the Orchestrator (the button waits meanwhile). */
export const useBriefing = (): boolean => useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => pending !== null);
