# ADR 0028 · The Regia as a widget docked bottom-right, always visible

Date: 2026-10-13 · Status: accepted · Supersedes: ADR 0021's floating, movable panel and its top-bar "Regia" button
(tabs, opacity, Pulisci, several Regie and routing stay as in ADR 0021)

## Context
The user, 13/10: "la regia la vorrei collassabile in basso a dx, non che faccia parte del menu ma che sia sempre
visibile in basso a destra". ADR 0021's panel floated anywhere and, closed, lived as a button in the top bar; open at
its default place it covered the first chat column, and moved by hand it could land on a chat's input or its
Esegui/Copia.

## Decision
- **Docked bottom-right, on every place** (chat grid, focus mode, brain pages, settings, the map): `RegiaOverlay.tsx`.
  Collapsed (the default) = a small bar with the Regia mark, the unread replies ("2 nuove": finished assistant
  messages after the last time the panel was open, `regiaSeenAt`; a reply still streaming when it collapses counts once it ends) and an amber badge with the questions, permissions
  and commands that wait in every Regia. Expanded = the same panel as ADR 0021 (tabs, "+", ⋯ menu, opacity), grown in
  place from the corner, resized from its top-left corner; double-click on its bar or on the corner = the default size
  (since 2026-10-13 wide and low, the user: "la finestra della regia la voglio più larga e meno alta": 42% of the width, 480-820 px, and 42% of the height under the top bar, 300-560 px; a size saved under the old default is dropped once, `regiaSizeV`). It never moves.
- **Its room is reserved, never covered** (`lib/regia-dock.ts reserveOf`): expanded, the workspace pads on the right by
  the panel's width; collapsed, at the bottom by the bar's height. The same CSS variables (`--regia-r`, `--regia-b` on
  `.app`) move the map and the free questions window ("Domande in finestra") aside, and the global layer of cards and
  toasts (`main/overlay.ts`) gets them as `OverlayModel.avoid`: left of the panel, above the bar. A size is clamped so
  the chats keep at least 420 px.
- **No top-bar entry.** The "Regia" button left the top bar; `Ctrl+R` and the palette ("Espandi o riduci la Regia",
  "Regia: misura di partenza") remain. Keyboard rules of ADR 0021 unchanged: Ctrl+R expands with the input focused
  and collapses when the keyboard is inside, Esc on an empty input collapses, the keyboard goes back to the bar;
  `app_ui maximize` of a Regia expands it without moving the keyboard.
- **Remembered** (UI prefs, localStorage): expanded or collapsed, the size (`regiaSize`; the old `regiaRect` is
  dropped), the tab, `regiaSeenAt`.
- **Choices made without asking** (the Regia's brief): a full-width bottom strip for the collapsed bar (the only way it
  can never cover the bottom-right tile's input), a full-height right column for the expanded panel (same reason).

## Consequences
- e2e testids: `regia-pill` is now the collapsed bar (only while collapsed), `regia-dock` its container,
  `regia-pill-unread` the unread count; `regia-overlay`, `regia-collapse`, `regia-resize` (top-left now) stay.
- The collapsed bar costs 42 px of height to the workspace; the expanded panel its width plus 8 px.
