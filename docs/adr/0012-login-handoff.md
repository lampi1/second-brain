# ADR 0012 · Login hand-off: progress while waiting, the account from the credentials file, the password only on a click

Date: 2026-10-11 · Status: accepted

## Context
In the chat "Prova · Browser su test 3" an agent called `handoff_to_user` (kind login, wait_seconds 600). Two failures:
1. Claude Code aborts an MCP tool call that sends "no response or progress for 300s" (CLI 2.1.283, idle timeout; reset
   by every `notifications/progress`). Our server answered only plain JSON, so the call died and the chat lost the thread.
2. The user never got the credentials: the chat had read them from a credentials file in the brain but wrote them
   only in its reasoning. The app also had no banner at all for an open hand-off (only a feed line).

## Decision
- **Progress.** The MCP server (`mcp/server.ts`) streams a `tools/call` that carries `_meta.progressToken` when the
  client accepts `text/event-stream`: on the tool's first `ctx.progress()` the answer becomes SSE, progress events go
  out, the result is the last event. `handoff_to_user` reports every 25 s and waits 10 min by default (up to 30). A client
  without progress gets an answer within 240 s ("still waiting", call again).
  `notifications/cancelled` aborts the call it names (same session), so a stopped chat leaves no orphan waiter.
- **Wake-up.** If the user answers after the agent stopped waiting (no tool call took the outcome within 4 s, or within
  60 s of a "still waiting" answer, when the agent is likely calling again), the app sends the chat a message ("Ho
  fatto l'accesso nel browser (ambiente …): riprendi da dove eri.").
- **Credentials.** The agent passes `account` (user name or e-mail), never a password. Main looks the entry up in the
  brain's credentials file (`credentialsFile` in `brain-settings.json`, a path inside the brain; default
  `ops/credentials.md`; JSON, or Markdown with JSON code blocks) and the banner shows user, sign-in URL and note.
  "Copia password" makes main read the file again and put the password on the clipboard, cleared after 30 s if still
  there and also when the app closes; meanwhile the `key` tool refuses paste combos (Ctrl+V, Shift+Insert), or an agent
  could paste it into a field and read it back. The password never travels in a tool argument or result, the renderer, the feed or a log; the agent does not
  need to read the file at all.
- **Banner.** On the browser tile, between header and page (the native view moves down, nothing covers it): who waits
  and since when, the instructions, the account card with Copia buttons, "Fatto, sono dentro" / "Non riesco".

Rejected: the agent passes a free text with the credentials (the password would sit in a tool argument, the transcript
and the hand-off object); the app types the password into the page (a password manager inside the cockpit, with
wrong-field risks; may come later behind an explicit click).

## Consequences
- AGENTS.md rule 2 ("credentials never handled by the app") gains one exception: login hand-off passwords, read from
  the user's own brain file only on the user's click, never stored or logged by the app.
- Windows clipboard history (Win+V), when the user has it on, may keep the copied password; the 30 s clear does not
  reach it.
- Tests run with an in-memory clipboard (`SB_TEST`): a test never overwrites what the user copied.
- 2026-10-13, "Credenziali" panel (command palette, top bar): the same file and the same rules outside a hand-off. Main
  sends the renderer only group (the file's keys, "air · test"), user, URL, note and an id (a hash of position, group,
  user, URL and note; an id two entries share copies nothing); Copia password reads the file again at the click (a stale id copies nothing), with the same 30 s clear
  and paste block. Not exposed over MCP (no app_* tool lists or copies entries). Why: the user asked a chat "dammi url e
  credenziali di test X" ~12 times in 6 days.
