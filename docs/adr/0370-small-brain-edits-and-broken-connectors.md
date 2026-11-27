# ADR 0370 · The Orchestrator applies small brain edits itself; a connector that keeps failing is held back with one notice

Date: 2026-11-27 · Status: accepted (owner proposals 4 and 6, 2026-11-27) · Amends: ADR 0086 (the gateway's cool-down of
#417 and #437), ADR 0241 (brain edits outside skills)

## Context

- **Small brain edits are slow.** Every «d'ora in poi …» rule went Orchestrator → Artisan (p50 10.7 min, p90 75) →
  Sentinel (p50 9.4 min), for a change of one or two lines in a rule file, `now.md`, a section of `me.md` or a skill's
  text. The Orchestrator already writes skills (`app_skill_write`, ADR 0241) and scripts (`brain_script_save`) itself;
  it had no tool for the rest of the brain's text.
- **Broken connectors were retried at every chat.** Measured on the owner's PC: `air-mcp-test` answered 401 at every
  chat start (~700 times in 7 h), `oris-knowledge` (`kb.exe`) never started, Teams/Outlook sometimes timed out after
  30 s. The gateway held a dead program back for only 10 minutes (#417) and never held a refused login back (#437), so
  each chat paid a connection and a log line.

## Decision

### A. `brain_edit` (Orchestrator only)

1. **One tool on the Orchestrator's own endpoint** (`src/main/appctl/brain-edit.ts`), required for it on every engine
   (`ORCHESTRATOR_APP_REQUIRED` in `src/shared/role-tools.ts`); one line in its role rules (`orchestrator-role.ts`) says
   when to use it. Each change replaces exact text found once (`old` → `new`) or appends (`old` empty, creating the
   file); actions `apply`, `undo` (an id or `last`) and `recent`.
2. **Limits** (`src/main/brain/quick-edit.ts`), so the quality of a reviewed change is kept for small edits only:
   - inside the brain folder only, checked lexically (no `..`, no absolute path) and on the real path (a link or
     junction pointing out is refused);
   - Markdown and text files only (`.md`, `.txt`): scripts, JSON and code go to `brain_script_save` or an Artisan;
   - never `permissions.json`, `settings*.json`, `domain.json`, `config.json`, `.gitignore`, `.mcp.json`, the app's
     `changelog.md`, nor anything under `.git`, `hooks`, `.githooks`, `.husky`: those keep their current approval
     rules (ADR 0294, the brain's `permissions.json`, `brain-rules.md` rule 7);
   - at most **3 files**, **40 changed lines** (added + removed, only the lines that differ), 12 changes, 256 KB per file;
   - beyond any limit the tool refuses with «give it to an Artisan».
3. **Order, all or nothing** (`src/main/brain/quick-edit-service.ts`): every path checked and every change applied in
   memory; a credential in the new text refuses the edit (`mask.ts`); the user's own PreToolUse hooks see every write as
   a chat's `Write` (`skills/guard.ts`, ADR 0018: `brain-limits.mjs` keeps the fixed-context budget and its `now.md`
   rule); a file changed on disk meanwhile stops it; a failed write puts back the files already written.
4. **After the write**: the brain's own read-only lint when it has one (`ops/tools/brain-lint.mjs --json`), its findings
   on the edited files and the skill lint of a `SKILL.md` returned as `warnings` (never blocking); a line in the brain's
   `changelog.md`; a git commit of exactly the edited files (and `changelog.md`) with the message `brain: <summary>`,
   the app's neutral identity like the sync's commits, skipped (the files stay written) when the brain is not the root
   of a git repo, the sync holds its lock or a git operation is under way (`quick-edit-ports.ts`).
5. **The user sees one compact line** in the chat, which the tool returns and the Orchestrator shows as it is:
   `✎ rules/qa.md +2 −1 · me.md +1 — «first added line»`.
6. **«Annulla» for 24 h**: the files go back to their text before (a created file is removed) only while each still is
   what the edit wrote — a newer edit, the user's own or a chat's, is never overwritten — committed as
   `Revert "brain: …"` / `This reverts commit <sha>`. The journal (texts before and after, last 50) lives in
   `userData/brain-quick-edits.json`, never in the brain.

### B. Connector health (`src/main/mcp-servers/health.ts`)

1. **A state machine per server**: `ok` → `failing` (1..N-1 failures in a row) → `needs-login` (the last failure an
   HTTP 401/403) or `broken` (its program does not start, it times out, is unreachable or answers an error). N =
   **2** for a refusal or a program that does not start, **3** for a down service (a slow first start is not broken).
   A success on a request made now goes back to `ok`; a chat's cached tool list says nothing.
2. **Held back**: while marked, the gateway opens nothing for a new chat and answers at once with what the user must do;
   a chat whose connection is up keeps it. Tried again when the user signs in («Accedi»), sets a token, edits or removes
   the connector or presses «Prova» (all of them reset it), or after a back-off: `needs-login` 6 h then 24 h, `broken`
   15 min, 1 h, then 6 h. After the wait **one probe at a time** goes through (a 2-minute lease); only a failed probe
   lengthens the wait, not the connections that were already in flight.
3. **One notice to the user** when a server is marked (`connector-broken` feed card, `service.ts` `marked`): for a
   remote server whose 401 asks for the OAuth login (or that was logged in) the card carries **«Accedi»** (feed action
   `connector-login` → the existing `mcpservers:login` of ADR 0273, `AgentFeedAction.tsx`); for a pasted-token server it
   says to set a valid token; for a broken one, when the app retries and that «Prova» retries now. The connector's own
   card in Settings and the top bar chip still show the failure and «Accedi» as before.
4. **One log line per change of state**, never per chat: `MCP server failed`, `MCP server marked needs-login|broken`,
   `MCP server works again`; a refusal stays at `info` (the user's to fix, never an app warning, as #437).
5. In memory only: a restart tries each server again (two or three attempts, then the same hold).

## Consequences

- A one-line rule lands in seconds, committed and undoable, with the user's hooks and the brain's lint still in the
  loop; anything bigger, and every settings, hooks or permissions change, still goes through an Artisan and its
  approvals. The Sentinel review of such a small edit is replaced by the limits, the hooks, the lint and «Annulla».
- A connector that refuses the login costs two attempts and one card, not one per chat; a dead program two attempts
  and then one every 15 min to 6 h. A chat that starts while a connector is held back has no tools of it for that
  session (it is told why); new chats get it as soon as it works again.
- Pinned by `test/unit/brain/quick-edit.test.ts` (path guard, limits, hooks, credential, commit, revert),
  `test/unit/mcp-servers/health.test.ts` (the state machine), `test/unit/mcp-servers/gateway-broken.test.ts` and
  `test/unit/mcp-servers/notice.test.ts` (held back, one notice, one log line per change). The real git, lint and hook
  ports (`quick-edit-ports.ts`) are not unit-tested (no real git or processes in unit tests, rule 7).
