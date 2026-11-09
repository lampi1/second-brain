# ADR 0253 · A run stopped on a step only the user can do asks the user at once

Date: 2026-11-09 · Status: accepted (owner, issue #358, «risolvi tutte le issue aperte») · Builds on: ADR 0083 (reports),
ADR 0135 (yes/no questions), #123 (clean reports kept quiet)

## Context
A Scout needed a read-only query on production; the VPN on Davide's PC was off. It reported `partial` with «VPN off,
queries ready» only in the text, asked nothing, and the work sat idle for an hour until he asked.

## Decision
- **`agent_report` takes `userAction`** `{ kind: vpn | login | command | permission | decision | other, text ≤ 300,
  command? ≤ 2000 }`, only with `partial` or `blocked` (`shared/delegation.ts checkResult`). The schema and the tool
  description say when to use it.
- **Sent back once**: a partial or blocked report whose summary (never its output: code and logs name «login.ts») names a
  user-only step (VPN, MFA, SSO, login, credentials, sudo, Esegui, permission denied: `USER_ONLY_BLOCKER`) without `userAction` is refused once per run with a message naming
  the field; the same report goes through the second time.
- **The app asks** (`chats/user-action.ts`, `manager-delegation.ts askUserAction`): on such a report the app itself puts
  one yes/no question on the open Orchestrator, tool `app_user_action` (««<chat>» è fermo: <text>. Fatto?», the
  command in a code block), with no Orchestrator turn, with the feed and system notice of any question. It is kept apart from the Orchestrator
  engine's own requests (`userAsks`): while it waits, the Orchestrator's news, mail, hand-off and input go on. Any later
  report of the chat, a new turn of it, or closing it or the Orchestrator drops it. While it waits the idle reporting
  chat is held open and tagged «Aspetta te: domanda» (ADR 0251).
- **The answer never reaches an engine** (`manager-requests.ts answer` → `answerUserAction`): Sì sends the owner of the
  work (its open parent while the parent's own assignment is still on, else the Orchestrator) «[azione dell’utente fatta · chat «…»] … riassegnala», which resumes it
  with agent_assign_task / app_assign_task; the user's own words go the same way; No sends nothing and the run stays
  stopped and visible.
- **Prompts**: the role frame and the Orchestrator's fixed rules say a user-only block goes in `userAction` (or the
  role's own question), never only in the report text.

## Consequences
- The question is not saved, so an app restart drops it (the report
  text still says what is needed).
- The activity feed still shows `partial` as `ok` (the issue's point 6 is not done).
