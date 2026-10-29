# Architecture

```
┌──────────────────────────── Electron main (Node) ─────────────────────────────┐
│ index.ts ── wiring.ts ── services: ChatService · BrowserService · BrainService │
│   chats/   ClaudeSession (claude -p stream-json, control protocol)            │
│            AcpSession (any ACP CLI, JSON-RPC)      ChatManager · External     │
│   browser/ Tabs = WebContentsView (a partition per environment), page scripts │
│   mcp/     MCP server 127.0.0.1 (Streamable HTTP): /mcp (external clients),    │
│            /mcp/chat/<id>/<token> (one per app chat: its own tabs)            │
│            /mcp/app, /mcp/app/o/<id>/<token> (per Orchestrator, ADR 0021)     │
│            /mcp/ext/<chat>/<server>/<token> (managed MCP servers, 0086)       │
│   mcp-servers/ store (+ tokens) · gateway · client · import (ADR 0086)        │
│   brain/   brain folder config · Live feed (fs.watch + chats.mjs) · notify    │
│            usage · costs · budget · estimates · quality · model defaults      │
│   tasks/   Task page (DevOps reader, read only) · run/ "Esegui" shell blocks  │
│   search/  Ctrl+K index · skills/ Skill tab · update/ Aggiorna (Settings)     │
│   brainmodel/ Brain section: skills, rules, memory, jobs + undo (0077, 0082)  │
│   cloud/   cloud agents: Cursor REST v1 · codex cloud · claude --cloud (0080) │
│   personal/ the user's own Browser page: persist:personal, vault (ADR 0133)   │
│   overlay.ts  request layer: a top-most view for questions over browser tabs  │
│   ipc.ts   typed handlers (sender check) + Emitter                            │
└───────────────▲──────────────────────────────────────────┬────────────────────┘
                │ invoke (contract.ts InvokeMap)           │ events (EventMap)
┌───────────────┴─────── preload (sandboxed, allow-list) ──▼────────────────────┐
│ window.sb = { invoke, on }                                                    │
└───────────────▲───────────────────────────────────────────────────────────────┘
┌───────────────┴──────────────── renderer (React) ─────────────────────────────┐
│ store (one external store, events → state) · Grindhouse (strips) · Brain      │
│ strips: agent · browser zone (reports its rect → main places the view)        │
│ Orchestrator column: full height beside every page (ADR 0068)                 │
└────────────────────────────────────────────────────────────────────────────────┘
        child processes: claude.exe (per Claude chat) · agent (per Cursor chat)
        · node brain tools (chats.mjs, cost.mjs, …) run with Electron as Node
```

The four files nearly every change touched are split by area (ADR 0200): the contract's shapes and invoke channels in
`shared/contract/*.ts` behind `shared/contract.ts`; the IPC handlers in `main/ipc-handlers/*.ts`, registered by
`index.ts`; `wiring.ts` with `wiring-types.ts`, `wiring-shared.ts`, `wiring-builders.ts`; `ChatManager` as a chain of
layer classes in `chats/manager-*.ts` under `chats/manager.ts` (layout: `docs/agents/layout.md`).

## Key flows

- **A chat turn**: renderer `chat:send` → ChatManager → session `send()` writes a stream-json user line → CLI streams
  messages → session maps them to `ChatItem`s → `chat:item` events → the agent's strip re-renders. Cost from each `result`.
