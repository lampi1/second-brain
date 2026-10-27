# ADR 0176 · Routine packages carry their secrets in clear text (exception to AGENTS.md rule 2)

Status: accepted (2026-10-27, owner decision relayed by the «App · motore routine unico (app + terminale)» thread).

## Context

AGENTS.md rule 2 keeps secrets out of files, and the app stores routine site passwords encrypted (ADR 0165). A routine
that must run from a terminal on another machine, with no app and no vault, needs its site logins, its DevOps PAT and
its test DB login next to its definition. The owner chose simplicity: no passphrase, no test/prod filter on the
secrets themselves, no warnings.

## Decision

1. `routine.json` may carry, in clear text:
   - `credentials`: site logins, in the same `{ loginUrl, user, password }` shape as the app's JSON export, so the two
     agree. `loginUrl` is the exact login page, query included (Air: `/Account/Login?mode=local`): the runtime's
     login helper always navigates there first, also on a re-login after a redirect to a login page without the query
     (`/Account/Login?ReturnUrl=…`); matching a credential ignores the query. The URL lives here, never in a step
     prompt;
   - `secrets.devopsPat`: a DevOps Personal Access Token, sent as `Basic base64(":" + pat)`;
   - `secrets.testDbs[<id>]`: `{ user, password }` for a declared test DB target.
2. The exception covers routine packages only. Every other rule-2 boundary stays: the app vault, logs, the renderer,
   app MCP and chat transcripts.
3. **Masking is mandatory.** Every value, in each of its text forms (raw, URL-encoded, JSON-escaped, base64 Basic),
   is registered with the run's Masker before the first step. It becomes `***` in every run file (run.json,
   transcripts, step results, evidence, report) and in every runtime log line. A test plants secret values and greps
   the whole run folder for them.
4. Secrets never reach a session's prompt or environment. Site logins are typed by the runtime through its
   BrowserDriver. The test DB login goes only to the runtime's own MCP server, through a temporary config file outside
   the run folder that is deleted after the step. The PAT is used only by the runtime's DevOps calls.
5. A production DB stays forbidden even with embedded credentials (ADR 0175 item 10).
6. Exception to AGENTS.md rule 6, at the owner's request (2026-10-27): to fill `secrets.devopsPat` the app reads one
   credential from Cursor's MCP config (`~/.cursor/mcp.json`), read only, host code only: the `ADO_MCP_AUTH_TOKEN` of
   the Azure DevOps server whose arguments name the package's single organization. The Azure DevOps connector (ADR 0086)
   wins when it holds a token; Cursor's file is never written, and its value is redacted from the logs like the others.

## Consequences

Whoever holds a package holds its secrets: share it like a password. A future passphrase or OS-keychain option can
wrap `secrets` without changing the rest of the format.
