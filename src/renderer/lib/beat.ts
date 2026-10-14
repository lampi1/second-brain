// The one heartbeat of every "alive" mark (typing dots, tool spinners, state pill dots, the streaming caret, the
// brain's live dots). Why: an infinite CSS animation makes the page restyle and the GPU draw 60 frames a second for as
// long as it is on screen; five chats at work kept the app near half a core with nobody typing, and the keys typed
// meanwhile waited behind those frames ("Lag nell'app", owner 2026-10-12). Here one timer steps attributes on <html>
// twice a second (the html[data-b3] / [data-b4] / [data-blink] rules in app.css, shell.css, brain.css), only while
// such a mark exists, never while the window is hidden, never with prefers-reduced-motion (the marks stay still).
// Started by main.tsx on every page.

const STEP_MS = 500; // bench at rest, 5 working chats: 5 steps a second 0.15 core, 2 a second 0.08, none 0.05
const ALIVE = '.typing-dots, .spin, .pill-dot, .md.streaming, .bx-live, .bx-live-dot.run';

let n = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const root = () => document.documentElement;

function set(name: string, value: string): void {
  if (root().getAttribute(name) !== value) root().setAttribute(name, value);
}

/** One step: typing dots light in turn (3 steps = 1.5 s), spinners turn by 90° (4 steps), pulses blink each step. */
export function step(): void {
  if (!document.querySelector(ALIVE)) return; // nothing alive on screen: no style change, no frame
  n = (n + 1) % 12;
  set('data-b3', String(n % 3));
  set('data-b4', String(n % 4));
  set('data-blink', String(n % 2));
}

function clear(): void {
  for (const a of ['data-b3', 'data-b4', 'data-blink']) root().removeAttribute(a);
}

let started = false;
export function startBeat(): void {
  if (started) return;
  started = true;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const sync = () => {
    const run = !document.hidden && !still?.matches;
    if (run && !timer) timer = setInterval(step, STEP_MS);
    if (!run && timer) { clearInterval(timer); timer = null; }
    if (still?.matches) clear(); // the resting look: the same as the old animations' end frame
  };
  document.addEventListener('visibilitychange', sync);
  still?.addEventListener?.('change', sync);
  sync();
}
