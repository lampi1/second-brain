# second-brain UI redesign: Brother's decisions (2026-10-17, grill session)

Repo: lampi1/second-brain (private). Brother tried the installed v0.1.0 (689ea08) and said the UI is "completely off":
home has no animation, dropdowns look like plain HTML, the Regia sits at the top instead of the right, agent cards
"look like Windows 98". Release v0.1.0 is ON HOLD until he approves the new UI.

## Decisions (verbatim intent)
1. **Style**: dark, Linear/Raycast-like. "Standard, super clean and minimal, but with impact."
2. **Animations**: cards/rows that react (hover lift, staggered entry, glow while an agent works); animated agent
   status (pulse while thinking, smooth progress); page transitions (panels slide/fade, no hard cuts). Respect
   `prefers-reduced-motion`.
3. **Regia = the single chat with the app** (create agents and skills, talk about errors, costs, etc.). It is the
   main thing of the home. **Always docked in a fixed right column, always open**, width resizable by dragging. On
   home it is wide; on other pages it narrows but stays there. Never at the top.
4. **Agents**: compact rows like Linear (icon/engine, title, animated status, last line), not big cards. Left side
   of the home, plus an "Aspetta te" group (questions, permissions, commands waiting for Brother).
5. **Dropdowns, selects, menus, buttons**: Linear-style custom components: dark, soft, icons, short animation,
   keyboard accessible. No native-looking `<select>`.
6. **Window**: maximized by default (not true fullscreen; taskbar stays visible).
7. **"Le mie tabelle"**: remove completely, code included (routes, components, IPC, stores, strings, tests, docs).
   No dead code left behind.

## Update 18:14 (Brother)
8. **Rename "Regia" to "Orchestrator"** everywhere in the UI (labels, titles, empty states, IT and EN strings).
9. **Agent rows**: thin strips, **collapsed by default**. Collapsed they show the useful info: agent name, model,
   context size (plus the animated status). Click to expand inline: the expanded strip shows the conversation and
   an input to write to that agent. Replaces point 4's "last line" layout.
10. **No drag**: remove drag-and-drop of agents/cards completely, code included (handlers, libraries if unused,
    persisted order, tests). The Orchestrator decides grouping and order: agents appear grouped in a sensible
    order set by the Orchestrator (e.g. by task/area), not by the user dragging.
11. **Agent strips stacked vertically**, one under the other in a single column (no grid, no side-by-side).

