# ADR 0355 · A contract's tools never limit what a delegated chat may run; three writes wait for the user

Date: 2026-11-24 · Status: accepted (owner, 2026-11-24: «risolvi subito sto problema definitivamente», issue #472) ·
Amends: ADR 0254 (in a delegated chat the app keeps three writes for the user, also where no rule of the brain does),
ADR 0347 (no permissions: the contract was the last thing that narrowed a role) · Keeps: ADR 0290, ADR 0345

## Context

`contract.tools` of `agent_delegate` was stored as the child's policy. A part that only reads, given
`read, shell-read, web`, then asked the user for every command the app could not prove to be a read: a cloud CLI read, a
loop, an inline script, `cd … && ls`, `git -C`. The gate stopped at the class before it read the brain's rules, and
logged no reason. ADR 0347 says every role has every tool, so a longer list of allowed reads would have kept the wrong
limit.

That narrowing was also the only thing that kept a database write, a production release or a cloud write waiting in such
a chat when the brain has no `permissions.json`: `autoPermit` then allows everything. Removing it alone would have
opened them.

## Decision

- **The child's policy** is its role's below its parent's (`belowParent`: tools, ceiling, the user's own plan mode). The
  contract's tool classes only choose its folder: shared, or its own worktree (`prepareDelegation`). A class beyond the
  parent's or the role's is still refused.
- **Three writes always wait for the user in a delegated chat** (`chats/delegated-holds.ts`): a write on a database, a
  production release, a write on a cloud account. Read after the brain's rules, which may only refuse more; on the
  native path and in Code Mode, on every engine that asks the gate. A cloud or database client passes only when its
  words are known to read; a database on this machine is free. Code the app cannot read (encoded, fetched into a shell,
  a command with no line) waits too. No «always», and no answer from the phone. It holds every delegated chat, also one
  with no `contract.tools`: naming fewer tools must not be the stricter choice by accident.
- **How the text is read** (`chats/shell-commands.ts`, `cloud-verbs.ts`, `sql-writes.ts`): a command is split with its
  own shell's quotes (a tool that does not name its shell is read as both); text that is only printed or searched is
  left out unless it is then run. A cloud program's verb is taken where that program has it, never from a service's
  name or a flag's value. A script on disk is read one level deep, with its caller's arguments in place, through every
  check a command gets; a script whose first word asks for a read passes, unless it hands its words to a cloud program
  or they carry a write. A statement is judged without its comments and strings. A connector to a database is judged on
  every text field, another one on what begins like a statement. Where quotes do not close, the whole text counts.
- **Stored chats**: at load a delegated chat's stored tools become its parent's (`widenDelegated`); its ceiling stays. A
  damaged policy, a chat whose parent is gone and the API engine keep what they have.
- **Every request the gate leaves to the user logs a reason** («the gate leaves a request to the user»).

## Consequences

- A child that shares its parent's folder may now write in it: the contract says what the part needs, the role's
  instructions and the parent's contract say what it may do.
- The hold is a net over the text the app can read, not a wall. Known gaps, not seen: a compiled program; an npm script;
  a script run by another script; a script built at run time; a database function that writes when selected; a query
  service that runs its statement elsewhere (`start-query`); a statement in a variable the app cannot resolve next to
  another that reads; `$1` after a conditional `shift`, inside a function, or in a variable assigned twice (unknown,
  so judged by the rest of the line); a program that writes under a name no list here has; «this machine» is judged on
  the whole line; a website driven in a browser; whatever an engine runs without asking the gate (the user's own allow
  rules, a sandboxed Codex command).
- Text that looks like one of the three may wait without need (a file or a path that names both a release and
  production, given to a program not known to read; a client called with no statement); the log says which and why.
- A chat that is not delegated is as before: the brain's rules alone decide (ADR 0254).
