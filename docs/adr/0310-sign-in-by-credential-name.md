# ADR 0310 · Sign-in by credential name: the app types the password, the agent never holds it

Date: 2026-11-14 · Status: accepted (owner, issue #386: «Agents should be able to sign in through the app browser
without ever reading or holding the password») · Amends: ADR 0012 (the credentials file is read for one more purpose),
ADR 0237 (an agent no longer needs the password to sign in)

## Context

Since ADR 0237 agents sign in by themselves on every host, but they need the password to do it: they read the user's
credentials file and pass the value to `type` or `fill_form`. Two things went wrong with that (issue #386, the owner's
own count over 7 days):

- Claude Code's auto-mode classifier blocked 21 tool calls that read a secret file or typed its content, so at least 6
  test logins went back to the user. A rule in the brain cannot change that: the block is on the agent touching the
  value.
- A value an agent holds can end up in chat. It already happened (ADR 0012's context).

The app already reads that file itself for login hand-offs (`browser/logins.ts`, ADR 0012): the agent names an
account, the banner shows it, and the password is read only at the user's click.

## Decision

1. **A browser tool `fill_credential`** (`browser/tools.ts`, `browser/actions.ts fillCredential`). The agent passes
   the ref of the form's password field, optionally the ref of the user name field and the account's name (user name
   or e-mail of the entry; not needed when the file has one entry for the site). The app reads the entry at that
   moment and types user name and password into the form with trusted input. The result gives the account's name and
   the field's masked value («•••»). The agent then submits the form itself.
2. **The store is the one the user already chose**: the brain's credentials file (`credentialsFile` in
   `<brain>/brain-settings.json`, a path inside the brain, else `ops/credentials.md`). No other file or store is read,
   and nothing is copied or cached.
3. **A password is typed only where it belongs** (`logins.ts siteCredential`), else the call is refused with the fix:
   - only into a field that is a password field (its value reads back masked in `read_page`, results and screenshots,
     ADR 0237), never into a text field;
   - only on the entry's own site: the host (with port) of the frame that holds the field must be the host of the
     entry's `url`, or of a new optional `loginUrl` for a sign-in page that lives on another host (single sign-on). An
     entry without a url is refused: the user adds it once;
   - never an entry that looks like production: «prod», «production» or «produzione» as a word of the keys that lead
     to it or of its host. Those go through the hand-off, as before. The tool is for test accounts.
4. **After it, the tab does not give the value back.** Until the page is left or reloaded the tab takes no caller
   JavaScript (`javascript`, local stacks) and no copy or cut keys; the password is registered for redaction in logs,
   console lines and network bodies (values of 8 characters or more, `addRedaction`).
5. **Agents are told to use it**: the tool descriptions, the browser's MCP instructions, the sign-in notice after a
   navigation (it names the site's accounts), the reply rule and the refusal of a login hand-off on a local stack all
   point to `fill_credential` and say never to read the file. `type` and `fill_form` still take a password the agent
   was given in its task (ADR 0237 stays in force).

## Consequences

- The agent's context, the tool call, the feed, the transcript and the logs carry the account's name only.
- The owner's entries need a `url` to be usable this way; the «Credenziali» panel says so.
- Limits, by design or outside the app's control: a page that itself shows the password as plain text outside a field
  is not masked; a password shorter than 8 characters is not added to the log redaction (it would blank ordinary
  words), the field masking and the tab's blocks still hold; the production check reads names, so an entry that does
  not say «prod» is typed.
- Untried on the owner's PC with a real test account and with Claude Code's classifier: whether the classifier lets
  the call through is expected (the call carries no secret) but not verified.
- Tests: `test/unit/browser-fill-credential.test.ts` (which entry where, the refusals, what is typed and returned, the
  tab's blocks), `test/unit/browser-tools.test.ts`.
