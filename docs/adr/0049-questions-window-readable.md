# ADR 0049 · The questions window reads as a page: question large, why folded, options as cards, a rail for the queue

Date: 2026-10-14 · Status: accepted · Amends: ADR 0044 (placement, the "Altre in attesa" row)

## Context
The user, 14/10: "voglio che fai partire un agente per ottimizzare la UI delle domande non mi piace in generale non lo
trovo molto leggibile anche quando mi dai i commenti e le cose, cristo abbiamo piena liberta di UI e tu mi fai
schifezze, impegnati sulla ui performante e stabile". The window reused the chat tile's panel: three frames one inside
the other (window, amber card, focus ring), the chat's name larger than the question (14 px, like the options), the
context open by default above the options (at 1366×768 the options and the commands with Esegui fell below the fold),
a text to approve inside that context's scrolling box (a scroll in a scroll), descriptions at 12 px in a low-contrast
grey, and the other waiting requests as a wall of truncated chips. Centered vertically, the window jumped when the
turn's items loaded after it opened.

## Decision
- **Its own size of the request panel** (`RequestPanel` / `CommandRequest` variant `window`, `AskContext` layout
  `window`, styles in `styles/qwin.css`), one surface without nested frames: who asks in small type on top, then the
  kind (Domanda / Permesso / Comando) and "domanda 1 di 3", then **the question at 21 px**, lines under ~62 characters.
- **The why in two lines**, the last prose of the turn, unfolded with "Contesto completo" (reasoning, previews); the
  links stay chips. **A text to approve** (a ```md / mail / comment block, ADR 0043) is taken out of the prose and shown
  as a document: never folded, never in its own scrolling box, 14.5 px with lines under ~72 characters, "Testo da
  approvare" with Copia as the primary button and Mandato beside it.
- **Options as large cards**: a 26 px key with the number, the label at 15 px, the description at 13.5 px in the
  secondary text color; the recommended one marked three ways (blue border, tint, "Consigliata" label). The free answer
  is a slim dashed row ("Rispondi a parole tue…"). A permission shows its whole command wrapped (what the user approves)
  and large buttons; a command shows the chat's explanation as the title.
- **Keys in the footer** (1–N scegli, ↑↓, Invio) with "Rispondi dopo Esc"; a permission's and a command's keys are on
  their buttons. "Apri la chat" and "Spegni" are quiet links in the header.
- **A rail for the queue**: with more than one request a column on the left lists them all in arrival order (chat and
  what it asks, two lines), the shown one marked; a click answers that one now (ADR 0044's any order). The rail scrolls
  and never makes the window taller than the request.
- **Anchored near the top** (`clamp(20px, 7vh, 88px)`), horizontally centered, like a command palette: content that
  loads late grows downward, nothing already on screen moves.
- **Measured**: `lib/questions.ts qwinStats` counts the window's and the card's renders and the last opening time;
  the window's selectors return primitives or stable lists, so other chats' events never render it.

## Consequences
- e2e: `questions-perf.spec.ts` (opening < 100 ms, measured 44 ms; no move after opening; 0 renders on 30 events of
  other chats; ten waiting answered with the keyboard one after another), `questions-gallery.spec.ts` (every kind of
  request, dark and light, 1366 and 1920: `test-results/shots/qgal-*.png`). `qwin-count` is the rail's total;
  `qwin-current` is new; `qwin-pick` are the rail's other rows; the window's vertical centering test became the top anchor.
- The tile, lane, Regia and layer panels are unchanged.

## Addendum: images inside a question (2026-10-14)
The user: "mi piacerebbe che le immagini si potessero vedere direttamente nella domanda" (he does not browse files).
- **What shows**: the local PNG, JPG and WebP files a question names (its text, an option's label, description or
  preview, the turn's prose): markdown images `![testo](C:\…\x.png)`, `file:///` URLs, bare absolute paths
  (`lib/askImages.ts`). Captioned thumbnails above the context (window) or after the visuals (panels); a click opens
  one large inside the app (← → move, Esc or a click outside closes only the viewer). The markdown never shows in the
  title; a file shown as a thumbnail is no longer also a link chip.
- **How it is read** (`main/ask-image.ts`, IPC `app:askImage`): main reads the file only if it is absolute, local
  (no UNC), inside the allowed folders after resolving links (the profile, both `evidence` folders, the brain, the
  app's repo and its `second-brain-wt` worktrees), a regular file ≤ 4 MB, with the extension and magic bytes of a
  PNG, JPG or WebP. It answers a `data:` URL (the CSP already allowed `img-src data:`); otherwise one Italian line why
  ("Fuori dalle cartelle ammesse…"), shown in place of the thumbnail. The renderer never gets a `file:` URL; the CSP,
  sandbox and sender check are unchanged. A new allowed folder is a decision of the user.
- Tests: `test/unit/ask-image.test.ts`, `test/unit/askImages.test.ts`, `test/e2e/questions-images.spec.ts`
  (`qimg-window-<theme>.png`, `qimg-viewer.png`).

## Review fixes (2026-10-14)
- The rail grows the window to the left (room permitting): the question being read does not move when a second
  request arrives (`questions-perf.spec.ts`). The footer's keys are written by the card for the step it shows.
- The image viewer is the app's open dialog (`ui.modal = 'visual'`, like GenUi's full view) and stops React events at
  its portal: a digit or Enter pressed in it never answers the question behind. A refused image keeps an "Apri"
  button; only shown images drop their link chip; a missing, refused or busy file is asked again next time.

## Context first, the question short (2026-10-15)
The user: "le domande devono essere realmente comprensibili al volo, spiegate brevemente bene con il contesto, e poi
la domanda vera breve". The card now reads: kind (small caps) → a muted lead → the question large → the choices.
- **The lead** is the agent's own context sentence when its question is one text "statements. question?"
  (`lib/askSplit.ts`): split only when certain (the last sentence alone ends with "?", the part before it has no other
  question, no cut abbreviation, number, code span or link); otherwise the text stays whole. Never rewritten. The tile
  panel shows the same split.
- Without that, the lead is the two lines of the turn's why (as before, now above the question), but only when the
  chat's items were loaded as the card opened. What is above the question is fixed when the card opens (the agent's own lead changes only with the step of a multi-question request, together with the question); whatever
  loads or unfolds later ("Contesto completo", "Te la richiede", images) goes under it, so the question never moves.
- Options: descriptions quieter than labels (the recommended and the current one keep the stronger tone); the next
  request fades in (opacity only, nothing moves; off with reduced motion). Dialogs (`.modal`) get a little more air
  and a 17px title.
