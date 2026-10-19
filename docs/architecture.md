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
│   brain/   brain folder config · Live feed (fs.watch + chats.mjs) · notify    │
│            usage · costs · budget · estimates · quality · model defaults      │
│   tasks/   Task page (brain script, read only) · run/ "Esegui" shell blocks   │
│   search/  Ctrl+K index · skills/ skills page · update/ Aggiorna (Settings)   │
│   brainmodel/ Brain section: skills, rules, memory, jobs + undo (0077, 0082)  │
│   cloud/   cloud agents: Cursor REST v1 · codex cloud · claude --cloud (0080) │
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
- **The task estimate** (ADR 0087): `agents/task-estimate.ts` groups the ended agent runs by agent × kind (the keyword
  classifier of `brain/estimates.ts` on the run's goal), kind, agent; a request takes the median of the first group with
  3 or more (the 30 most recent), its middle half, a confidence and its parts, and a path (self / one-agent / tree). The
  Orchestrator reads it with `task_estimate` and in `app_create_chat`'s answer; IPC `agents:estimates`
  (`agents/run-estimates.ts`) gives the strips each run's estimate made before it started, its actual once ended, and
  `agents/estimate-accuracy.ts`'s weekly backtest (`EstimateAccuracy`, also for the Dashboard / Classificatori);
  `lib/run-estimates.ts` reads it once for every strip, `RunEstimate.tsx` draws the chip, its "?" and the Orchestrator's plan.
- **A cloud agent** (ADR 0080): the Orchestrator's `app_create_chat where:'cloud'` → `cloud:start` →
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
- **An agent changes by itself** (ADR 0077, 0082): the maintenance jobs (`brainmodel/jobs.ts`: a skill from repeated
  work, duplicate skills and memories merged, the user's corrections applied) and the Orchestrator's `agent_update` /
  `agent_rollback` / `agent_archive` / `agent_restore` apply at once; each change is a `BrainChange` in
  `userData/brain-changes.json` with "Annulla" (`brainmodel/changes.ts`), a behavioural agent change as a trial version.
  Tools, permissions and the engine of an agent wait for the user in Agenti → Da approvare (`agents:proposalDecide`).
  The "Manutenzione" button atop Skill, Regole and Memoria runs every job now (`brainmodel:maintain`) and shows what
  each did. Memoria's statistics (`brainmodel/memory-stats.ts`, `BrainModelState.memoryStats`) are counts over the
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
- API key ciphertext and masks are in `userData/secrets.json`, protected by the OS-backed Electron secret store;
  main decrypts a key when its engine needs it. This is separate from unencrypted API conversation history.
- Agent profiles, frozen chat owners and their instructions, and local setup preferences are private profile data
  (`agents.json`, `chats.json`, `setup.json`). Local milestones store only achievement IDs, dates and visibility.
  Browser sign-in/password hand-offs follow their explicit user-action flow; profile backups must be treated as private.
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
