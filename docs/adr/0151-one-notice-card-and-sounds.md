<!-- One notification design for the app and the global layer, and one sound per kind of notice. -->
# 0151 — One notice card, one sound per kind

Date: 2026-10-24

The user asked (2026-10-24) to review every notification, make them all one hyper-clean style, give them nicer sounds
that change with the kind of notice, and show a great notice when the maintenance ends.

Before, the app had three toast looks (the in-app toast, the global layer's event toast over the browsers, the brain
pages' own toast relayed into the app) and one two-note chime for DevOps alerts and new requests.

Decision:

- **One card.** `components/Notice.tsx` (styles `notif.css`) draws every toast, in the app (`Overlays.tsx` Toasts) and in
  the global layer (`OverlayApp.tsx`): the tone's icon in a tinted square, a small upper-case label, the title, a
  detail line, optional chips, one action, ✕ and a time bar, all colored by the tone. Tones (`NoticeTone` in the
  contract): `ok`, `info`, `attention` (someone waits for the user's answer), `warn`, `err`, and `celebrate`, a bigger
  card with a violet/green glow and a one-shot sparkle burst, for the end of a big background job (the maintenance).
- **One sound per kind.** `lib/sounds.ts` synthesizes six short sounds with Web Audio (still no sound file, no CSP
  change): success (two notes up), info (one soft drop), attention (ding-dong), warn (double tap), error (two low notes
  down), celebrate (C-E-G-C arpeggio and a sparkle). Notices arriving within 400 ms ring once, with the most important
  kind.
- **What rings.** Only what arrives by itself: every alert kind that toasts (`EVENT_SOUND`: a failed chat, a sync or
  login problem, a budget at 100 %, a DevOps alert), a new question/permission/command (attention), and a background
  job announced with `lib/notice.ts` `notify()`. The answer to the user's own click (`toast()`: «Salvato», «Annullato»)
  stays silent. The switch stays the alerts' sound setting (`tasks.sound`), plus the per-kind mute and do-not-disturb.
- Windows notifications stay silent (2026-10-11 "mai suoni di default" for the system toasts): the app page plays the
  sound itself, also while minimized.

Consequences: `notify({ tone: 'celebrate', label, title, chips, action })` is the API for the maintenance's end (built
by the maintenance thread). `test/unit/sounds.test.ts` pins the sounds and the rules, `test/e2e/notices.spec.ts` the
card and a sound per tone (`<html data-sound>`).
