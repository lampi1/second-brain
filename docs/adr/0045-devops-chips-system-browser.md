# ADR 0045 · A chat's DevOps link chips open in the system browser

Date: 2026-10-14 · Status: accepted

## Context
A chat tile's header shows the DevOps objects the chat talked about as chips (`renderer/lib/devlinks.ts`,
`components/ChatLinkChips.tsx`, 2026-10-13). A click opened the link in a new tab of the internal browser. In the user's
cockpit on 2026-10-14 four clicks in 13 s opened four tabs that the user did not see (behind a maximized chat) and that
landed on the Microsoft sign-in: the internal browser has no DevOps session, the system browser has it. A first fix
(brought the tab on screen and reused it) did not solve the sign-in. The user, 2026-10-14 (through the Regia): the chips
open the system browser, like the question's context links since 2026-10-12 (AskContext.tsx, ADR 0033).

## Decision
- **Chips and their "+N" menu** call `window.open(url, '_blank', 'noopener')`: main's window-open handler
  (`main/window.ts`) hands any http(s) URL to `shell.openExternal` and never opens a window. The chips' URLs are only
  the DevOps web URLs `parseDevopsUrl` accepts (dev.azure.com, *.visualstudio.com).
- **Hidden runs** (SB_HIDDEN: agents, the e2e suite) never open the system browser: the handler records
  `external <url>` in `hiddenOpened`, the same list `app:openPath` records into (`__sbOpened` for the tests).
- **No tab reuse**: with no internal tab, the "same object, same tab" key went away. A message link's peek keeps
  "Apri nel browser dell'app" (a new tab of the user's, brought on screen by `actions.showTab`) beside "Apri fuori".

## Consequences
- One click = the object in the browser where the user is signed in; nothing to sign in to inside the app.
- The agents' own browser tabs are unchanged (ADR 0003): only the user's click on a chip goes outside.
- No new dependency.
