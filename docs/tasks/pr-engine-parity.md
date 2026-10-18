Title: fix(engines): select ready engines and align app chat permissions

New installations with only Codex or Cursor can select their logged-in engine for chats and starter agents instead
of starting Claude. Built-in CLI status checks use fixed, non-spending commands; unsupported output remains unknown.
Confirmed-ready engines take precedence over unknown login status. Codex is an immutable built-in enabled by default
for fresh settings; saved off switches and agent launch permissions remain authoritative. Onboarding checks login,
orders ready engines first, and saves the user's selected default. Untouched starter agents follow readiness changes
with versioned history; user-customized agents remain pinned.

App-area routing accepts every available engine while retaining model/effort validation, locked routing rows and
the existing app endpoint safety rules. The routing tool description now matches this policy.

Codex native configuration and Cursor's app-owned config snapshot grant exactly Claude's MCP scope: every tool on
the attached loopback `second-brain-app` server, and only `send_to_chat` / `list_chats` on `second-brain`. Browser
actions, unrelated servers and read-only comparison runs receive no new grants. User CLI settings are not modified.

Validation: TypeScript, ESLint on touched files, related unit tests (two workers), dev build, independent review and
a manually inspected hidden demo screenshot. No e2e, live model turns, push or promotion.

Read-only CLI evidence: installed Codex `0.163.0-alpha.10.2` accepts the launch overrides and reports the configured
streamable HTTP endpoint through `mcp get`. `codex login status` returned `Not logged in` in this execution environment;
the brief's claim of an authenticated CLI could not be confirmed. Live approval behavior was not exercised.
Native syntax references: [Codex config](https://learn.chatgpt.com/docs/config-file/config-reference),
[Cursor permissions](https://cursor.com/docs/cli/reference/permissions),
[Cursor authentication](https://cursor.com/docs/cli/reference/authentication).

Release notes retain known limitations: Codex/Cursor costs and budget coverage and Codex brain lifecycle hooks are
outside this change. The cloud audit remains on `review/engine-parity`; its other findings are deferred.
