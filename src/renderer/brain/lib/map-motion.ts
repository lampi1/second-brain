// The motion math of the 3D brain map, kept free of three.js so it is unit-tested (test/unit/map-motion.test.ts):
// time-based easing of every animated value (a node lighting up or fading, a path dimming, a newcomer growing in), the
// live glow's fade between two snapshots (the app pulls one a second; the picture fades continuously in between), the
// pulse travelling along an axon, the breathing of a neuron at work, and the shape of each neuron (which dendrite
// variant, how it is turned, which way its axons bend), derived from its id so the picture is the same at every open.
// Used by map/engine.ts.

/** A value easing towards its target: `tau` ms is the time to cover about 63% of the gap; returns the new value and
 *  snaps onto the target once closer than `eps` (so the loop can tell when everything has landed). */
export function approach(cur: number, target: number, dtMs: number, tau: number, eps = 0.002): number {
  if (Math.abs(target - cur) <= eps) return target;
  const next = cur + (target - cur) * (1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tau)));
  return Math.abs(target - next) <= eps ? target : next;
}

/** Lighting up is quick, fading out is slower: the eye catches the start and is not startled by the end. */
export const TAU_UP = 140;
export const TAU_DOWN = 420;
export const tauFor = (cur: number, target: number): number => (target > cur ? TAU_UP : TAU_DOWN);

/** How long a snapshot's fading level may be carried forward without a newer one (the app sends one a second): a
 *  frozen clock (the demo) or a stalled source stops the fade a little below the last known level, never at zero. */
export const CARRY_MS = 1200;
/** The live level to show `sinceMs` after a snapshot said `level`: a running call stays at 1; a finished one keeps
 *  fading at the snapshot's own rate (1 → 0 over fadeMs), for at most CARRY_MS. */
export function liveTarget(level: number, running: boolean, sinceMs: number, fadeMs: number): number {
  if (running) return 1;
  if (level >= 1) return 1;
  return Math.max(0, level - Math.min(Math.max(0, sinceMs), CARRY_MS) / fadeMs);
}

/** Breathing of a neuron at work, 0..1: a slow sine (period about 1.6 s), phase-shifted per neuron. */
export const breath = (nowMs: number, phase: number): number => 0.5 + 0.5 * Math.sin(nowMs / 260 + phase);

/** Where the signal is along an axon, 0..1 travelling from the source to the target, then a rest: one soft pulse per
 *  period (beyond 1 the pulse is out of sight, so the axon rests between two signals). */
export function pulseHead(nowMs: number, periodMs: number, offset: number): number {
  const p = ((nowMs / periodMs + offset) % 1 + 1) % 1;
  return p * 1.6 - 0.2; // -0.2..1.4: enters before the source, leaves past the target
}

/** A stable 32-bit hash of an id (FNV-1a): the neuron's shape and the bend of its axons. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** 0..1 from a hash and a salt */
export const unit = (h: number, salt: number): number => (hash(`${h}:${salt}`) % 10007) / 10007;

/** The shape of a neuron: one of `variants` dendrite arrangements, turned around the vertical by a fixed angle and
 *  barely tilted (the dendrites stay beside the soma, clear of the labels above and below), breathing with its phase. */
export function neuronShape(id: string, variants: number): { variant: number; rx: number; ry: number; rz: number; phase: number } {
  const h = hash(id), tau = Math.PI * 2;
  return { variant: h % variants, rx: (unit(h, 1) - 0.5) * 0.6, ry: unit(h, 2) * tau, rz: (unit(h, 3) - 0.5) * 0.6, phase: unit(h, 4) * tau };
}

/** The bend of an axon, as a fraction of its length: slight, its side fixed by the link's key. */
export function axonBend(key: string): number {
  const h = hash(key);
  return (h & 1 ? 1 : -1) * (0.06 + 0.08 * unit(h, 5));
}

/** Directions of the dendrite stubs of one variant: `count` unit vectors spread around the soma (a golden spiral,
 *  jittered by the variant, flattened towards the horizontal so no stub points at a label), each with its length factor. */
export function dendrites(variant: number, count: number): { dir: [number, number, number]; len: number }[] {
  const out: { dir: [number, number, number]; len: number }[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const j = unit(variant * 31 + i, 7);
    const y = (1 - ((i + 0.5) / count) * 2) * 0.55;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * golden + variant * 1.3 + j * 0.8;
    out.push({ dir: [Math.cos(a) * r, y, Math.sin(a) * r], len: 0.75 + 0.6 * unit(variant * 17 + i, 9) });
  }
  return out;
}
