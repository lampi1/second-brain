// "Domande in finestra" (settings questionsModal; the user, 2026-10-12: "le domande vorrei un toggle per farle comparire
// proprio come modale invece che nell’Orchestrator o nelle chat"): the switch, and the typing guard that keeps the window from
// taking the user's text (the user: "la modale non deve rubare il testo che sto scrivendo"). While the user types in a
// field (a key less than TYPING_IDLE_MS ago, the field still focused) a new request waits as a small pill; once the
// typing stops it shows, and it takes the keyboard only if no field outside it has it. Used by QuestionsWindow.tsx,
// ChatTile.tsx, OrchestratorTile.tsx, lib/layer.ts, actions.ts; started by main.tsx.
import type { AppState } from '../store/state';

export const TYPING_IDLE_MS = 2000;

/** The switch, read from the app state (off unless the user turned it on). */
export const questionsModalOn = (s: Pick<AppState, 'settings'>): boolean => s.settings?.questionsModal === true;

export const isEditable = (el: Element | null | undefined): boolean =>
  !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|range|color|file)$/.test((el as HTMLInputElement).type)));

/** A field outside the questions window has the keyboard (the user is writing somewhere else). */
export const writingElsewhere = (doc: Document = document): boolean => {
  const a = doc.activeElement;
  return isEditable(a) && !a!.closest('.qwin');
};

let lastTypedAt = 0;
/** ms left before the user counts as stopped typing (0 = not typing now). */
export function typingLeft(now = Date.now(), doc: Document = document): number {
  if (!writingElsewhere(doc)) return 0;
  return Math.max(0, TYPING_IDLE_MS - (now - lastTypedAt));
}

export function startTypingWatch(doc: Document = document): void {
  doc.addEventListener('keydown', e => { if (isEditable(e.target as Element | null) && !(e.target as Element).closest('.qwin')) lastTypedAt = Date.now(); }, true);
}

/** Measured by the e2e (questions-perf.spec.ts): how often the window and its card render, and how long the last
 *  opening took from the render that first had the request to the painted frame (ADR 0049: under 100 ms, no render on
 *  another chat's events). A few counters, always on: cheaper than a profiler build. */
export const qwinStats = { renders: 0, cardRenders: 0, openMs: -1 };
(globalThis as unknown as { __sbQwin?: typeof qwinStats }).__sbQwin = qwinStats;
