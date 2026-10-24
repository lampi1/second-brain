// The notification sounds: one short sound per kind of notice, synthesized with Web Audio (no sound file, nothing to
// load, no CSP media source). Why: the user, 2026-10-24, "i rumori più belli e vari in base al tipo di notifica";
// before there was one two-note chime for everything (lib/chime.ts keeps the rule of WHEN to ring). Each recipe is a
// few soft notes at low volume, under 0.9 s. Several notices arriving together ring once: the most important kind of
// the burst (RANK). A hidden run (tests, agents) mutes the window (main/window.ts), so the sound plays silently; each
// one is counted on <html data-chimes> and the last kind is on <html data-sound> for the e2e tests.
// Used by lib/layer.ts (feed events, requests) and lib/notice.ts (notify with a sound); pinned by test/unit/sounds.test.ts.

import type { NoticeTone } from '@shared/contract';

export type SoundKind = 'success' | 'info' | 'attention' | 'warn' | 'error' | 'celebrate';

/** The sound of each notice look (components/Notice.tsx). */
export const SOUND_OF: Readonly<Record<NoticeTone, SoundKind>> = {
  ok: 'success', info: 'info', attention: 'attention', warn: 'warn', err: 'error', celebrate: 'celebrate',
};

/** Does a notify() notice ring now? Not when asked (sound: false), the alerts' switch is off, its kind muted or
 *  do-not-disturb on. */
export function notifyRings(spec: { sound?: boolean | undefined; muteKind?: string | undefined }, opts: { soundOn: boolean; muted: Readonly<Record<string, boolean>>; dnd: boolean }): boolean {
  return spec.sound !== false && opts.soundOn && !opts.dnd && !(spec.muteKind && opts.muted[spec.muteKind]);
}

/** What wins when several sounds arrive in the same burst (higher first). */
export const RANK: Readonly<Record<SoundKind, number>> = { error: 6, attention: 5, warn: 4, celebrate: 3, success: 2, info: 1 };

/** The feed event kinds that ring, and with which sound. A question or permission rings from `pending:added`
 *  (attention), so chat-waiting is not here: it would ring twice. */
export const EVENT_SOUND: Readonly<Record<string, SoundKind>> = {
  'task-alert': 'warn', 'chat-failed': 'error', 'sync-error': 'error', 'sync-blocked': 'error', login: 'warn', budget: 'warn',
};

/** The sound of a burst: the highest-ranked kind. */
export const loudest = (kinds: readonly SoundKind[]): SoundKind | null =>
  kinds.reduce<SoundKind | null>((a, k) => (a === null || RANK[k] > RANK[a] ? k : a), null);

interface Note { f: number; at: number; dur: number; type?: OscillatorType; vol: number; to?: number; partial?: number }

/** The notes of each sound: start offset (s), length (s), peak gain (kept ≤ 0.13). */
export const RECIPES: Readonly<Record<SoundKind, readonly Note[]>> = {
  // two light notes going up
  success: [{ f: 784, at: 0, dur: 0.18, vol: 0.09, partial: 2 }, { f: 1175, at: 0.09, dur: 0.32, vol: 0.1, partial: 2 }],
  // one soft drop
  info: [{ f: 1320, to: 880, at: 0, dur: 0.28, vol: 0.08 }],
  // a two-tone ding-dong: someone waits for an answer
  attention: [{ f: 988, at: 0, dur: 0.45, type: 'triangle', vol: 0.1, partial: 3 }, { f: 784, at: 0.18, dur: 0.6, type: 'triangle', vol: 0.1, partial: 3 }],
  // a short double tap
  warn: [{ f: 880, at: 0, dur: 0.12, type: 'triangle', vol: 0.1 }, { f: 880, at: 0.14, dur: 0.16, type: 'triangle', vol: 0.1 }],
  // two low notes going down
  error: [{ f: 330, at: 0, dur: 0.22, type: 'triangle', vol: 0.13 }, { f: 262, at: 0.16, dur: 0.38, type: 'triangle', vol: 0.13 }],
  // C-E-G-C arpeggio and a sparkle on top: the end of the maintenance
  celebrate: [
    ...[523.25, 659.25, 783.99, 1046.5].map((f, i) => ({ f, at: i * 0.085, dur: 0.5 + i * 0.1, vol: 0.085, partial: 2.01 })),
    ...Array.from({ length: 6 }, (_, i) => ({ f: 2093 + i * 260, at: 0.38 + i * 0.045, dur: 0.16, vol: 0.025 })),
  ],
};

/** A burst: sounds asked within this window ring once. */
export const BURST_MS = 400;

let ctx: AudioContext | null = null;
let queued: SoundKind[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function note(c: AudioContext, t0: number, n: Note): void {
  const at = t0 + n.at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = n.type ?? 'sine';
  osc.frequency.setValueAtTime(n.f, at);
  if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, at + n.dur * 0.6);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(n.vol, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + n.dur);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + n.dur + 0.02);
  if (n.partial) note(c, t0, { f: n.f * n.partial, at: n.at, dur: n.dur * 0.6, vol: n.vol * 0.25 });
}

/** Plays one sound now; silently nothing when audio is not available. */
export function playSound(kind: SoundKind): void {
  const root = document.documentElement;
  root.dataset.chimes = String(Number(root.dataset.chimes ?? 0) + 1);
  root.dataset.sound = kind;
  try {
    const AC = window.AudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.01;
    for (const n of RECIPES[kind]) note(ctx, t0, n);
  } catch { /* no audio device: the notice is enough */ }
}

/** Asks for a sound: what arrives in the next BURST_MS rings once, the most important kind. */
export function ring(kind: SoundKind): void {
  queued.push(kind);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const k = loudest(queued);
    queued = [];
    if (k) playSound(k);
  }, BURST_MS);
}