- **A question or permission**: CLI `control_request can_use_tool` → `PendingRequest` (`pending:added`) → shown as a
  panel in front of everything (and on the agent's strip) → the user clicks → `chat:answer` → `control_response`. This click is the user's own
  answer: the app is the harness (unlike mail between chats, which never counts as their ok).
- **A finished worker closes by itself** (ADR 0084): its `send_to_chat` to its Orchestrator (or a `run-report` block)
  is its final report; at the next clean idle turn end ChatManager completes its assignment (`work: completed`) and
  ends its agent run `completed`, unless the report or the last answer waits for the user or colleagues
  (`waitsOn`, `shared/waiting.ts`), a question/permission is open or background work runs. The main AutoCloseService
  archives it after the `autoCloseMin` delay and its warning (`closedBy: 'auto'`); a held chat carries `waitingFor`
  in `chat:autoCloseStatus` and its strip shows "In attesa di…".
- **News held for the Orchestrator** (#88): the delivery rule (`chats/orchestrator-delivery.ts`) holds a work chat's news
  (`orchestrator-wake.ts`) and mail to the Orchestrator (`mail.ts`) while it waits for the user, groups them for 30 s, or lets
  quiet ones ride along. `chats/held-news.ts` reads both queues (no delivery, no turn) and sends the list as
  `orchestrator:heldChanged` (`orchestrator:held` at start); the Orchestrator's tile shows "N novità in attesa" above its input
  (`HeldNews.tsx`), a click lists chat, kind, since when and why.
- **Delegation** (ADR 0083): a role chat calls `agent_delegate` on its own endpoint (`/mcp/chat/:chatId/:token`,
  `agents/delegation.ts`) → limits and permissions checked, slots reserved → `ChatManager.create(..., 'agent')` with
  `parentId` and the contract → the child's requests pass `agents/role-gate.ts` (skills, sub-agents, above-parent
  refused) → `agent_ask_parent` / `agent_answer_child` for questions → `agent_report` → `reportDelegation` sends the
  result to the parent. The renderer builds the tree from `parentId` (`lib/chat-tree.ts`), the steps from the
  transcript (`lib/run-steps.ts`) and picks the one view that shows a request (`lib/child-requests.ts`). The user's
  message in a work chat (`chat:send` → `userWrote`) is quiet news for the Orchestrator and a note for the parent.
  A root chat the Orchestrator opened reports with the same `agent_report` (`reportRoot` → the Orchestrator).
- **Role permissions** (ADR 0085): every role defaults to every tool class and no ceiling (`shared/roles.ts`); the
  role page's Permessi card (`RolePermissions.tsx`) narrows a role through `agents:save` (a version). At launch the
  catalog's policy goes to the chat, narrowed by its parent's; under shell-read `refusedCommand` and the role gate pass
  `node` of a script listed in the brain's `read-only-tools.md` (`agents/read-tools.ts`); `agents/skill-needs.ts` turns a
  passed skill's tools into launch warnings. The role gate runs a granted bare skill name as `<launch plugin>:<name>`
  (an `answer` patch → Claude's `updatedInput`); the Orchestrator's Claude session has a per-turn workspace budget, an
  in-process PreToolUse hook (`agents/orchestrator-budget.ts`, `hook_callback`, ADR 0090).
- **Five work roles, verdicts from facts, honest levels** (ADR 0100): `shared/roles.ts` holds the Orchestrator and the
  five work roles (Strategist, Scout, Artisan, Sentinel, Herald); `RETIRED_ROLE_IDS` maps Router, Judge, Scribe to their
  successor wherever stored data names them (catalog load, launches, chat owners, delegations, packs; their MCP access
  entries are dropped). `shared/run-verdict.ts` computes a run's verdict from facts on read (agent_report done with every
  criterion met, no correction, no rework within 7 days; provisional until then): verified evidence for
  `run-metrics.ts`, `trials.ts`, `suggestions.ts` and `agents/standing.ts`, whose level counts
  only verified successes (`AgentStanding.wins`) and whose performance gives the agent's own word no weight.
- **The task estimate** (ADR 0087): `agents/task-estimate.ts` groups the ended agent runs by agent × kind (the keyword
  classifier of `brain/estimates.ts` on the run's goal), kind, agent; a request takes the median of the first group with
  3 or more (the 30 most recent), its middle half, a confidence and its parts, and a path (self / one-agent / tree). The
  Orchestrator reads it with `task_estimate` and in `app_create_chat`'s answer; IPC `agents:estimates`
  (`agents/run-estimates.ts`) gives the strips each run's estimate made before it started, its actual once ended, and
  `agents/estimate-accuracy.ts`'s weekly backtest (`EstimateAccuracy`, also for Classificatori);
  `lib/run-estimates.ts` reads it once for every strip, `RunEstimate.tsx` draws the chip, its "?" and the Orchestrator's plan.
- **The user's corrections, a kind by examples, PPI** (ADR 0197): `chat:send` → `brain/user-corrections.ts` classifies
  the user's message (tag, after-report, semantic detector or the hook's regex; counts per day, never the text) →
  `/api/quality` → Qualità's «Errori che hai dovuto trovare tu». `brainmodel/kind-model.ts` trains a nearest-centroid
  kind classifier on the local e5 embeddings of verified runs when Classificatori asks (`kind-centroids.ts`, word-rule
  labels, held-out test). `agents/judge-agreement.ts` gives each role's all-versions metrics a prediction-powered success
  estimate and the Sentinel's agreement with the user (`shared/ppi.ts`).
- **A cloud agent** (ADR 0080): the Orchestrator's `app_create_chat where:'cloud'` →
  CloudService checks readiness (key / sign-in, GitHub remote, pushed branch, Cursor budget) → the vendor's provider
  starts it (`cloud/cursor.ts` REST, `codex.ts` / `claude.ts` CLIs) → `cloud:changed` → a cloud strip
  (`CloudStrips.tsx`). The vendors' lists are polled only while the window is visible (30 s while running, back-off to
  10 min); the strip the user opens streams its run (Cursor SSE); Cursor's usage goes to `engines/spend.ts`.
