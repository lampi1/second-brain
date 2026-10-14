# ADR 0035 · One request popup at a time, never in the Regia; "Rispondi dopo" and the "Da rispondere" queue

Date: 2026-10-13 · Status: accepted · Supersedes: ADR 0021's "Domande alla Regia" (setting `regiaDriven`, the Regia
hosting the work chats' questions, permissions and commands)

## Context
The user, 13/10, after typing single letters ("e", "s") as answers only to get rid of a question popup stuck on the
Regia: more than one question popup showed at once (the Regia widget's cards and the global layer's card beside it), a
Regia card had no way to close without answering (Esc only blurred a question and rejected a permission). Then:
"le domande delle altre chat [devono essere] sempre a modale o nella chat singola se l'opzione è disabilitata, la
regia mi serve principalmente per lo stato… e per spostarmi da una chat all'altra", and for commands "deve comparire
il popup o aggiungersi alla coda di domande o comandi, … con Esegui e un chiaro contesto e spiegazione". On "Rispondi
dopo": "a volte sono concentrato e non ho tempo per rispondere"; then "le domande in attesa o in coda siano sempre
presenti tipo in overlay con una notifica anche sonora" ("Suono sempre").

## Decision
- **"Domande alla Regia" is removed.** No setting, no switch (Ctrl+K, the Regia's ⋯ menu, Settings), no routing
  (`askedInRegia`, `useRouteCtx`). A work chat's question, permission or command shows in the questions window when
  "Domande in finestra" is on, else in the chat's own tile (and, when that tile is not on screen, in the global
  layer). The Regia's own requests stay in the Regia. An older `config.json` with `regiaDriven` loads without it (an
  unknown key is ignored; it is dropped on the next save).
- **At most one request popup on screen**: the questions window, the Regia widget's card or the global layer's card.
  Tiles' inline panels do not count. The Regia widget shows one card (its oldest, "Poi:" names the next) and none while
  the questions window or a layer card that has the keyboard is the popup; the layer shows no card while a Regia card
  or the questions window is on screen (`lib/layer.ts popupOnScreen`). Ctrl+J moves the popup instead of adding one.
- **"Rispondi dopo" on every request, everywhere** (tile, Regia card, layer card, questions window; Esc on a popup):
  one flag, not per request (`main/later.ts`, `userData/answer-later.json`, so it survives a restart; `later:get`,
  `later:set`, `later:changed`). On: no popup anywhere, every tile with a request shows an "in coda" line ("Rispondi"
  opens the queue on it), the chats stay blocked (never answered for the user), a new request opens nothing.
- **The "Da rispondere" queue** is the questions window called with every open request, oldest first, one at a time,
  whatever "Domande in finestra" says (off: it closes once empty). Ctrl+J, the top bar's counter ("Prossima cosa per
  te" turns into "Da rispondere N" while the flag is on), the layer's strip or a tile's "Rispondi" open it, and opening
  it turns the flag off. With the flag on and nothing waiting the button reads "Popup in pausa" (a click turns it
  off). Only the button and Esc set it: a click on the window's backdrop does nothing. A request that leaves
  `pending` leaves the queue: nothing to clean up after a restart.
- **Always in sight, with a sound.** While requests wait and the layer shows no card, the layer shows a small strip
  ("N richieste in attesa / da rispondere", the oldest one's chat, Ctrl+J), on every page, above the browser views,
  off the Regia widget's corner and 120 px above the window's bottom (a tile's composer stays free), never taking
  the keyboard; not over the questions window, not while every waiting request is on screen in its tile. Every new request rings the
  app's chime once (several together ring once; `lib/chime.ts requestChimes`: the alerts' switch `devops.sound`, the
  mute of kind "question", do-not-disturb), the flag on or off. While the flag is on, a new request's Windows
  notification is held (`brain/notify.ts held`): the app's own strip and sound only.
- **A card leaves the moment its request leaves `pending`**: every popup derives from the app store's `pending`.
- **A command card says why** ("Comando da eseguire", main/run/asks.ts): the chat's paragraph right before the block,
  as plain text (`CommandAsk.lead`, computed in main by shared/command-ask.ts so the global layer shows it too), in
  sight on every card; the turn's prose under "Contesto", one click away (not in the layer, whose page can not read
  the chat). Commands are requests like questions: the same popup, the same "Rispondi dopo".
- **The commands a chat gave in the turn of its question** (`commandsOfTurn`, before on the Regia's card) show with
  "Esegui" on that question in the questions window.

## Consequences
- The per-card "set aside" (ui `postponed`, the questions window's `parked`, "Mostra" in the Regia) is gone: one
  mechanism. Esc in the layer no longer brings the next card up: everything goes to the queue.
- e2e: `regia-driven.spec.ts` is gone; `one-popup.spec.ts` pins the rule, `answer-later.spec.ts` the queue (strip on
  the DevOps page, the chime counted on `<html data-chimes>` since hidden runs are muted, a restart). Testids
  `chat-sent-regia-*`, `regia-driven-toggle`, `st-regia-driven-switch`, `palette-item-regiadriven`, `regia-aside*` and
  the cards' `-from` lines are gone; `regia-next`, `regia-queued`, `chat-queued-*`, `layer-strip`, `*-later` and
  `qwin-card-cmds` are new.
- The brain's worker prompt (ask in your own chat; commands as one PowerShell block with 1-3 lines of context) is the
  Regia's side, outside this repo.