## Update 18:20 (Brother): "must be a real WOW effect"
12. **New "Dashboard" page** (own nav entry; home stays agents + Orchestrator). Navigable tabs, for example:
    - **Agents map**: live graph, the Orchestrator at the center and the agents as nodes; edges light up when
      messages flow between chats. Animated and smooth.
    - **Brain map**: navigable Obsidian-style graph of the brain notes and their links.
    - **Costs**: today and this week, per engine/model and **per agent**, charts that update live.
    - **Tokens & context**: tokens used, context per chat, chats about to fill up.
    - **Errors**: AI errors logged (ai-errors.md), app errors, trends.
    - **Tips**: actionable insights computed from the data (e.g. "chat X is near its context limit", "agent Y
      costs the most").
    Every insight, chart and tip has a **"Discuss" button** ("Discutine") that opens the Orchestrator chat on
    the right with that item as context, so Brother can talk about it.
    Same dark Linear style, animated numbers, staggered entry, smooth tab transitions.

## Update 18:21 (Brother)
13. **Agent strip**: also shows the agent's **round icon/avatar** (circle, engine/agent identity) at the left.
14. **Navigation menu always expanded**: no collapsed/icon-only sidebar and no collapse toggle (remove its code).
15. **Settings simple and essential**: cut the Settings page down to what matters. The chat doing it first sends
    the Regia the list of the settings to keep/remove; Brother approves before removal.

## Update 18:25 (Brother: "start it now")
16. **Unified Orchestrator backend**: today the app Regia (improve:regia, app-space tools, needs the source repo)
    and the work Regia (coordinates the normal agents) are separate. Make ONE Orchestrator chat that can do both:
    create/coordinate work agents, create skills, talk about costs, errors and the app itself. Owner: chat
    "UI · Orchestrator unificato" (ui-orch). The UI column (ui-astra) stays engine-agnostic and plugs into it.

## Update 19:05 (Brother): "completely agent driven, modern standards"
17. **Real agent management in the home**. An agent is a **persistent definition** (name, role, instructions,
    model/engine, effort, tools, permissions, avatar), saved and reused; work chats are runs of an agent. The home
    manages them: catalog, create, edit, duplicate, archive, start a run, see its runs (the strips).
    - **Quality presets from day one**: Development (implementer, reviewer, bug investigator, browser tester), Ops and
      production (logs, incidents, runbooks; propose-only, never write to production), Personal work (research,
      writing, mail and journal, day planning).
    - **The Orchestrator also generates presets** from how Brother works (journal, chats, errors, costs).
    - **Autonomy: the app creates agents by itself** when it needs them, and tells Brother afterwards (feed entry with
      the reason; he can edit or archive). Hard limits stay: an app-created agent never gets more permissions than
      the existing gates allow, never writes to production, never answers questions/permissions on Brother's behalf.
    - **Icons (19:08)**: every agent is created with its own icon (shown in the round avatar of the strip and in the
      catalog); presets ship with icons, the Orchestrator picks one when it creates an agent.
    - **Feedback to agents (19:08)**: the Orchestrator gives the feedback. After a run it evaluates the agent's work
      (result vs goal, errors, reviewer findings, cost, Brother's corrections), writes feedback to the agent, and
      improves its definition (instructions/model/effort) as a new version, logged in the feed with the reason.
      Brother can see the feedback history per agent.
    - **Measurable performance (19:09)**: every agent has measurable metrics of output and effectiveness, per
      version, e.g. success rate of runs, reviewer findings per run, Brother's corrections (ai-errors), rework/reopened
      runs, cost and tokens per run, time to done, questions asked. Shown on the agent (catalog + Dashboard per-agent)
      and used by the Orchestrator to judge versions (keep a change only if the metrics improve).

**19:25 (Brother): point 17 ships INSIDE v0.1.0** (design: AGENTS-DESIGN.md, PRs A1..A10, owner ui-agents).

**19:35 (Brother) corrections to point 17** (they override the lines above):
- **Grindhouse shows ONLY the agents at work** (the running strips). No catalog, no create/edit there.
- **Catalog, editing and versions live elsewhere**: a separate "Agenti" page (own nav entry).
- **Creation is a skill run by the Orchestrator WHEN BROTHER ASKS** (e.g. "creami un agente che..."). This replaces
  "the app creates agents by itself": no unprompted creation. The Orchestrator may still propose new agents or
  improvements, but creates only on Brother's request. (Feedback and trial versions of existing agents: unchanged.)
- **Icons must look great**: a coherent, high-quality icon set (one style, crisp at small sizes, distinct per
  role), not generic glyphs or emoji. Presets ship with designed icons; the creation skill picks/creates one in the
  same style.
- **20:04 Brother: agents call agents, shown as nested strips (inside v0.1.0).** (a) Agent→agent delegation goes
  through the app (`agent_spawn` tool in A7): the child is a real app chat/strip with its own agent version, metrics
  and feedback, linked to its parent; children close with the parent; max depth 2, a per-agent child cap. (b) Engine-
  internal subagents (Claude `agent_id` events, claude.ts:670; Cursor ACP Task calls, acp.ts:300/953; Codex
  collabAgentToolCall/subAgentActivity, codex-children.ts) stay internal (cheap) but appear as read-only indented
  child strips (status, duration, task) under their chat. Grindhouse strips render as a tree (A9).
  20:05: real agent strips (incl. app-spawned children) expand into the full chat; internal-subagent strips are NOT
  expandable or clickable (status + duration only, no detail card).

## Update 19:10 (Brother)
18. **Home headline: a real comedy bomb** (19:12: "deve far spaccare dalle risate"). Absurd, hilarious, slightly
    macabre, built on real material: the day, now.md/journal, and **past chats** (funny failures, AI errors Brother
    corrected, absurd costs, stuck agents, recurring bugs). **Refreshed about once an hour** (and at app start if
    older than an hour). Quality first: a model that is genuinely good at humor (not the cheapest), fed a compact
    digest of recent events (titles, last lines, ai-errors, costs; never secrets), generating a few candidates and
    picking the best; hard token cap; cost shown in Costs. Avoid repeats (keep the last lines). Offline/failure → keep
    the previous line or a built-in list. Never blocks the home render.
    Follow-up PR after ui-astra merges (it owns Home.tsx).

## Update 19:15 (Brother)
19. **Remove the "Chat" (workspace) nav entry**: the Home is the single place for agents. Focus mode (one chat full
    screen) opens from a strip. Remove the nav item, the workspace page and its duplicated code (no dead code);
    redirect old routes/shortcuts (Ctrl+1, "Agenti" back buttons, deep links) to the Home. Owner: ui-astra.

## Update 19:19 (Brother)
20. **Rename "Home" to "Grindhouse"** everywhere visible (nav, titles, page header, palette, shortcuts help, IT and
    EN: the name stays "Grindhouse" in both). Internal ids may stay `home` (no route churn). Owner: ui-astra.

## Update 19:26 (Brother)
21. **Top bar / menu cleanup**: remove the "Nuova chat" button (agents start from the Grindhouse/Orchestrator;
    remove its code, keep a keyboard/palette path only if something else still needs it). Make **immediately
    visible** (top bar, one click, no Settings dive): (a) the on/off toggle for the **full-screen popups** (the
    questions/permissions window that takes the whole screen; find the existing setting and reuse it), with a clear
    state; (b) the **connectors** (GitHub, Jira, ...): a compact button with status dots (connected / to verify /
    failed) that opens the connectors panel. Owner: ui-astra (renderer); a main-side setting change goes to ui-orch.

## Update 19:38 (Brother)
22. **One in-app file viewer for every file**: every file link (in questions, in Orchestrator/agent messages, in the
    Dashboard, anywhere) opens in a beautiful, easy in-app viewer, read-only (no editing). Any file on the PC,
    well formatted: markdown rendered, code highlighted, JSON/YAML/CSV/logs readable, images, PDFs; huge files
    paged/virtualized. **Diff on request** (vs git HEAD, vs a given commit/branch, or between two files). Low cost:
    no LLM calls, local rendering only. Builds on the existing FileViewer/LinkPeek (audit first).
    - **19:41 Brother: access = ANY local file, no exceptions** (secrets/dotfiles included; he was told the risk
      that an agent link can show credentials on screen). Stays read-only, never executes or opens externally by
      default; network shares (UNC) are not local files and stay blocked.
    - Audit result → 3 PRs: V1 one path for every link (route `app:openPath` call sites to the viewer; "Show in
      Explorer" only as an explicit action) + syntax highlighting (offline lib) + CSV table + YAML formatting +
      remove the root allow-list per the line above; V2 PDF (pdfjs-dist) + real paging by line/byte range for huge
      files; V3 diff (vs HEAD, vs ref, two files) with read-only git (argument allow-list, no shell) + jsdiff.

## Update 19:43 (Brother)
23. **Smart brain search** (from tmp/brain-review.md): today `/api/search` (ops/tools/brain-site.mjs:279-288),
    session-find.mjs and ctx.mjs are literal substring matches. Replace with hybrid search: BM25 ranking + local
    semantic search (small local embedding model + sqlite-vec), fully offline, zero API cost, incremental index
    updates on file change, typo tolerance; same API for the app and the agents' tools. Mind disk (model ~100 MB
    max). Not chosen for now: now.md/journal auto-consolidation, backlinks in the viewer.
    - **19:46 Brother: reuse the same local embeddings for** (a) an **agent classifier**: the Orchestrator scores
      a request against agent definitions + their successful past runs, picks the best agent (score shown), and when
      none is close enough proposes creating one (creation still only on Brother's request, SPEC 17); (b) **errors
      and ideas grouped by theme** in the Dashboard (auto clusters, growing themes, duplicates flagged). Not chosen:
      time/cost estimates from similar past work. Owner of (a): ui-agents (A7/A10) on top of the search index.
    - **19:48 Brother: ship the local model directly, no benchmark gate** (multilingual IT+EN embedding model,
      quantized, CPU). Keep BM25 alongside for exact names/codes; the classifier only suggests, the Orchestrator
      decides.
    - **19:56 Brother: reuse it for errors too**, in a follow-up PR after the search index: (c) **correction
      detection by meaning**: replace the keyword regex in `.claude/hooks/correction-catch.mjs` (CORRECTION/CONFUSION;
      it flagged "spiegami questa storia" as a correction) with similarity to the real corrections logged in
      `ai-errors.md`, keeping the regex as fallback when the index is missing; (d) **repeat-error prevention**: before
      an agent acts, retrieve the most similar past errors (ai-errors.md) for its task and inject them as a short
      warning. (21:16 Brother: local only, no cloud classifier such as TypeSafe Jev, not even as a tie-breaker.)
      The hook must stay fast (index lookup only, no model load per prompt if it costs >~200 ms: use a
      warm local service or skip).

## Update 18/10 09:32 (Brother, via the Regia, after trying main 8409b80)
24. **The Grindhouse is only the strips** («la grindhouse devono solo vedersi gli agenti al lavoro con striscioline
    espandibili non da un pulsante ma da un click sulla strisciolina e tutte le info importanti nella strisciolina
    costo stime contesto modelli ecc ecc che si vedono anche a strisciolina compattata la frase io me la aspetto nella
    dashboard le striscioline devono essere il cuore della grindhouse nessun altra informazione»). No greeting, no
    headline, no counts, no "Aspetta te" list, no big cards; a click anywhere on a strip expands/collapses it; the
    collapsed strip shows agent, model, effort, cost, work time, context, state; a decision waiting = a discreet
    "Ti aspetta" pill that opens that strip's decision popup (popups off too; on: as before); the headline (item 18)
    moves to the Dashboard; the Orchestrator column is unchanged. Owner: ui-astra (feat/grindhouse-strips).
    No time/cost estimate exists since ADR 0053 (removed as no better than the median): the strip shows actuals.
    Brother, 18/10 09:51-10:10: actuals only (no estimate). A strip's browser folds with it (the strip counts it);
    expanded, chat left and browser right inside the same strip frame and accent, both in view («deve essere chiaro
    la strisciolina proprietaria di quel browser»), each with its own full-screen control; a narrow column stacks
    them with the chat sized to its content.

## Update 18/10 10:28 (Brother, panel via the Regia)
25. **Every task goes through an agent** («ogni compito passa da un agente»). Every task is done by an agent: an
    existing one, or one the Orchestrator creates on the fly for that task. An on-the-fly agent starts **in prova**
    (probation): if its runs went well (A5/A6 outcomes, AGENTS-DESIGN §4.7) it stays in the catalog for next time,
    otherwise it is retired (archived, with a feed entry and undo). No more "Unassigned"/ad-hoc chats as a normal path:
    a chat Brother starts without picking an agent runs as the built-in **Generale** agent, so it is measured too.
    This replaces the 19:35 line "creates only on Brother's request" for task agents: the task Brother gives is the
    request. Unprompted creation (with no task behind it) stays a suggestion. Design: AGENTS-DESIGN §4.7.
    Brother approved "Generale" for manual chats (18/10 10:43).
    **Granularity (18/10, via the Regia):** an agent = a **role**; know-how per app or procedure = **skills**; every run
    is tagged with agent + skills loaded + app/repo; metrics are filterable by skill and app. A new agent is split off
    only when the data asks: the Orchestrator proposes it with numbers, Brother decides. Design: AGENTS-DESIGN §4.8.
