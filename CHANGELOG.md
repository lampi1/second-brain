# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com)
and the project uses [Semantic Versioning](https://semver.org) once it reaches 1.0.

## [Unreleased]

### Added
- **MCP servers managed by the app** (ADR 0086, #91): add a server once in Settings → Connettori (a local command or an
  https address), test it ("Prova": works or not, its tools split read/write, a clear error and fix), or import the ones
  already in Claude Code, Claude desktop, Cursor and Codex (read only, no token copied). Every Claude, Codex and Cursor
  chat gets the servers its role may use through the app's MCP gateway, which adds the token (encrypted, write-only)
  and checks the role's access at every call; by default every role has every server, narrowed per server on the agent
  card's new "Server MCP" section (all tools, read only, picked, none); a child never more than its parent.
- **Settings → Connettori redesigned**: accounts and MCP servers as cards in a grid with totals, what each is for, its
  state, one "Prova" and "?" explanations, in dark and light.

### Changed
- **Nine fixed roles and direct delegation** (ADR 0083, #89): Orchestrator, Strategist, Scout, Artisan, Sentinel,
  Herald, Router, Judge and Scribe replace the agent catalog, its Italian presets and the routed profiles; each role's
  tools, permission ceiling, model tier and model are edited in Brain → Agenti, and a role uses only the skills its
  launch gave it. A role delegates to the roles it may launch, only those that fit within its own tools (the
  planners Strategist and Router launch Scout and Judge; changes go back to the Orchestrator), with `agent_delegate`: visible child chats with a
  self-contained contract, never more permissions than the parent, inside its folder, within your limits (Impostazioni
  → Ruoli e deleghe: depth, children at once); each reports once with `agent_report`. No hidden sub-agents: an
  engine's own sub-agent only for a quick read-only search. A child's permission above its parent's is refused and said
  in its chat. Old catalogs are not carried over: export custom agents as packs from the previous stable first.
- **Work starts only from the Orchestrator**: "Nuovo agente" and the role page's launch are gone; Ctrl+N and the
  palette put the cursor in the Orchestrator's input ("Cosa vuoi fare?"), which plans and delegates (cloud agents too).
- **The delegation tree** (the owner's design): in the Grindhouse each delegated chat is a thread card under its parent
  on a curved line tinted by its state (task, character, role, skills, model, time, its steps, a state pill, what it
  needs: a permission to answer, an error, a limit, a nudge); a click expands it in place into the whole chat, "Vai alla
  chat" opens focus mode; the parent's bar counts its children and folds them. The sidebar shows the same tree in two
  lines per chat under the Orchestrator; a click brings the card on screen, expanded. The fold is kept across
  restarts. The steps cost no token: the engine's own plan (Claude TodoWrite, Codex plan, Cursor plan and todos), else
  the contract's criteria, plus the recent tool calls in readable lines ("Letti 42 file in src/payments/").
- **Questions go to the parent first** (`agent_ask_parent` / `agent_answer_child`); only a permission, an irreversible
  or external action, a choice that changes the goal, or what the parent cannot answer reaches you, once: in the chat
  you look at (the child's pause panel in its parent's chat, tagged with who asks) or in the questions window, never a
  second panel in the Orchestrator.
- **The Orchestrator sees state only**, plus your own words: what you write in any work chat reaches it as quiet news
  (no extra turn) and the chat's parent as a note, so nothing conflicts; a child that followed you to a new goal says
  so in its report and its card shows the new goal.
- One "Discuti" button (EN "Discuss") replaces every "Apri chat" / "Apri una chat" entry point: Task records (work
  items, pull requests, test plans and test cases), Idee, Qualità, Costi, Confronto, the charts, Script, Changelog and
  the Dashboard. It puts a ready draft (title, source, link, numbers, folder hint) in the Orchestrator's input, never
  sent by itself, and never creates a work chat: the Orchestrator decides and delegates. A discussed Task record shows
  "Discusso", which leads back to the Orchestrator. The command card's "Apri chat" (an existing chat) is now "Vai alla
  chat".
### Fixed
- The Scribe can write on Claude again: its brain-write class gives Edit and Write, and each edit is refused unless
  the file's real path is inside the brain folder (no "..", no link or hard link out of it).
- **Read-only commands are checked strictly** (#89 review): a role that may only read commands no longer runs
  `sort -o`, `uniq a out`, `git grep -O`, PowerShell `( … )`/`@( … )`/`{ … }` or abbreviated `--output`; a command
  beyond a delegating chat that may only read is refused, one beyond the role but within its parent asks you.
- Security review fixes: a work chat's lessons (agent_learn_propose) apply only to its own agent, never as a rule for
  every agent, and wait until the Orchestrator accepts them with you; agent changes check the Orchestrator inside the
  authoring service; a sub-agent never gets more tools, MCP servers or permissions than its parent and runs in its
  folder or worktrees; an HTML report's CSS can no longer lift the viewer's containment or load anything through an
  unclosed url(; "Aggiorna" refuses to promote local commits GitHub's main does not have; a name, look or category
  change waits for you even when bundled with a behaviour change.
- Brain map (2D, now Mappa → Note del brain): the nodes no longer clump off centre. The layout spreads with the node
  count and is fitted to the panel's own size and aspect (centred, filling it, re-fitted on resize); labels are placed
  at their real size and a minor label with no free spot is hidden instead of overlapping; "Adatta" re-fits the whole
  map (issue #77).
- Local stores retry the rename on a transient Windows lock (EPERM/EACCES/EBUSY) and log a warning instead of an
  error when a retry worked (#71).
### Added
- The Judge reviews a few finished role runs a day on another model (Impostazioni → Ruoli e deleghe, only in the stable
  app); its verdict is the run's reviewed evidence for the improvement loop.
- "N novità in attesa" on the Orchestrator (#88): the news and mail the delivery rule holds back for it (a worker that
  finished while it waits for your answer, a quiet question/permission/command, mail grouped or held) are counted above
  its input; a click lists chat, kind, since when and why it waits; it clears on delivery. No rule changed, no extra
  Orchestrator turn. It replaces the Orchestrator's "Novità" feed (the live feed stays in the bell). A request from a
  chat with no update since the app started is no longer missed by the news to the Orchestrator.
- Cloud agents in the Grindhouse (ADR 0080, #79): Cursor Cloud Agents (REST API: start, list, live messages,
  follow-up, stop, spend in the Cursor budget), Codex cloud tasks (start, list, `codex apply`) and Claude Code cloud
  sessions (start, follow-up, link) as strips with a "cloud" badge, grouped by repository; "Nuovo agente" gets
  "Dove: Locale / Cloud" gated by each engine's readiness; `app_create_chat` takes `where: 'cloud'`; "Porta in locale"
  into a new worktree; the Cursor Cloud Agents key in Settings → Motori → Cursor; fake cloud agents in the demo.
  GitHub repos only; the app never pushes.
- Role characters (#89): every role (Orchestrator, Strategist, Scout, Artisan, Sentinel, Herald, Router, Judge, Scribe)
  and Pulse is drawn as its own cartoon character, hand-written SVG in the app: a badge colour and a silhouette that
  read at 16 px in the tree, a face and a prop from 24 px, in dark and light. Approval sheets:
  `node scripts/agent-avatar-sheets.mjs` → `docs/screenshots/agent-avatars/`.

### Changed
- The brain template ships no hidden sub-agents (issue #89): brain-editor, flow-optimizer, code-investigator and
  reviewer are now the skills `brain-edit` (loaded by Scribe), `flow-review`, `code-investigation` (Scout) and
  `code-review` (Sentinel), with their references and texts updated; an old notebook of a removed specialist is named
  by `playbook.mjs list`, never deleted.
- **The Orchestrator changes agents by itself** (ADR 0082, #84 point 6): `agent_update`, `agent_propose`,
  `agent_rollback`, `agent_archive`, `agent_restore` and a "Contesto massimo" from `agent_learn_propose` apply at once
  (a behavioural change as a trial version), each logged on the Skill page with "Annulla" and in the feed with "Annulla
  modifica". Only an agent's tools, permissions, engine, or a name/look-only change, and new agents, still wait in
  Agenti → Da approvare; a lifecycle suggestion needs one yes instead of two.
- **Regole imparate** is no longer a page of its own: it is the last section of **Regole**, shown only when the brain
  has learned policies; old `miglioramento` links and G R open Regole (ADR 0082, #84).
- Texts describe today's model everywhere (#76): "Regia" is the Orchestrator in the UI, tool descriptions, chat
  instructions, the brain template (the Claude output style is named Orchestrator; the hooks recognise both titles)
  and the docs; routing texts say the table is the default for chats without an agent; the chat menu says an agent's
  lasting model and effort live in its profile; README screenshots renamed `grindhouse.webp` and `orchestrator.webp`;
  the guide's search card describes the hybrid brain search, the runs card the run links.
- **Agents and skills only** (ADR 0077, #84): procedures are gone (page, IPC, API, MCP, docs); every former runbook and
  routine becomes a skill once, linked to the right agents, with a report. A new **Brain** menu section: Agenti,
  Skill (cards with who uses each skill, link toggles), Regole, Memoria (knowledge, what happened, one memory per
  agent, the logged errors), Classificatori (read-only routing table with runs, success and cost per row, history,
  agent suggested vs used, quality by week) and Mappa (agent → skills → rules → memory, plus the brain notes map).
  Maintenance jobs (repeated task → skill, duplicate skills, corrections, duplicate memories) apply changes without
  approval, each logged with "Annulla". Export adds TOOLS.md and the brain's rules, never memory. The Dashboard keeps
  statistics only.
- Agent cards (#81): no "Avvia" or "Dettagli"; a click flips the card in 3D to its details and skills (a fade with
  reduced motion); Esc or a second click turns it back.
- DevOps is now **Task** everywhere (menu, page, settings, IPC, MCP views, alerts): it still imports from Azure
  DevOps automatically when the read is on; saved settings, mutes, role pages and old links move to the new name by
  themselves. The page has the look of Agenti and Guida. **Fatto** is a log: newest first, grouped by day, each entry
  with what, who, when and its link; "Mostra altri giorni" goes further back (ADR 0079).
- Grindhouse strips: a click expands an agent every time again (text selected elsewhere, such as an Orchestrator
  answer, swallowed every strip click, #78); the globe shows the chat's browser from a collapsed strip too (#74).
- Sub-agent strips name the app agent they run as, or "nessun agente"; a parent whose turn ended reads "in attesa"
  while a sub-agent still works, "finito" only once none does (#69).
- Agent cards and the Orchestrator's head no longer show a per-chat effort ("Attivo: …", "Prossimo turno: …"): the
  agent's profile decides it and shows it (#75).
- Question panels: the question and its context use the app's type scale (the questions window's question 16 px
  instead of 22 px, the context 14 px; the tile's lead and context 13 px).
- Agent first (ADR 0078, #70): the chosen agent's profile decides engine, model and effort; the routing table only
  fills a missing model (no more "override senza motivo"); without an agent the classifier picks one above its
  threshold, else Generale; workers start catalog sub-agents with `agent_start_subagent`; legacy imported profiles get
  a real "quando usarlo" and short instructions.
- Routing learns from the app (#72): an agent run's verdict is a known outcome in the ledger, and a row's reason shows
  today's counts ("16 chat, 10 con esito, 70% riuscite").
- The Orchestrator can create a missing agent after the user approves it in a panel; a refused `agent_create` no
  longer uses up the approval, and its description lists the valid category, avatar and preset values (#73).
- Agent editor: "Contesto massimo" per agent, versioned, applied on Claude engines, proposable with `agent_update` /
  `agent_learn_propose` (#80).

- Classifiers: a bilingual (IT/EN) work lexicon for agent matching and the routing kind (a fresh brain no longer
  routes everything as "altro"); per-channel agent thresholds; a threshold calibrated on confirmed runs is proposed
  in "Da approvare" and applies only on the user's click (ADR 0074). The Guida card explains each classifier.
- CLI login readiness selects available engines for new chats and untouched starter agents. Codex is available on
  fresh installs without extra engine switches; explicit disabled settings remain disabled.
- App-area chats support every enabled engine. Codex and Cursor pre-approve the same app-control and mail tools as
  Claude, without extending approval to browser actions or unrelated MCP servers.
- The Grindhouse (home, Ctrl+1) is the one place for the agents: a strip each, in the Orchestrator's order, the
  browser it drives right under it; the Chat page and its Mosaico and Corsie views are retired, old links still work
  (ADR 0068). One Orchestrator column stays open beside every page.
- Top bar: the full-screen popups switch and the connectors (GitHub, Jira) with their status are one click away; the
  "Nuova chat" button is gone (Nuovo agente in the Grindhouse, Ctrl+N or Ctrl+K start one).
- Pages fade in on every change and progress bars move smoothly, both off under reduced motion.

### Removed
- The "Nascondi browser" switch (top bar "…", Ctrl+Shift+B): it hid the browser a strip's globe had just opened
  (#82, the cause of #74). A saved "on" is dropped at start; a strip's globe folds and shows its own browsers.
- "Migliora l'app" ("Personalizza l'app"): its page, menu entry, chat preset, `/mcp/improve` and texts are gone.
  Updating stays in Settings → Aggiornamenti («Aggiorna», ADR 0075) and through the Orchestrator (ADR 0074);
  `npm run promote` and `npm run rollback` are unchanged (ADR 0079).

### Added
- Grindhouse: a worker that sent its final report to the Orchestrator (send_to_chat or a run-report block) and is
  idle gets its assignment completed and its agent run ended "completed", then closes by itself after the delay set in
  Settings (now also 2 minutes), with closedBy "auto". One waiting for the user, a permission, colleagues or background
  tasks stays open with an "In attesa di…" label; an open browser tab alone no longer holds it (ADR 0084).
- Agent screenshots everywhere (issue #83, ADR 0081): the file viewer renders HTML reports (sanitized, in their own
  shadow root, no scripts or external loads) and Markdown reports with their images (base64 or local files under the
  allowed folders), a click opens one large; chat messages show bare image paths, links to images and path-only code
  spans as thumbnails; the chat MCP instructions, show_ui and the browser's screenshot tool say how to attach one (a
  path). HTML and Markdown reports come whole up to 32 MB, so embedded screenshots are never cut.
- Settings → Aggiornamenti: what is new on GitHub, and an "Aggiorna" button that downloads it, rebuilds and restarts
  the app on it at once, without the test suite (ADR 0075).
- "Aggiornati": ask the Orchestrator and it brings a developer's clone to the latest `main` from GitHub
  (fast-forward only, dependencies reinstalled only when the lockfile changed, then a build); `npm run pull` does the
  same from a terminal (ADR 0074).
- `npm run release:draft -- v<version>` makes the verified draft release from the maintainer's Windows PC, with
  GitHub Actions off (ADR 0074). The README lists every version with its installer and source downloads.
- Texts for colleagues (blocks tagged md, mail, teams, comment) show formatted in the chat, and Copia copies them
  formatted: bold, lists and links survive a paste into Outlook, Teams or DevOps (ADR 0043).

## [0.1.0] - 2026-10-13

First public version.

### Known limitations
- Codex cost and budget reporting is unavailable; Cursor agent-run costs and budget coverage remain incomplete.
- Codex receives brain instructions and skills, but the brain's lifecycle hooks are not installed for Codex.

### Added
- Developer experience: `npm run demo` (the whole UI on fictional data with a sample brain),
  `npm run shots` (README screenshots from the frozen demo), README, CONTRIBUTING, issue and pull request templates.
- Claude Code (stream-json) and Cursor (ACP) chats as tiles, with streaming text, tool calls, diffs, cost and context
  size; Mosaico and Corsie views.
- Questions and permissions as panels with their context, in the tile or in a floating layer; one or more Regie
  (coordinating chats) in a widget docked bottom-right; mail between chats.
- Internal browser tabs driven by agents over a local MCP server, with trusted input, environments, persistent logins
  and hand-offs to the user.
- The brain: pages (today, to-do, ideas, explore), a live 3D map, costs, budgets, estimates and the Qualità metrics.
- DevOps page: pull requests, reviews, work items, QA status of each pull request, alerts.
- "Esegui" for shell blocks, long-chat hand-offs, model routing, full-text search (Ctrl+K).
- "Migliora l'app": the app's own Regia works on branches; promotion to a stable release and rollback.
- App-control MCP server for agents (state, screenshots, driving the UI).
