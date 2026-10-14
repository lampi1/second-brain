# ADR 0019 · Questions carry their context; the typing field keeps the keyboard; questions in a window (optional)

Date: 2026-10-12 · Status: accepted

## Context
The user (12/10): "quando mi fai le domande voglio sempre il contesto e il contenuto magari in un qualcosa di
espandibile o il link dei report o pr insomma a volte mi trovo le robe dentro la sezione ragionamento, perdo il focus
del campo di testo su cui sto scrivendo [...] nella visione a mosaico togli le domande che compaiono in alto "ti
aspettano" adesso me le fa la regia". Then: "le domande vorrei un toggle per farle comparire proprio come modale" and
"l'invia subito deve essere con il doppio invio".
Measured in the transcripts of 11-12/10: 128 of 177 AskUserQuestion calls had only a thinking block before them, no
visible text: the model writes what it asks about in its reasoning, and the transcript folded it away. The focus loss
was reproduced in Corsie: a chat that starts waiting moves column, its tile mounts again (or turns into a mini row),
and the focused input is gone; Mosaico and Regia kept the focus in all the cases tried.

## Decision
- **Context block on every question and permission** (`lib/askContext.ts`, `components/AskContext.tsx`): the turn's
  last prose pieces (assistant text and reasoning, marked "dal ragionamento della chat"), option previews, and the
  links named in them or in the request: web links (PR / work item names), `file:///` and `C:\` paths, the documents
  the turn wrote. Links are always in sight; the prose folds (open in the Regia, for forwarded requests, and in the
  questions window). The reasoning right before an ask shows open in the transcript, marked.
- **`app:openPath`** (new IPC, `main/open-path.ts`): a file link is untrusted model text, so only an absolute local
  path (a drive letter, after realpath) is accepted; UNC, `file://host` and `\\?\` paths are refused (they would send
  the Windows login to that host). Documents and images open with their app; anything else (an `.exe`, a script, a
  shortcut, a folder) is only shown selected in Explorer, never run. A hidden run records instead of opening.
  Web links keep the existing window-open handler (external browser).
- **No "Ti aspettano" strip in the Mosaico**: each chat asks in its tile, the Regia in its own; the global layer
  floats whatever is not on screen (a maximized chat). The strip stays only as the focus-mode peek.
- **The typing field keeps the keyboard** (`lib/focusKeeper.ts`): when the focused field (with a `data-testid`) leaves
  the page and the keyboard falls on nothing, the field with the same testid that shows up within 2 s takes it back,
  caret included. A focus moved on purpose is never undone. In Corsie the selected chat always keeps a full tile.
- **"Domande in finestra"** (setting `questionsModal`, off by default; top bar button, Ctrl+K, Settings,
  `QuestionsWindow.tsx`): every question and permission shows in one window in front, one at a time with the queue
  under it and its context open; tiles and the Regia keep one line, the layer only toasts. It never takes the user's
  text: while they type (a key less than 2 s ago in a field) it waits as a pill; when it shows, it takes the keyboard
  only if no other field has it; then it is not modal (no backdrop, on the half of the screen away from that field,
  a note says Ctrl+J or a click moves the keyboard; then it turns modal, Tab stays inside). When it closes the
  keyboard goes back to the field it came from. While it is in front only Ctrl+K, Ctrl+J and Esc act (nothing hidden
  under it). Esc / "Più tardi" sets the current ones aside; a new request opens it again. Under a dialog it stays
  mounted, hidden (a free answer being typed survives).
- The global layer's cards show no context block: the layer's page can neither read the chat nor open links.
- **Double Enter = "Invia subito"**: with a message queued and the field empty, Enter sends the last queued message now;
  with text in the field, Enter queues it as before.

## Consequences
- The model's habit of asking from its reasoning is not changed, only shown; a skill or prompt rule could ask it to
  write the context as text.
- The e2e suite pins the tile panels instead of the strip; the visual baselines changed (top bar button, context row).
