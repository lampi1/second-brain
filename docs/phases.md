# Version 1 and backlog

Scope agreed with the user on 2026-10-11 ("sì ok facciamo così"): **v1 has a fixed border**. Everything else goes to the
backlog below and is decided after one week of real use, looking at the app's own data. Every new request goes to the
backlog unless the user says it is for v1. A v1 item is "done" only when it is proven by an e2e test or a live check AND
a screenshot that was looked at, `npm run check` is green, and the fresh-context reviewers found no blocking issue.

## v1 · the cockpit (monolith, two engines: ADR 0010)
- [ ] Two engines: **Claude embedded** (official binary, the user's claude.ai login) and **Cursor CLI** over ACP — "sarà proprio con quella che la proverò all'inizio": Cursor must work first and well.
- [ ] "sempre un box orchestrator disponibile": fixed violet Orchestrator tile, on Claude or on Cursor, default focus.
- [ ] "tutte le chat come tanti quadratini in cui posso scrivere dentro ognuno senza premere": chat tiles with an always-active input, Mosaico and Corsie views ("selezionare la preferenza").
- [ ] "fermare tutto come se fosse claude desktop, il nome del modello": ■ per chat, ■ Ferma tutto, model (and effort for Claude) visible and changeable.
- [ ] "un pannellino di domande a risposta multipla" + "mi compaiano ovunque io stia navigando nell'app": questions and permissions as panels in the tile, in "Ti aspettano" and in the global question layer; 1-9 / Enter / Esc.
- [ ] "le chat mostrano i costi … la stima": real cost per chat (Claude), honest estimate or "stima senza dati", estimate vs actual.
- [ ] "vedrò aggiornarsi in automatico tutto quanto … notifiche": live brain feed + calm notifications.
- [ ] "lavorare all'app direttamente dall'app": stable release + dev instance, promotion only with green tests, rollback, chats cannot kill or modify the stable instance (ADR 0007).
- [ ] "loggarmi nelle loro cli": login state shown; the official login opens in a visible terminal; credentials never handled.
- [ ] "renderlo navigabile il mio cervello e la mappa 3d … in questo bello stile professionale": brain pages (oggi/da fare/standup, idee e spunti e riflessioni dell'IA, costi, qualità, esplora) and the 3D map (essential view, full screen from its own button, menu, weak points, flows) inside the app in its style, reusing the v2 site code (moved into v1 by the user, 2026-10-11).
- [ ] "vorrei lavorare navigando al meglio possibile": three notification tiers (questions = global layer; important events = short grouped toast with one action; the rest = notification center + badges), a notification center openable anywhere (filter, mark read, each item goes to the exact element), badges per section, sidebar always visible and collapsible, Ctrl+K go anywhere, Alt+←/→ history, Ctrl+1 back to the grid, the Orchestrator reachable from any page, copyable internal links, mute per kind, timed do-not-disturb, never sounds.
- [ ] "anche l'app abbia tutte le sezioni che aveva il sito. fatte meglio da app enterprise" (2026-10-11): every v2 site section exists in the app, in the app style (filterable/sortable tables, exports, a short explanation on top, calm density), each proven by an e2e test + screenshot:
  - [ ] Oggi (home): today's costs, what was done, what waits for you, AI insights
  - [ ] Adesso: live chats with their state, mailbox, now.md line, message box
  - [ ] ~~Fatto e standup: done items with DevOps links (PRs, work items), stand-up sentences~~ (removed 2026-10-29, ADR 0181)
  - [ ] ~~Da fare: brief, open threads (now.md), due ideas, decisions waiting~~ (dropped 2026-10-13, ADR 0041)
  - [ ] Idee: ideas with filters (area, state, who), due dates; "Dall'IA" (once "Spunti dell'IA"): the AI's ideas and reflections (Notato / Penso / Sicurezza / Non so)
  - [ ] Costi: charts by day / model / chat, savings, the estimate ledger
  - [ ] Qualità: AI errors, praise, specialist notebooks, proposals, measures, bugs, recurrence
  - [ ] ~~Collaborazione: mail between chats, environment leases~~ (dropped 2026-10-13: Procedure took its place, ADR 0041)
  - [ ] ~~Confronto: the model comparison reports~~ (removed 2026-10-30, ADR 0201)
  - [ ] Esplora: every brain file, search, preview
  - [ ] Mappa 3D: essential view, full screen from its own button, menu, weak points, flows
- [ ] AI-driven: `npm run check`, `npm run doctor`, logs, app-control MCP (ADR 0006).

## Backlog (ordered; decided after a week of use)
0. Any engine (ADR 0011): Codex CLI adapter; generic API adapter (OpenAI/Anthropic-compatible: URL, key in the Windows-protected store, model) with an "Aggiungi motore" screen in 3 fields; classifier engines (e.g. Jev) for small repeated jobs with fallback and an accuracy check on the user's data; then Gemini CLI, OpenCode and other CLIs.
1. Browser tiles in the workspace and per-environment isolated sessions, saved logins, session status ("browser multipli isolati e sessioni salvate"; the MCP browser module already exists and its password guard stays).
2. Cursor cost from the usage CSV (exact days + per-model factor) and the `stop` hook token path.
3. Live changes with change log and undo page (ADR 0008; settings-as-data already in place).
4. Advanced spending limits ("ask" mode to stop/continue).
5. Model comparison configurable from the UI (reusing the brain folder's harness/compare).
6. Engines settings page; local models (Ollama, LM Studio, OpenAI-compatible localhost) as engines; other providers' APIs.
7. Guided first run under 5 minutes (with the brain-side chat that maintains the product).
9. Colleagues: empty brain template, installer, release check (with the brain-side chat).
10. Team platform (VISION.md): DevOps tickets/PRs/builds as links, live chat between colleagues, adding a to-do for a colleague.
11. Fold the brain data server into the main process (one process less).
12. "le chat di claude potessero parlare con quelle di cursor e viceversa però disattivabile": setting "Messaggi tra Claude e Cursor" (default on) in a brain config file read by inbox.mjs too; sender/receiver harness recorded in the mailbox; cross-harness send refused when off + "messaggio bloccato" notification; same-harness always passes (touches the brain folder's inbox.mjs: coordinate with the brain-side chat, reviewer).
