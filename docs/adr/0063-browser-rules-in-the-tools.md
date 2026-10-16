# ADR 0063 · Browser rules enforced by the tools, not only written in the brain

Date: 2026-10-16 · Status: accepted · Source: the owner's decision (16/10: checkable rules go into the app's tools and
hooks so they hold with any model), rules chosen by the agent on the owner's "vedi te"; general model in ADR 0062

## Context
The brain keeps its browser rules in on-demand files the model must choose to read. Weaker models skip them: a Sonnet
chat told the user to open the browser themselves, then opened a localhost tab in an environment other than "local"
(no session there). The brain's error log shows the same family again and again: login hand-offs on a local stack
the agent should sign in to itself, hand-offs without the account (no URL, no Copia password in the banner), sign-in
steps or "fai l'accesso nel pannello" written in chat.

## Decision
Three generic rules, enforced by the app; a violation is **refused with the reason and the exact fix** (owner's
choice: no silent correction, the model calls again the right way).
- **Local stacks live in "local"** (`browser/rules.ts` `envRefusal`, in `tabs_create` and `navigate`): a URL on
  localhost, 127.0.0.1, ::1 or *.localhost loads only in environment "local"; "local" holds only local stacks
  (*.test stays allowed in it: it is a local stack for the password rule too). Other environment names stay the
  caller's choice. A navigate without env is checked against the environment the URL would really load in.
- **Login hand-offs done right** (`loginRefusal`, in `handoff_to_user` kind "login"): the tab must hold a page; on a
  local stack whose test accounts are in the user's credentials file (ADR 0012) the hand-off is refused (the agent
  signs in itself); on a host with entries in that file the agent must name one of them as `account`. Matching is by
  the entry URL's host with port (`Credentials.accountsFor`); a host with no entries keeps today's behaviour.
- **Never "open the browser yourself"** (`chats/reply-rules.ts`): at every turn end the app reads the turn's reply
  (`TurnEndInfo.reply`); a request to the user to open a browser, a local URL, or to sign in by hand in the browser
  gets one labelled app note back in that chat ("open it yourself: tabs_create / handoff_to_user"). Code blocks and
  inline code are ignored (commands for the user are not requests to browse); the agent's own steps ("ho aperto",
  "I'll open") are not matched; at most one note per chat every 10 minutes, so the answer to a note never loops.
- The MCP instructions and the tool descriptions say the same rules, so a model sees them before it is refused.

No brain-specific value is in the code: environments come from the host, accounts from the user's credentials file.

## Not now
Leases on shared environments (a tab on a shared test node only under the chat's lease) need a lease source the app
can read; proposed as the next rule. Other enforceable brain rules found by the review (commands for the user in the
right shell syntax, no nameless `git stash`, worktree ownership) belong to the general model of ADR 0062.

## Consequences
- A model that ignores the brain's browser files is stopped at the call with the fix in the error text.
- `navigate` from a tab of another environment to a local URL is now refused (it was a note): the hint says to pass
  env "local", which opens a tab there.
- The reply check is text matching: rare misses or false notes are possible; the note is labelled as the app's and
  costs one short turn.
