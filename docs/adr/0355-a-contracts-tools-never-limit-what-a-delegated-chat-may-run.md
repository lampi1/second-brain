# ADR 0355 · A contract's tools never limit what a delegated chat may run; three writes wait for the user

Date: 2026-11-24 · Status: accepted (issue #472; clarified by the owner on 2026-11-25) ·
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
- **Ordinary work runs without a panel.** For a visible call in one of the three families, the app asks unless it
  recognises a read: database access (test and production; local dev is free), a production release, and cloud
  resource access. The brain's rules still decide first; they may refuse more. The gate is shared by the native path
  and Code Mode for every engine that calls it, regardless of `contract.tools`. Existing unreadable-input holds
  remain (for example a missing or truncated command, encoded code or code fetched into a shell). There is no
  «always» and no answer from the phone for these holds.
- **How the text is read** (`chats/shell-commands.ts`, `cloud-verbs.ts`, `sql-writes.ts`): the app splits with the
  command's own shell quoting (both supported readings if the shell is unspecified) and ignores text that is merely
  printed or searched. The verb comes from the position where the client takes its action, not from a flag value or
  an argument that looks like a read. For known REST routes, read evidence is GET/HEAD, or a POST to an explicitly
  recognised Azure query endpoint. Database readers check every visible query, file and literal pipeline input
  separately: one SELECT cannot make a second unknown input safe. The app reads a script one level deep with its
  caller's arguments, so an argument named `status` does not make a restart safe. It can select a literal, single-command
  Bash `case` arm, but it does not generally evaluate branches. A statement is judged without its comments and strings.
  A connector to a database is judged on every text field, another one on what begins like a statement. Where quotes
  do not close, the whole text counts.
- **Stored chats**: at load a delegated chat keeps its saved tool list (`widenDelegated` does not replace it). The
  contract's classes and the role's own limits, including MCP servers, are not stored apart, so a limit is not dropped
  (fail closed), and a chat this version already saved is not widened on a later load. Its ceiling stays. A damaged
  policy, a chat whose parent is gone and the API engine keep what they have.
- **Every request the gate leaves to the user logs a reason** («the gate leaves a request to the user»).

## Consequences

- A child that shares its parent's folder may now write in it: the contract says what the part needs, the role's
  instructions and the parent's contract say what it may do.
- The hold is a text filter, not an execution sandbox. The app does not look inside compiled programs, npm scripts,
  second-level script files, or code built at runtime. It cannot identify a family with no recognisable client, host,
  package or release name in the text it can read. A visible cloud query service whose action launches work rather
  than retrieving results (for example the AWS `start-query` verb) is held; the filter cannot see work delegated on
  the server by an otherwise recognised read, such as side effects of a function in SELECT.
- Conditional `shift`, function-local `$1`, a variable assigned twice, and SQL input through a computed file path can
  stay unresolved. A recognised remote client with an unresolved SQL input is held even next to a confirmed SELECT.
  The local database exception still recognises explicit hosts on the whole line, not the effective connection of each
  process. Pipelines with computed sources and SDK calls through arbitrary aliases are not interpreted. The app also
  cannot inspect browser actions or execution that never asks the gate (an engine's own allow rule or sandbox).
- Text that looks like one of the three may wait without need (a file or a path that names both a release and
  production, given to a program not known to read; a client called with no statement); the log says which and why.
- A chat that is not delegated is as before: the brain's rules alone decide (ADR 0254).
- Known extra confirmation, not decided here: several SQL files in one `-i`, `EXPLAIN` with options, psql `\dt`, and a
  statement piped into psql.
- Known extra confirmation, not decided here: a Resource Graph query sent as POST through `Invoke-AzRestMethod`.

## Verification examples

[`delegated-holds-matrix.test.ts`](../../test/unit/chats/delegated-holds-matrix.test.ts) lists the ordinary work, the
recognised reads, and neighbouring held commands as separate parameterised tests. The earlier holds stay covered by
[`delegated-holds.test.ts`](../../test/unit/chats/delegated-holds.test.ts) and
[`delegated-holds-review.test.ts`](../../test/unit/chats/delegated-holds-review.test.ts). All commands are classified as
text or against fake script files; the tests never run them against a service.
