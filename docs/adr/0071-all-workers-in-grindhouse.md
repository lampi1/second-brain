<!-- Decision record for chat visibility, persistence compatibility and source-code launch checks. -->
# ADR 0071: Every worker lives in the Grindhouse

Date: 2026-10-18

The `app` chat partition hid workers created by the Orchestrator from the Grindhouse.
All workers now share the same grid, browser placement, requests, focus and maximize actions.
Migliora l'app retains proposal/version controls; it does not host a second chat list.
The canonical Orchestrator keeps its existing dedicated column.

Saved `space: "app"` values are discarded on load, including when no coordinator exists.
Chat ids, sessions, cwd, permission modes, archive state and continuation links are preserved.
Legacy coordinator markers still feed the existing Orchestrator migration.

`app_create_chat` no longer advertises `space`. Old calls are accepted for compatibility:
`work` has no effect; `app` retains the source-folder default and restriction but never
creates a partition. Silently dropping that source restriction could start an old request
in the brain folder, so compatibility remains fail-closed. New calls use `cwd` and
verify it through `ImproveService.inRepo`, including registered worktrees, before selecting
app-code routing. Explicit `space: work` cannot bypass app-code routing for an app cwd.
The legacy `/mcp/improve` endpoint retains its source-only creation requirement.
Engine, token, ownership, permission, proposal and publication checks remain in force.

Supersedes the chat-space portions of ADRs 0020, 0021, 0032, 0036 and 0066.
