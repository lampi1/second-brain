# ADR 0321 · A routine step can leave the login page as it is (`relogin: false`)

Date: 2026-11-18 · Status: accepted (owner, issue #434: «the routine browser signs in again as soon as a page lands on
the login page, so a step cannot check what a signed-out user sees … let a step observe the login page, no forced
re-login»)

## Context

The routine browser (`packages/routine-runtime/src/browser-mcp.ts`) signs in by itself, host side, with the package
credential, and signs in again whenever a page lands on a login page. That is right for almost every step and wrong
for one kind of test: «sign out in one tab, reload the other: the login page must show». The runtime signed in again
before the step could read the page, so the test could never pass or fail on what the user sees.

The issue was written against the runtime the owner runs, built from the branch `feat/routine-park` (23 browser tools,
parked runs, deployment leases, DevOps writes), which never entered `main` when the public history restarted. The
change is made on that runtime, so this ADR also brings it to `main`.

## Decision

1. **Per call, opt in.** `navigate`, `history`, `click`, `press` and `click_at` take `relogin: false`. In that call the
   runtime never signs in: `navigate` opens the URL as the site serves it now (the login page itself included), and a
   page that lands on a login page after the action is left there. Default unchanged: logins are done for the step.
2. **The reply says so.** When such a call leaves the page on a login page, its reply ends with one fixed sentence
   (`LEFT_ON_LOGIN`): the step knows what it sees and that the next call without the flag signs in again.
3. **One call only.** The flag is not a mode: it is read at the start of each call and dropped at its end, so a step
   cannot stay signed out by mistake and the following steps find the browser signed in as before.
4. **Read, never scripted.** `snapshot` reads the login page (password values are already shown as `***`);
   `screenshot` empties every password field before the PNG and refuses when it cannot; `eval` keeps refusing login
   pages and pages with a held password; `type` keeps refusing password fields. The declared origins hold as always.
   The session still never sees a password.
5. **The runtime of `feat/routine-park` is on `main`.** Ported as its commits, rebased on the public history. Its
   real-browser test (`browser-widgets.test.ts`: a Chromium and a local port) is left out, as `main` already did with
   the other real-browser tests; the new behaviour is tested on a fake page.

## Consequences

- A sign-out or expired-session test can be written as a routine step; the authoring guide says how
  (`docs/routines/authoring.md`), and the Orchestrator's model of the browser names the flag
  (`src/main/flows/capabilities.ts`, `package-tools.ts`).
- An agent that passes the flag where it is not needed loses nothing: on a signed-in page the call behaves as before
  and the reply carries no note.
- Tests: `test/unit/routine-runtime/browser-relogin.test.ts` (no browser, no port, no timer).
