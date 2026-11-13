# ADR 0102 · The app shows what it does by itself

Date: 2026-10-20 · Status: accepted (owner, 2026-10-20) · Amends: ADR 0022 (the bell counts the away events), ADR 0070
(the Battito's board, one Dashboard line a day), ADR 0083 (the Origin line of the app's own chats)

## Context
The owner: «l'app deve essere viva, non aspettare il prompt». An audit of every background mechanism (the Battito,
the brain maintenance, the role loop, the Judge's sampled reviews, the live feed, Task, the cloud agents) found most of
the machinery already there, at zero tokens, and almost all of it invisible: the Battito spent for 'board' cards no
page drew, with no switch outside the schema and a Dashboard line every hour; the maintenance changed skills every six
hours without a word (the feed kinds `agent-updated` and `agent-proposal` were declared and never published); what
changed while the app was closed (away events) never counted as unread; a collapsed strip said only "sta lavorando…";
a Judge review appeared as a strip from nowhere; and every morning an experienced user met the first-run text in an
empty Grindhouse. Nothing outside the window said that a chat waited.

## Decision
Show what exists; add no model call where code can do it. Everything below is zero tokens unless stated.
- **Strips say what they do.** A collapsed strip shows its current step read from the transcript (`lib/run-steps.ts`:
  the command running, the plan item in progress, the last action), "passo 3/7" when the engine keeps a plan, and the
  silence from the last item ("da 6 min" on a running tool, "ferma da 6 min" otherwise), amber past the delegation
  stall threshold (`stallMin`). Root chats too (`lib/strip-status.ts`, `StripActivity.tsx`).
- **Origin.** A root chat the app started ("Avviata dall'app · revisione a campione (2 di 3 oggi)", with a link to the
  settings) or resumed after a restart ("Ripresa dall'app dopo il riavvio · 09:12") says so above its strip, like the
  Orchestrator's own (`lib/chat-origin.ts`).
- **Maintenance and proposals in the feed.** A maintenance pass the app ran by itself (timers, a new lesson; not the
  button) that changed something is one quiet `agent-updated` with Annulla over its changes (new `FeedAction`
  `brain-undo`: `brainmodel:rollback` each, newest first, at most 20); the daily role pass adding entries to "Da
  approvare" is one normal `agent-proposal` leading there (`brain/announce.ts`). Never a toast.
- **"Mentre eri via" counts.** Away events are unread until read and count in the bell; still never a toast, never a
  section badge.
- **The morning block.** At the first presence of the day or after 4 h away (the renderer reports presence at most
  once a minute: start, click, key, focus), the app draws a block from what it holds: runs finished since then with
  their outcome, requests and "Da approvare" waiting, the user's PRs with a red build or waiting for a vote (the Task
  page's last read), ideas due, cloud agents finished, the maintenance changes (with Annulla), yesterday's spend (the
  brain's cost report, else the runs), a stalled chat. Each row opens its place; "Parliamone" prepares a draft for the
  Orchestrator and never sends it; Esc / Ok hides it for the day. In the empty Grindhouse it is the block (with the
  Battito's board under it); with strips open, one line atop the Orchestrator column that unfolds. A user with no run
  and no work chat keeps the first-run text; one with history, after Ok, gets a calm idle line. One channel,
  `morning:brief` (presence / get / dismiss), `main/morning/`; state in `userData/morning.json`. Off in the test suites
  unless `SB_MORNING=1`.
- **Ctrl+J never ends in the void.** With nothing pending it opens the block's first priority: a red build on a PR →
  an approval → a stalled chat → an idea due; only then "Niente ti aspetta adesso".
- **The Battito, seen or steered.** At most three board cards in the empty Grindhouse and in Dashboard → Spunti; the
  cards prompt asks for an optional `action` on promemoria / idea cards ("Fallo" hands it to the Orchestrator); its
  proposals (`approvals:list`) join "Da approvare" as their own card; its switch, times and daily budget, with today's
  spend, sit in Settings → Notifiche. The Dashboard line rides in the day's first cards call (no hourly job: at most
  one line a day, inside the same budget; tokens: fewer). The legacy `headlineOn` / `headlineModel` / `headlineEffort`
  settings are removed; their opt-out still migrates to `pulse.headline.on`. The dead `home-cards.ts` is removed.
- **Presence outside the window.** On Windows the taskbar button carries an overlay badge with the number of requests
  waiting and an indeterminate progress bar while an agent works (`main/taskbar.ts`). Never `flashFrame`, never focus;
  a no-op under `SB_HIDDEN` and outside Windows.

## Consequences
- The calm UI holds: nothing new interrupts (no toast, no sound, no focus); the block appears once a day and leaves
  with one key; the strips' line replaces a word, it adds no row.
- The Battito's budget is unchanged and now buys something visible; one model call a day fewer or more is the line's.
- A stall on a root chat is now visible to the user, not only to a parent agent asking `agent_children`.
- `morning:brief` reads the brain's data server for ideas (cached 5 min) and the cost report (once a day): without a
  brain those rows are simply absent.
- Tests: `test/unit/strip-status`, `chat-origin`, `notify`, `brain/announce`, `brainmodel/service`, `agents/role-loop`,
  `morning/*`, `pulse/service`, `agent-approvals`, `pulse-settings`, `taskbar`; e2e `test/e2e/alive.spec.ts` (runs on
  main with the full suite).
