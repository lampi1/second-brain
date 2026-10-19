# Architecture

```
┌──────────────────────────── Electron main (Node) ─────────────────────────────┐
│ index.ts ── wiring.ts ── services: ChatService · BrowserService · BrainService │
│   chats/   ClaudeSession (claude -p stream-json, control protocol)            │
│            AcpSession (any ACP CLI, JSON-RPC)      ChatManager · External     │
│   browser/ Tabs = WebContentsView (a partition per environment), page scripts │
│   mcp/     MCP server 127.0.0.1 (Streamable HTTP): /mcp (external clients),    │
│            /mcp/chat/<id>/<token> (one per app chat: its own tabs)            │
│            /mcp/app, /mcp/app/r/<id>/<token> (app control per Regia, ADR 0021)│
│   brain/   brain folder config · Live feed (fs.watch + chats.mjs) · notify    │
│            usage · costs · budget · estimates · quality · model routing       │
│   tasks/   Task page (brain script, read only) · run/ "Esegui" shell blocks   │
│   search/  Ctrl+K index · skills/ skills page · update/ Aggiorna (Settings)   │
│   overlay.ts  request layer: a top-most view for questions over browser tabs  │
│   ipc.ts   typed handlers (sender check) + Emitter                            │
└───────────────▲──────────────────────────────────────────┬────────────────────┘
                │ invoke (contract.ts InvokeMap)           │ events (EventMap)
┌───────────────┴─────── preload (sandboxed, allow-list) ──▼────────────────────┐
│ window.sb = { invoke, on }                                                    │
└───────────────▲───────────────────────────────────────────────────────────────┘
┌───────────────┴──────────────── renderer (React) ─────────────────────────────┐
│ store (one external store, events → state) · Grindhouse (strips) · Brain      │
│ tiles: Chat · Browser (reports its rect → main places the view)               │
│ Orchestrator column: full height beside every page (ADR 0068)                 │
└────────────────────────────────────────────────────────────────────────────────┘
        child processes: claude.exe (per Claude chat) · agent (per Cursor chat)
        · node brain tools (chats.mjs, cost.mjs, …) run with Electron as Node
```

## Key flows

- **A chat turn**: renderer `chat:send` → ChatManager → session `send()` writes a stream-json user line → CLI streams
  messages → session maps them to `ChatItem`s → `chat:item` events → tile re-renders. Cost from each `result`.
- **A question or permission**: CLI `control_request can_use_tool` → `PendingRequest` (`pending:added`) → shown in
  the tile and in the needs-you lane → the user clicks → `chat:answer` → `control_response`. This click is the user's own
  answer: the app is the harness (unlike mail between chats, which never counts as their ok).
- **Stop**: `chat:stop` → control `interrupt` (Claude) / `session/cancel` (Cursor); `chat:stopAll` = every running
  chat.
- **A browser action by an agent**: CLI calls the MCP tool on its own endpoint → BrowserService acts on that chat's
  tab (trusted input via CDP `Input.*`, ADR 0003 notes) → `browser:tabs` event updates the tile header.
- **Browser tiles on screen**: each tile reports its rect (`views:layout`); main adds/positions/removes the
  WebContentsViews. An overlay (menu, dialog) reports `rect: null` for the views under it (views always draw above
  the page).
- **Live brain**: `fs.watch` on the brain folder + periodic `chats.mjs list` → diffed into `FeedEvent`s →
  `feed:events`; urgent ones also as a Windows toast when the window is not focused.

## Data and state

- App chats are persisted in `userData/chats.json` (id, harness, cwd, sessionId, title, model…), so they come back
  after a restart as `closed` and resume on the first message. CLI transcripts stay where each CLI keeps them.
  API chats also persist user and assistant messages as plaintext in `userData/api-chats/<chatId>.json`.
- Settings in `userData/config.json` (brain folder, ports, mutes, view). Never secrets.
- API key ciphertext and masks are in `userData/secrets.json`, protected by the OS-backed Electron secret store;
  main decrypts a key when its engine needs it. This is separate from unencrypted API conversation history.
- Agent profiles, frozen chat owners and their instructions, and local setup preferences are private profile data
  (`agents.json`, `chats.json`, `setup.json`). Local milestones store only achievement IDs, dates and visibility.
  Browser sign-in/password hand-offs follow their explicit user-action flow; profile backups must be treated as private.
- Every record has an `id`; owner fields can be added for the team horizon (`VISION.md`) without breaking shapes.

## Instances and processes

- **Stable vs dev (ADR 0007)**: the user's cockpit runs a frozen release from `%LOCALAPPDATA%/second-brain/releases/`
  (userData `second-brain`, MCP port 4319); anything started from the repo is the dev instance (userData
  `second-brain-dev`, MCP 4329). `npm run promote` copies a tested `main` into a new release; `npm run rollback` goes
  back. Tests and `npm run demo` use a temp profile and a random port.
- **Demo (`SB_DEMO=1`)**: `wiring.ts` swaps in `demo-wiring.ts` (fake chats, browser pages, DevOps data); with
  `SB_BRAIN` pointing at a brain folder its data server answers the brain pages (`npm run demo` uses the synthetic
  brain of `test/fixtures`). `SB_DEMO_FREEZE=1` fixes the clock and the data for screenshots and visual baselines.
- **The brain's data server**: the brain pages call the brain's own `ops/tools/brain-site.mjs` (GET-only JSON on
  localhost, started by `brain/api.ts` with Electron as Node), so the brain owns its data formats and the app only
  renders them.

The module map with good starting points is in [CONTRIBUTING.md](../CONTRIBUTING.md#a-map-of-the-modules).
