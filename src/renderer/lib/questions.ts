// The questions window (QuestionsWindow.tsx, always on since 2026-10-22: the owner wants every question, permission
// and command there, never off) and the typing guard that keeps it from taking the user's text (the user: "la modale
// non deve rubare il testo che sto scrivendo"). While the user types in a field (a key less than TYPING_IDLE_MS ago, the
// field still focused) a new request waits as a small pill; once the typing stops it shows, and it takes the keyboard
// only if no field outside it has it. Used by QuestionsWindow.tsx; started by main.tsx.
export const TYPING_IDLE_MS = 2000;

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
