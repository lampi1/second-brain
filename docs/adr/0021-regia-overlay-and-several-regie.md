# ADR 0021 · The Regia as a floating overlay; several Regie in tabs; "Pulisci"

Date: 2026-10-12 (written as 0016, renumbered at the merge with 0016-0020) · Status: accepted; place and top-bar button superseded by ADR 0028, "Domande alla Regia" removed by ADR 0035 · Supersedes: the fixed
Regia column of ADR 0005 and the "one Regia" rule for work Regie

## Context
The user, 12/10 evening: "la regia la vorrei sempre avere fissa in overlay espandibile, quindi anche la finestra delle
chat avrà più spazio. voglio poter scegliere l'opacità della regia anche e che sia disponibile il clear. e una tab che
mi switchi tra regia di lavoro o regia del miglioramento app o comunque la possibilità di creare nuove regie se ha
senso". Until now the Regia was a fixed tile in a left column (with a splitter) on the chat grid, a docked panel on
pages and in focus mode, and only one chat could hold the Regia role. On the draft he chose: overlay free to move
("la sposto io"), "Pulisci" = a new Regia with the old one archived, tabs + "crea nuove", the App Regia working in
the second-brain-app folder.

## Decision
- **Overlay.** The Regia is no longer a grid tile nor a dock: one floating panel (`RegiaOverlay.tsx`) over the
  workspace, the same on the chat grid, pages, focus mode and the map; the chats get the whole width. Open = the
  panel at its remembered place and size (dragged by its tab bar, resized by its corner; double-click on the bar puts
  it back); closed = the "Regia" button in the top bar, with the Regie's state and open questions, so nothing is
  covered. Closed is the default (the user, 12/10 night: "Ridotto, si espande", the button "Nella barra in alto"): a
  panel open at its default place covered the first chat column, the pages' back button and the first "ti aspetta"
  cards. `Ctrl+R` opens/closes it (the keyboard goes back to the button), `Esc` closes it when its input is empty; the
  palette has "Regia: rimetti al suo posto". Place, size and open/closed are UI prefs (localStorage).
- **Opacity.** Setting `regiaOpacity` (40-100 %, default 100), also in the overlay's ⋯ menu; the panel is fully
  opaque while the pointer is over it or the focus is inside. A browser tab is a native view drawn above the page: a
  browser tile the open panel covers hides until the panel moves or closes (the overlay registers like any popover,
  `lib/viewports.ts`), shown as its frozen thumbnail.
- **The "App" tab is the app's own Regia (ADR 0020).** "Migliora l'app" already has one Regia for the app's code
  (`appRegia`, space `app`, `/mcp/improve`): the overlay shows it as the tab "App" while it is open, after the work
  Regie (`regiaTabsOf`). There is no second "App" concept: the demo has no seeded App Regia, the section still makes
  it ("Crea con Claude/Cursor"), and its chats stay in their section. Its menu has Pulisci (a new app Regia through
  the section, the old one renamed and archived) and the opacity; Ricomincia, Cambia motore, "Domande alla Regia" and
  Chiudi are the work Regie's.
- **Several work Regie.** Any number of chats may have `isRegia`; each has a tab label `regiaName` (the Regia from before
  this ADR has none and shows "Lavoro"). Its title stays its mail address: the first Regia keeps "Regia", so every
  existing rule "scrivi alla Regia" still reaches it; a new one is titled "Regia · <name>". A new Regia never takes
  the role from another one; only `replaces` (Ricomincia da capo, Cambia motore, Pulisci) moves a role, and the work
  chats of the old one follow the new one.
- **Which Regia a chat answers.** A work chat has `regiaOf` = the Regia that opened it (`app_create_chat`) or the tab
  open when the user created it. `regiaOfChat` (shared) resolves it; a missing or no-longer-Regia id falls back to
  the first Regia. That Regia gets the chat's questions and permissions ("Domande alla Regia"), its tab shows them in
  its badge, and `app_create_chat` tells the chat its Regia's title for `send_to_chat`.
- **The caller of /mcp/app.** Each Regia gets its own endpoint `/mcp/app/r/:chatId/:token` (an unguessable token
  kept in memory and in that Regia's own MCP config, as the per-chat browser endpoints of ADR 0003; else 404), so its
  tools know who calls: chats it creates answer to it, its messages are signed with its title, and its engine decides
  the Claude <-> Cursor rule. The token keeps a local process from picking another Regia's engine. `/mcp/app` stays
  for test agents and acts as the first Regia, as before.
- **Pulisci.** A ⋯ menu item with a confirm: a new Regia on the same engine, folder and name, started empty (it reads
  its memory, `now.md`, by itself); the old one is renamed as in "Ricomincia da capo" and closed (archived), to read
  among the Chiuse or reopen.
- **Tab order.** By `regiaSince`, which a Regia created with `replaces` inherits: Pulisci, Ricomincia and Cambia
  motore never move a tab nor change which Regia is the first (the one chats without `regiaOf` answer to).
- **Closing.** A Regia closes only by the user's hand, never the first one (its title "Regia" is the address the
  brain's rules write to, and `/mcp/app` acts as it): to start it over, Pulisci. Its work chats go to the first Regia.
- **"Eventi alla Regia" (ADR 0017).** The news of every work chat go to the first Regia in tab order (`regieOf`), so
  Pulisci on "Lavoro" never sends them to another tab; per-Regia news (each chat to its `regiaOf`) is a follow-up.
- **Choices made without asking** (the user asleep, 12-13/10 night: "basta domande, finisci tutto"): closed by
  default with the button in the top bar (his panel answer), the App tab = the ADR 0020 Regia (the integrator's rule),
  news to the first Regia, the App Regia's short menu. Each can be changed by the user.

## Consequences
- ADR 0005's "Regia tile: fixed position (left)" and the Mosaico "grid of Regia + chat tiles" no longer hold.
- e2e testids: the overlay keeps `tile-regia` / `regia-input`; `regia-dock*` and `splitter-regia` are gone.
- Several Regie spend tokens each only when the user writes to them; none starts by itself.
