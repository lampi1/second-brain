# Architecture

```
┌──────────────────────────── Electron main (Node) ─────────────────────────────┐
│ index.ts ── wiring.ts ── services: ChatService · BrowserService · BrainService │
│   chats/   ClaudeSession (claude -p stream-json, control protocol)            │
│            CursorSession (agent acp, JSON-RPC)      ChatManager · External     │
│   browser/ Tabs = WebContentsView (partition persist:sb-browser), page scripts │
│   mcp/     MCP server 127.0.0.1 (Streamable HTTP): /mcp (external clients),    │
│            /mcp/chat/<id>/<token> (one per app chat: its own tabs)            │
│   brain/   brain folder config · Live feed (fs.watch + chats.mjs) · notify    │
│   ipc.ts   typed handlers (sender check) + Emitter                            │
└───────────────▲──────────────────────────────────────────┬────────────────────┘
                │ invoke (contract.ts InvokeMap)           │ events (EventMap)
┌───────────────┴─────── preload (sandboxed, allow-list) ──▼────────────────────┐
│ window.sb = { invoke, on }                                                    │
└───────────────▲───────────────────────────────────────────────────────────────┘
┌───────────────┴──────────────── renderer (React) ─────────────────────────────┐
│ store (one external store, events → state) · views: Mosaico | Corsie · Brain   │
│ tiles: Regia · Chat · Browser (reports its rect → main places the view)       │
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
  after a restart as `closed` and resume on the first message. Transcripts stay where each CLI keeps them.
- Settings in `userData/config.json` (brain folder, ports, mutes, view). Never secrets.
- Every record has an `id`; owner fields can be added for the team horizon (`VISION.md`) without breaking shapes.
