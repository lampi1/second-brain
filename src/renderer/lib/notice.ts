// notify(): the one way to show a notice that arrives by itself (a job finished in the background, the maintenance's
// end) with its kind's sound. A notice is the app's single notification design (components/Notice.tsx, ADR 0151): the
// same card in the app and in the global layer over the browsers. The plain toast() (store/ui.ts) stays for the
// answer to the user's own click ("Salvato", "Annullato"): those never ring, the user caused them. The sound follows
// the alerts' switch (setting tasks.sound), the kind's mute and do-not-disturb, like every other notification sound.
// Used by whatever announces a finished background job (e.g. the maintenance); its pure rules (SOUND_OF, notifyRings) live in lib/sounds.ts.
import type { NoticeTone } from '@shared/contract';
import { app, dndActive } from '../store/store';
import { pushNotice, type Toast } from '../store/ui';
import { now } from './clock';
import { notifyRings, ring, SOUND_OF } from './sounds';

export interface NotifySpec {
  tone: NoticeTone;
  title: string;
  /** a small upper-case line above the title ("Manutenzione finita") */
  label?: string;
  detail?: string;
  /** short facts under the title ("3 proposte", "2 idee") */
  chips?: string[];
  action?: Toast['action'];
  /** ms on screen; a celebrate notice stays 20 s by default, the others 8 s */
  ttl?: number;
  /** false = no sound (default: rings) */
  sound?: boolean;
  /** the feed kind it belongs to, for the user's per-kind mute */
  muteKind?: string;
}

/** Shows a notice and plays its sound. Returns the notice's id (dismissToast closes it). */
export function notify(spec: NotifySpec): number {
  const id = pushNotice({
    title: spec.title, tone: spec.tone, ttl: spec.ttl ?? (spec.tone === 'celebrate' ? 20_000 : 8000),
    ...(spec.label ? { label: spec.label } : {}), ...(spec.detail ? { detail: spec.detail } : {}),
    ...(spec.chips ? { chips: spec.chips } : {}), ...(spec.action ? { action: spec.action } : {}),
  });
  const s = app.get();
  if (notifyRings(spec, { soundOn: s.settings?.tasks?.sound !== false, muted: s.settings?.mute ?? {}, dnd: dndActive(now()) })) ring(SOUND_OF[spec.tone]);
  return id;
}

// the e2e spec (test/e2e/notices.spec.ts) shows every look without waiting for a real background job
(globalThis as unknown as { __sbNotify?: typeof notify }).__sbNotify = notify;
