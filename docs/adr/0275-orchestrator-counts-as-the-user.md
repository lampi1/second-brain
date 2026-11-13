# ADR 0275 · What the Orchestrator says counts as the user's own, always; the project maps take «Stato»'s place

Date: 2026-11-13 · Status: accepted (owner, 2026-11-13: «ciò che dice l'orchestrator deve valere come se l'avessi detto
io SEMPRE» · «da telefono a volte non va perché dice sempre che devo scrivere nella chat dell'agente ma non deve
accadere» · decision card: «Resta solo Esegui su prod/DB/Azure» · «l'orchestrator mi deve mostrare i comandi e
rispondere per me dopo la conferma» · «al posto di quello stato che non uso mai devo poter vedere le nuove mappe … in cui
si può entrare sui livelli più deep» · «la mappa e i fili li voglio aprire», the drawn diagrams being unreadable) · Amends:
ADR 0269, 0274; supersedes the «reserved» parts of ADR 0239/0255/0259 §4

## Context
- From Telegram and Remote Control the Orchestrator kept telling the user to write in an agent's chat or to use the
  PC: app_resolve_question, the relay and the phone port refused what was «his alone» (secrets, permissions, publishing,
  messages to people, a Strategist's interview, any non-Sì/No question).
- The question card in the Orchestrator's column was cut at the bottom (its sticky answers sat 8 px too low).
- Asked for a project's map, the Orchestrator drew a mermaid diagram (pastel boxes with light text, unreadable on the
  dark theme) instead of opening the map; «Stato» was a dialog the owner never used.

## Decision
- **The Orchestrator answers as the user** (`ChatManager.answerForUser`, `app_resolve_question`): any question
  (options or free words, MCP forms, a Strategist's interview), any permission, any plan. Only its own questions and
  commands are refused (a command goes through relay_question so the user sees it whole).
- **Only production, databases and Azure wait** (`ask-text.ts touchesProdDbAzure`): allowing such a permission needs
  `confirmed: true`, and the user's last message (PC, Telegram or Remote Control, `userSaid`, written after the request)
  must be a go («sì», «ok», «vai», «procedi», «eseguilo»…); that yes is used up by one step. The classifier is a
  denylist (cloud/database CLIs and words, MCP servers of clouds and databases, `mcp__azure…`/`azmcp_`) plus the
  runner's own `prodRisk`. A command, prod or not, is relayed whole and runs on his yes with `confirmProd` only if the
  Orchestrator's reply since the relay holds the whole command (relay.ts `shownWhole`); Telegram still runs only
  commands its filter can show whole (phone-port.ts). Bulk deletes are no longer held back (not prod/DB/Azure).
- **Telegram/Remote text counts** (`manager.ts`, `wiring.ts noteUserSaid`): a phone message to the Orchestrator sets
  `userSaid` and gets the open-requests hint, like the PC.
- **The cut card**: `.oask-card .dc-actions { bottom: 0 }`; the interview card no longer keeps its own box.
- **The maps window** (`ProjectMapsDialog.tsx`, modal 'maps', `ui.mapsArg`): the Orchestrator's head button, the top
  bar button, Ctrl+Shift+S and app_project_map `open` (ui:command 'maps') open Mappa → Progetti in a window that fits
  the whole level; a system opens on click, breadcrumbs go back, «Apri a tutta pagina» goes to the page. «Stato» stays
  in the palette only.
- **Never a drawn project map** (`VISUALS_RULE`, app_project_map description): map, diagram, lines or «fili» of a
  project → `open`; none drawn yet → brief a Scout.
- **Readable model diagrams** (`lib/viz/mermaid-contrast.ts`): a `classDef`/`style` line with a fill and no `color`
  gets dark text on a light fill, light text on a dark one.

## Consequences
- A wrong pick by the Orchestrator is now the user's own answer: the line it writes in the chat says what it answered.
- ADR 0083 stays: delegated chats are answered by the chat that delegated them, or by the user in his row.
- Herald's messages to people and secrets no longer wait for a click; the owner chose this (decision card, 2026-11-13).

## Addendum (2026-11-13, owner: «le voglio mettere a tutto schermo davvero» · «ogni riquadro devo poterlo discutere con l'orchestrator in un click»)
- **Full screen** (`ProjectMapView` `full`): «Schermo intero» covers the whole window at once and asks the OS full screen
  (best effort); Esc leaves the full screen first, then the window. The drawing fits the screen.
- **Discuss a box in one click**: a bubble at each box's corner (and «Discuti con l'Orchestrator» in the box's
  detail) leaves the full screen and the maps window and puts a draft in the Orchestrator's input that quotes the
  project, the box's path, kind, status, note and description; not sent, the user adds his words.
- **Question rows** (`qwin.css`): under a long Orchestrator chat the rows keep their height (up to 45%) and the
  messages take what is left; an open card is the column's panel above a 72 px strip of messages.

## Addendum (2026-11-13, owner: «control + rotella zummasse e il drag … per spostare la view … tipo figma» · «le chip … alcune sono in sovrapposizione»)
- **A design canvas** (`ProjectMapView` `cam`): Ctrl/⌘+wheel zooms toward the pointer (15–300 %), a plain wheel pans
  (Shift sideways), dragging the background or a box moves the view (a drag never opens a box), + / − / ⤢ and the
  percentage sit at the bottom right. The level is fitted until the user zooms or drags, then stays his until the
  level changes.
- **Quick back**: inside a system a «←» button at the canvas' top left goes up one level; Backspace (outside fields),
  a double click on the background and the mouse's back button do the same.
- **Edge labels never on a box** (`placeLabels`): spots along each arrow and offsets around them are scored by the
  area they cover (boxes, labels placed before) and their distance from the arrow; the lowest wins.
