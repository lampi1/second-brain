// A short, soft two-note chime made with Web Audio (no sound file, nothing to load, no CSP media source), and the pure
// rule of when to play it: once per task-alert event as it arrives from main (feed:events, never throttled like the
// toasts' repaint of a minimized window), not when the kind is muted, in do-not-disturb or with tasks.sound off. Why: the user, 2026-10-13, "voglio una notifica in app
// anche con il suono" for DevOps mentions and changes on his things (ADR 0029). Used by lib/layer.ts; the rule is
// pinned by test/unit/task-alerts.test.ts. A new question, permission or command rings too (requestChimes; the user,
// 2026-10-13: "una notifica anche sonora", "Suono sempre"), with the same switch, the mute of kind "question" and dnd. A hidden run (tests, agents) mutes the window (main/window.ts): the chime plays
// silently; each one is counted on <html data-chimes> for the e2e test.

/** Kinds whose toast plays the chime. */
export const CHIME_KINDS = new Set(['task-alert']);

/** Event ids that should chime now: arriving events of a chiming kind, not from while the app was closed, not chimed
 *  before, unless the sound is off, the kind muted or do-not-disturb on. */
export function toChime(events: readonly { id: string; kind: string; away?: boolean }[], chimed: ReadonlySet<string>,
  opts: { soundOn: boolean; muted: Readonly<Record<string, boolean>>; dnd: boolean }): string[] {
  if (!opts.soundOn || opts.dnd) return [];
  return events.filter(e => CHIME_KINDS.has(e.kind) && !e.away && !opts.muted[e.kind] && !chimed.has(e.id)).map(e => e.id);
}

/** Does a new request ring? The alerts' switch (tasks.sound), unless requests (feed kind "question") are muted or dnd. */
export const requestChimes = (opts: { soundOn: boolean; muted: Readonly<Record<string, boolean>>; dnd: boolean }): boolean =>
  opts.soundOn && !opts.dnd && !opts.muted.question;

let ctx: AudioContext | null = null;

/** Plays the chime (about 0.4 s, low volume); silently nothing when audio is not available. */
export function playChime(): void {
  const root = document.documentElement;
  root.dataset.chimes = String(Number(root.dataset.chimes ?? 0) + 1);
  try {
    const AC = window.AudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const t0 = ctx.currentTime + 0.01;
    for (const [i, freq] of [880, 1318.5].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = t0 + i * 0.12;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.32);
    }
  } catch { /* no audio device: the toast is enough */ }
}
