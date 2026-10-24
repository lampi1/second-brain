// The pure rule of when a notification sound plays (the sounds themselves, one per kind, are lib/sounds.ts since
// 2026-10-24): once per alert event as it arrives from main (feed:events, never throttled like the
// toasts' repaint of a minimized window), not when the kind is muted, in do-not-disturb or with tasks.sound off. Why: the user, 2026-10-13, "voglio una notifica in app
// anche con il suono" for DevOps mentions and changes on his things (ADR 0029). Used by lib/layer.ts; the rule is
// pinned by test/unit/task-alerts.test.ts. A new question, permission or command rings too (requestChimes; the user,
// 2026-10-13: "una notifica anche sonora", "Suono sempre"), with the same switch, the mute of kind "question" and dnd. Since 2026-10-24 every toast kind that
// arrives by itself rings with its own sound (sounds.ts EVENT_SOUND: a failed chat, a sync or login problem, a budget at
// 100 %), not only DevOps alerts.

import { EVENT_SOUND } from './sounds';

/** Kinds whose toast plays a sound. */
export const CHIME_KINDS = new Set(Object.keys(EVENT_SOUND));

/** Event ids that should chime now: arriving events of a chiming kind, not from while the app was closed, not chimed
 *  before, unless the sound is off, the kind muted or do-not-disturb on. */
export function toChime(events: readonly { id: string; kind: string; away?: boolean; priority?: string }[], chimed: ReadonlySet<string>,
  opts: { soundOn: boolean; muted: Readonly<Record<string, boolean>>; dnd: boolean }): string[] {
  if (!opts.soundOn || opts.dnd) return [];
  // a budget event toasts (and rings) only at 100 % (notify.ts tierOf)
  return events.filter(e => CHIME_KINDS.has(e.kind) && (e.kind !== 'budget' || e.priority === 'urgent') && !e.away && !opts.muted[e.kind] && !chimed.has(e.id)).map(e => e.id);
}

/** Does a new request ring? The alerts' switch (tasks.sound), unless requests (feed kind "question") are muted or dnd. */
export const requestChimes = (opts: { soundOn: boolean; muted: Readonly<Record<string, boolean>>; dnd: boolean }): boolean =>
  opts.soundOn && !opts.dnd && !opts.muted.question;
