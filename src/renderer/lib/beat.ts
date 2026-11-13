// The one heartbeat of the small "alive" marks (state pill dots, the streaming caret, the
// brain's live dots). Why: an infinite CSS animation makes the page restyle and the GPU draw 60 frames a second for as
// long as it is on screen; five chats at work kept the app near half a core with nobody typing, and the keys typed
// meanwhile waited behind those frames ("Lag nell'app", owner 2026-10-12). Here one timer steps a `data-blink`
// attribute on the marks themselves twice a second (the [data-blink="1"] rules in app.css, linear.css, brain.css), all
// in the same step so they blink together, only while such a mark exists, never while the window is hidden, never with
// prefers-reduced-motion (the marks stay still). On the marks, not on <html>: an attribute on the root made Blink walk
// and restyle the whole document twice a second (the streaming caret's selector has nothing to narrow it), a cost that
// grew with every transcript on screen ("va a scatti a fine giornata", 2026-10-29). A mark that appears takes the beat
// at the next step. Started by main.tsx on every page.

const STEP_MS = 500; // bench at rest, 5 working chats: 5 steps a second 0.15 core, 2 a second 0.08, none 0.05
/** the marks' class lists (getElementsByClassName: live lists, no selector matching) */
const MARKS = ['pill-dot', 'md streaming', 'bx-live', 'bx-live-dot run'];
// the working spark and the spinners turn smoothly on the compositor (shell.css, app.css): html[data-hidden] pauses them

let n = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let lists: HTMLCollectionOf<Element>[] | null = null;
const root = () => document.documentElement;
const marks = () => (lists ??= MARKS.map(c => document.getElementsByClassName(c)));

/** Every mark on the page gets `value` (undefined: the attribute goes, the resting look). */
function mark(value: string | undefined): void {
  for (const list of marks()) for (let i = 0; i < list.length; i++) {
    const el = list[i]!;
    if (value === undefined) el.removeAttribute('data-blink');
    else if (el.getAttribute('data-blink') !== value) el.setAttribute('data-blink', value);
  }
}

/** One step: every mark blinks together. */
export function step(): void {
  if (!marks().some(l => l.length > 0)) return; // nothing alive on screen: no style change, no frame
  n = (n + 1) % 2;
  mark(String(n));
}

let started = false;
export function startBeat(): void {
  if (started) return;
  started = true;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const sync = () => {
    const run = !document.hidden && !still?.matches;
    if (document.hidden) root().setAttribute('data-hidden', ''); else root().removeAttribute('data-hidden');
    if (run && !timer) timer = setInterval(step, STEP_MS);
    if (!run && timer) { clearInterval(timer); timer = null; }
    if (still?.matches) mark(undefined); // the resting look: the same as the old animations' end frame
  };
  document.addEventListener('visibilitychange', sync);
  still?.addEventListener?.('change', sync);
  sync();
}
