# ADR 0317 · Link a sign-in page's site to a test account with one click

Date: 2026-11-16 · Status: accepted (owner, issue #429, «Risolvi anche tutte le issue aperte», 2026-11-16) · Amends: ADR 0310

## Context

`fill_credential` (ADR 0310) types a stored password only on its entry's own site (`url`, or `loginUrl`). When a test
environment moves host, the entry keeps the old host and every agent is refused; the refusal told it to ask the user to
edit the credentials file by hand. In one week six test logins went to the user instead, and one agent navigated to the
old host (`ERR_NAME_NOT_RESOLVED`).

## Decision

1. On a host mismatch for a named account with exactly one entry that does not look like production, the refusal opens
   a hand-off of kind `link` on the agent's tab: «Collegare <host> all'account <user>?», with the page's host, the
   account and the hosts it is for today. Never the password: the banner has no Copia password, and main refuses one.
2. **Sì** (the user's click on the tab only: hand-offs are answered through `browser:handoffResolve`, never by an agent,
   by the Orchestrator's `app_resolve_question` or from the phone) adds the page's origin to that entry's `loginUrl`
   (a string, then a list of strings: `loginUrl` may now be either) and answers the agent «call fill_credential again».
   The entry is found again by its id at the click: a file changed meanwhile, or an entry that now looks like
   production, answers «not linked». Only that key changes; the JSON document (or its Markdown code block) is written
   back with 2-space indentation and the file's own line ends, through a temporary file and a rename.
3. **No**: the agent is told to sign in another way (`handoff_to_user` kind `login`), as before.
4. The refusal tells the agent to wait on the hand-off (`handoff_to_user` with its `handoff_id`) and not to open the
   old host; an agent that ends its turn is woken with the answer, as for every hand-off.

## Consequences

- The app writes to the credentials file for the first time: one key of one entry, on the user's click (rules.md §2).
- Several entries with the same user name (or only production-looking ones) are not offered: the refusal is the old one.
