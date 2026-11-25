# ADR 0364 · Safe reads are read as whole lines: loops, functions, chains, PowerShell pipes, a script's own folder

Date: 2026-11-25 · Status: accepted (issue #485: «bring these false prompts down to zero») · Builds on: ADR 0254 (everything
passes but the brain's rules), ADR 0294 (a permission reaches the user only for a rule or a limited role) · Amends: the
read-only classifier of issue #93 (`agents/tool-policy.ts` `readOnlyCommand`)

## Context

- Most commands pass the app's gate in a few milliseconds. A chat that may only read (a role card limited to «Chiede
  conferma» or «Solo piano», a child of a chat in plan mode, a role with read-only commands) lets through only what the
  read-only classifier calls a read, and the classifier took one command at a time: any `;`, `&&`, `$`, `{` or `>` made the
  line «not a read», so the request went to the user's panel.
- The app logs showed three kinds of safe local commands reaching the panel: a bash `for` loop over a variable (`$b`) and an
  inline function (`Q(){ … "$1" … }`) that Claude's own static checks could not verify, PowerShell tool calls that pipe
  readers through `Select-Object` or `Format-Table`, and a brain skill's script run by OpenCode from the brain while its chat
  works in another repository (its tool names the folder in `workdir`; the classifier looked in the chat's folder).

## Decision

1. **A line is read as the steps it runs** (`agents/command-steps.ts`): a chain (`&&`, `||`, one per line, and `;` where the
   tool says bash or PowerShell; never `;` for a tool that may run cmd, where it is no separator), a bash `for NAME in …; do
   …; done` over plain values, a bash function defined and called on the line (its `$1`…`$9` written in), a `cd` to a plain
   folder, a whole line of comment, and the redirections that only throw output away (`2>&1`; bash `/dev/null`; PowerShell
   `$null`, `nul`). Each step is then checked by the old strict one-command check, unchanged.
2. **What the reader cannot follow stays the user's call**, as before: a substitution or heredoc anywhere, a background `&`,
   a nested loop, a loop over an environment variable's name (`PATH`, `IFS`: upper case and the proxies refused), a value or
   argument that is not plain text, `$@`, a defined function used anywhere but at the head of a step, a function never
   called, a `cd` inside a loop or function. A comment runs to the end of its line whatever quotes it holds; a function
   name is compared as the shell looks it up (`ca""t` is `cat`); a discarded redirection ends where its word ends
   (`>&2pwned` is a file). PowerShell's typographic quotes are refused, and so, for a tool that may run cmd, `^` before a
   quote or `&|<>` and a single-quoted stretch holding `&|<>` (cmd has no single quotes).
3. **A `cd` moves where a declared script is looked for** only when it cannot have failed or wandered: `cd x && …` (not
   after `||`) to an absolute folder or one from here (`./`, `../`; a bare name may go through CDPATH; a drive letter under a
   tool that may run cmd, which needs `/d`); otherwise only an absolute script path counts.
4. **PowerShell's readers and pipe cmdlets** (`Select-Object`, `Where-Object` in its plain form, `Sort-Object`,
   `Format-Table`, `ConvertFrom-Json`, `Get-Process`, …) are readers, by their full names only: a short alias (`gm`, `ft`)
   may be another program under bash. A script block or a variable is still refused.
5. **A command's script is read from where the command runs** for every engine's `Shell` and `Command` tool (`cwd`,
   `workdir`, `working_directory` of the tool's input), not only Antigravity's. Claude's Bash and PowerShell have no folder
   of their own, so a key added there is ignored; two different folders named make the folder unknown.

## Consequences

- A limited chat's loops, functions, chains and PowerShell pipes that only read run with no panel; what writes, and every
  rule of the user's brain, is unchanged (the brain's rules and the three writes that always wait are read before and after
  this classifier, ADR 0355).
- Known gap: a PowerShell line with its own variables (`$x = …; $x.name`) still asks.
- Pinned by `test/unit/agents/command-steps.test.ts` and `test/unit/chats/false-prompts.test.ts`.
