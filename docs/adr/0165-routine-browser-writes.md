<!-- Explicit browser effects and host-only site logins; used by routine authors and maintainers. -->
# ADR 0165: Scoped routine browser writes and encrypted site logins

Status: accepted (user request, 2026-10-26).

## Why

ADR 0145/0155 intentionally refused external writes without a host adapter. A reusable step using the app's own
browser could therefore never start. Definition approval must authorize a specific browser boundary, not an ordinary
chat with unrestricted commands. Existing brain-file credentials are a user-copy facility, not an encrypted agent vault.

## Decision

An agent step may declare `effect: "external-write"`, `writeVia: "browser"`, and `browserTargets` (1–16 exact origins).
The activation modal shows every destination; targets participate in the immutable definition digest and export.
No adapter/action, production environment or production effect may be combined with this declaration. Ordinary
external-write steps still require their existing adapter. Timer and DevOps triggers may use browser steps; this does
not create or widen a DevOps grant. Changing destinations requires a new approved version.

The runtime creates a fresh host-marked worker, binds it before sending instructions, and rechecks run/task identity,
brain, status, pause and timeout at tool, input and request boundaries. Tabs use isolated per-worker sessions. Navigation,
frames, popups and all network requests stay on the approved origins (including dependencies such as API/CDN origins).
Detached workers, cancelled/completed steps and unrelated chats cannot reuse the session. No wildcard origins.
HTTPS is required except exact HTTP loopback origins for local test apps.

The actual engine policy is narrowed to read + browser, with a positive list of routine/report MCP tools. Shell, edits,
generic web fetch, arbitrary page JavaScript, delegation, external connectors and memory writes are unavailable.
Only the Claude harness currently enforces this complete tool boundary. Other engines fail before worker creation;
there is no silent engine substitution. Role permissions can narrow access further. User CLI configuration is unchanged.
This is an app/harness capability boundary, not an OS sandbox against a malicious local user or CLI installation.

Browser input dispatch is journaled before execution without typed text. `agent_report.browserWrite` supplies
`done`, `partial` or `not-done` with read-back/screenshot evidence; it is explicitly an agent observation, not an
independent server receipt. Existing report identity, success, evidence labels and review checks still apply.
`not-done` permits the bounded retry policy. Partial, missing or interrupted outcomes require user recovery and
are shown before retry, rather than masquerading as an unknown DevOps transaction. Manual report cannot bypass
this evidence; browser workers cannot be manually rebound to ordinary chats.

## Site credentials

Credenziali now also edits routine site logins. Metadata is visible; passwords are write-only, encrypted through the
existing safeStorage/LoginVault mechanism in the app profile, separately from personal Browser passwords. There is no
agent credential-read, save or delete tool. Save/use requires an active routine approving the exact origin; no OS
keychain means no plaintext fallback. Removing an approved origin leaves an unusable entry the user may delete.

`browser_login` retrieves one unambiguous exact-origin credential inside main, fills/submits a single same-origin
POST form in an isolated world, and returns only status. Host login requires one standalone tab: pre-existing
same-origin openers could inspect a filled form. Close other tabs first, or use the user handoff. New tabs/popups
are blocked until the protected document is gone; an open login handoff blocks agent access to the whole group. Ambiguous forms/accounts, MFA, CAPTCHA, SSO or absent
credentials use `handoff_to_user` with `kind: "login"`. Agents never type passwords. Effective submitter method,
action and target are rechecked after input events; cross-origin and popup submissions are refused. During credential
fill, even another approved origin is blocked. The approved site itself receives its login credential by design.

Protected documents cannot be read or captured as evidence, including through app_screenshot. Reads serialize with
login; capture privacy is checked before and after asynchronous capture. An isolated-world nonce survives SPA URL
changes, and a successful clean document clears navigation history before privacy protection is released. Logs mask
known passwords (including short/encoded values) and sensitive structured fields. Raw response bodies are unavailable
to these workers. No secret belongs in routine definitions, brain files, tool results, evidence or transcripts.

## Migration and limits

Old definitions and stored runs remain valid. Nothing is automatically upgraded. The Orchestrator proposes a new
version with the browser fields, a Claude engine/model and a role allowing browser writes. Every agent prompt must
call browser_login rather than obtaining a password, and finish with browserWrite plus normal report evidence.
After approval, the user may add site credentials in Credenziali. A login requiring SSO/MFA remains a user handoff;
all required origins must be deliberately approved. No production permission or app update is implied.

Unit coverage exercises activation/automation, launch, exact origins, native policy, report/retry, revocation,
environment revision races, encrypted CRUD, form submission restrictions, privacy and log redaction. UI E2E is authored
on the branch and runs only on main under the existing repository policy.