- **Stop**: `chat:stop` → control `interrupt` (Claude) / `session/cancel` (Cursor); `chat:stopAll` = every running
  chat.
- **A browser action by an agent**: CLI calls the MCP tool on its own endpoint → BrowserService acts on that chat's
  tab (trusted input via CDP `Input.*`, ADR 0003 notes) → `browser:tabs` event updates the browser under its agent's strip.
- **Browsers on screen**: each browser view (under its agent's strip, ADR 0071) reports its rect (`views:layout`); main adds/positions/removes the
  WebContentsViews. An overlay (menu, dialog) reports `rect: null` for the views under it (views always draw above
  the page).
- **How the brain and the roles change** (ADR 0077, 0125, 0153): the roles are fixed (no Orchestrator tool edits,
  archives or restores them); the maintenance jobs (`brainmodel/jobs.ts`: structural migration, the user's approved
  corrections from `agent_learn_propose`, repeated-task skill candidates held for review) write only what the user
  approved; each change is a `BrainChange` in `userData/brain-changes.json` with "Annulla" (`brainmodel/changes.ts`), a
  behavioural role change as a trial version (`agents:trialDecide`). A role's tools and permissions change only from
  its Permessi card (ADR 0085). The "Manutenzione" button (top bar, Orchestrator head, Memoria) is one click (`maintenance:run`, ADR 0153): the free
  cleanup runs every job (`brainmodel:maintain`) and the log step, then one invisible app chat (no strip, no notice)
  researches with the app's best choice (strongest model, 5 $ cap, a data pack; `brainmodel/research.ts`, ADR 0132).
  Its findings are cards in Memoria → Proposte: brain changes and what to forget, applied through the change log on
  approval; app ideas and bugs as «Apri issue» cards that open the issue on GitHub when approved (gh, else the
  pre-filled new-issue page; `brainmodel/issue-open.ts`); app ideas also land in Idee on the AI's side. Brain-file
  findings (skills without a role, rules for every role, what to forget) are held and, when the research ends, gathered
  into one candidate brain (`brainmodel/research-candidate.ts`, ADR 0195): a copy of the touched files under
  `userData/brain-candidates/<id>/`, zero-token checks, the recorded-task replay only when an anonymized holdout set
  exists and the budget left covers its estimate, one card with a diff per file, applied as ONE `BrainChange` (one
  «Annulla»), refused when a brain file changed since. While budget is left the research may also propose one revised
  text for the role with the most verified failures or corrections (`brainmodel/role-reflect.ts`,
  `maintenance_role_trial`): approving it starts a trial version (catalog `approveTrial`). The end is a
  notice (`maintenance:done`). Every maintenance write is itemized (ADR 0194, `brainmodel/item-delta.ts`): `ChangeLog.apply`
  refuses a write to a brain `.md` file that drops lines it does not list as removed with a reason. The click also runs
  a zero-token brain lint (`brainmodel/brain-lint.ts`: orphans, broken links, concepts without a note, facts and skill
  lines citing files that are gone) whose findings are Proposte cards; the launch memory skips a fact citing a missing
  file. Each brain proposal carries a «riuscito se…» criterion (`brainmodel/success-check.ts`), checked a week after it
  was applied (start, hourly, click): worse → a card «Questo cambio non ha aiutato: lo annullo?». Nothing else proposes by itself: no timer, the Battito makes no idea cards, and the
  skill candidates and the Battito's rules wait in the deck until the next click (`proposals/service.ts` heldBack).
  Every Proposte decision goes to a ledger (`proposals/ledger.ts`, userData `proposal-decisions.json`); a card of an
  allow-listed group (skill, rule, fact, script/query, learning) whose recent decisions are near-always yes (90% Wilson
  lower bound ≥ 0.80 over ≥ 10, i.e. 11 yes in a row, an undo counting as no) is applied by itself through its source's own decide and listed
  in «Applicate da sole» with Annulla; roles, settings, permissions, issues, production and outside texts are always
  asked, and every card left says why (`proposals/policy.ts`, ADR 0193). Memoria's statistics (`brainmodel/memory-stats.ts`, `BrainModelState.memoryStats`) are counts over the
  memory files, `ai-errors.md` and the recorded agent runs: zero tokens, nothing written.
- **Live brain**: `fs.watch` on the brain folder + periodic `chats.mjs list` → diffed into `FeedEvent`s →
  `feed:events`; urgent ones also as a Windows toast when the window is not focused.

## Data and state

- App chats are persisted in `userData/chats.json` (id, harness, cwd, sessionId, title, model…), so they come back
  after a restart as `closed` and resume on the first message. CLI transcripts stay where each CLI keeps them.
  API chats also persist user and assistant messages as plaintext in `userData/api-chats/<chatId>.json`.
- Settings in `userData/config.json` (brain folder, projects folder, ports, mutes, Task reading). Never secrets. The
  projects folder (`projectsRoot`) is found read-only by `main/brain/projects-folder.ts` (CLI folder names, usual places)
  and asked by the first setup only when it cannot tell.
- App-managed MCP servers (ADR 0086): definitions, per-role access and last tests in `userData/mcp-servers.json`;
  their tokens encrypted (safeStorage) in `userData/mcp-secrets.json`, each bound to its server's command or origin.
  Chats reach them only through the gateway (`/mcp/ext/…`), which opens the real server in main with its tokens and
  checks the chat's role chain at every call; the engines' own MCP configs are only read (import), never written.
- API key ciphertext and masks are in `userData/secrets.json`, protected by the OS-backed Electron secret store;
  main decrypts a key when its engine needs it. This is separate from unencrypted API conversation history.
- Agent profiles, frozen chat owners and their instructions, and local setup preferences are private profile data
  (`agents.json`, `chats.json`, `setup.json`).
- The agent runs (one record per role chat, the rollups of pruned runs, Flash's outcomes) are in `userData/app.db`, a
  SQLite database on `node:sqlite` (WAL, one row per run, only changed runs written; `main/app-db.ts`,
  `main/agents/runs-db.ts`, ADR 0199). At the first start of a release with it, `agent-runs.json` is imported in one
  transaction and kept as `agent-runs.json.migrated-<date>`; when the database cannot be used the store stays on
  `agent-runs.json` (the fallback). A damaged `app.db` is renamed `app.db.corrupt-<date>`, never deleted.
  `npm run levels` reads either, read only.
  Browser sign-in/password hand-offs follow their explicit user-action flow; profile backups must be treated as private.
- Logs (ADR 0192): the technical log `userData/logs/app-YYYY-MM-DD.jsonl` (`main/log.ts`, 14 days; lines about a chat
  carry its agent run as `run`, and `op`/`step` named after the OpenTelemetry GenAI operations: `npm run logs -- --run <id>`),
  the Log page's journal `userData/activity/log-*.jsonl` (7 days) and the daily digest `userData/logs/digest-YYYY-MM.jsonl`
  (`main/log-digest.ts`, 90 days: per day levels, warn/error groups, stalls, interface errors, journal kinds; written
  for each finished day before its raw files may go). The page's uncaught errors, unhandled rejections and the render
  errors of each page's `ErrorBoundary` («Questa pagina ha avuto un errore», «Ricarica la pagina») reach the log as
  scope `renderer` through `log:renderer` (`main/renderer-errors.ts`, rate-limited). The maintenance pack reads the
  period since the previous pass from them (sections journal, perf, ui-errors, digest; `brainmodel/research-pack-logs.ts`).
- Every record has an `id`; owner fields can be added for the team horizon (`VISION.md`) without breaking shapes.

## Instances and processes

- **Stable vs dev (ADR 0007)**: the user's cockpit runs a frozen release from `%LOCALAPPDATA%/second-brain/releases/`
  (userData `second-brain`, MCP port 4319); anything started from the repo is the dev instance (userData
  `second-brain-dev`, MCP 4329). "Aggiorna" (Settings → Aggiornamenti, ADR 0075) or `npm run promote` (with the full checks) copies `main` into a
  new release; `npm run rollback` goes
  back. Tests and `npm run demo` use a temp profile and a random port.
- **Demo (`SB_DEMO=1`)**: `wiring.ts` swaps in `demo-wiring.ts` (fake chats, browser pages, Task data); with
  `SB_BRAIN` pointing at a brain folder its data server answers the brain pages (`npm run demo` uses the synthetic
  brain of `test/fixtures`). `SB_DEMO_FREEZE=1` fixes the clock and the data for screenshots and visual baselines.
- **The brain's data server**: the brain pages call the brain's own `ops/tools/brain-site.mjs` (GET-only JSON on
  localhost, started by `brain/api.ts` with Electron as Node), so the brain owns its data formats and the app only
  renders them.

The module map with good starting points is in [CONTRIBUTING.md](../CONTRIBUTING.md#a-map-of-the-modules).
