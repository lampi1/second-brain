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

1. **Per call, opt in.** `navigate`, `history`, `click`, `press` and `click_at` take `relogin: false` (the tools a
   sign-out test acts with; every other tool ignores it and signs in as always). In that call the runtime never signs
   in: `navigate` opens the URL as the site serves it now (the login page itself included), and a page that lands on
   a login page after the action is left there. Default unchanged: logins are done for the step.
2. **The reply says so.** When such a call leaves the page on a login page, its reply ends with one fixed sentence
   (`LEFT_ON_LOGIN`), and that login counts as signed out: the next `navigate` starts from its login page, as a
   step's first visit does.
3. **One call only.** The flag is not a mode: it is read at the start of each call and dropped at its end (also when
   the call fails), so a step cannot stay signed out by mistake. The next navigation or action without it signs in
   again; the sign-out click itself needs the flag, or the runtime signs straight back in.
4. **Read, never scripted.** `snapshot` reads the login page (a password field's value is `***`); `screenshot`
   empties every password field before the PNG and refuses when it cannot; `eval` keeps refusing login pages and
   `type` password fields. The declared origins hold as always. The session still never sees a password.
5. **The runtime of `feat/routine-park` is on `main`.** Ported as its commits, rebased on the public history. Its
   real-browser test (`browser-widgets.test.ts`: a Chromium and a local port) is left out, as `main` already did with
   the other real-browser tests; the new behaviour is tested on a fake page.
6. **A password `fill_secret` wrote stays unreadable.** The independent review of the port read it back two ways: a
   Backspace in the field leaves a value the masking no longer knows (the accessibility snapshot printed it), and a
   "show password" toggle turns the field into a text field (a screenshot showed it). Now `fill_secret` marks the
   field (`data-routine-secret`), and a marked field is a password field for every tool whatever its type: `type`
   refuses it, only Tab, Enter and Escape are pressed in it (by ref or by focus), its snapshot value is `***`, the
   accessibility snapshot and `eval` are refused while it holds a value, and no screenshot is taken while it shows
   the value in clear, and it is never dragged. A second pass of the review read a password through what an `eval`
   leaves behind: a timer on the page, or a handle to another tab, which survives that tab's reload. So after an
   `eval` no password is written until nothing it left can be alive: `fill_secret` refuses until the only open tab is
   reloaded (`history` reload, with no tab opened meanwhile), and a login closes the other tabs and loads its page
   anew before it types (three tries, then the login is not done); `eval` is also refused while any open tab holds
   a password. Closing is the point: a reloaded tab can be written into again by a tab still alive, a closed one
   cannot. Known limits: a page that replaces the field with a new element on the toggle loses the mark; a tab that
   opens in the instant between the reload and the check is not seen; and `eval` stays a tool that can do what the
   page can, which is why a package allows it only for the steps whose prompt needs it.

## Consequences

- A sign-out or expired-session test can be written as a routine step; the authoring guide says how
  (`docs/routines/authoring.md`), and the Orchestrator's model of the browser names the flag
  (`src/main/flows/capabilities.ts`, `package-tools.ts`).
- An agent that passes the flag where it is not needed loses nothing: on a signed-in page the call behaves as before
  and the reply carries no note.
- Tests: `test/unit/routine-runtime/browser-relogin.test.ts` (no browser, no port, no timer): the host side of the
  flag and of the password guards; the in-page scripts themselves run only in a real browser and have no unit test.
