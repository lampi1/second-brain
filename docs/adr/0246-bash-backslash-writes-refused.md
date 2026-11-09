# ADR 0246 · A Bash command that writes text with backslashes is refused

Date: 2026-11-09 · Status: accepted (owner, issue #342, «risolvi tutte le issue aperte») · Builds on: ADR 0243 (the
fixed core is the only rule text loaded)

## Context
The brain's rule 5 says text with backslashes (paths, regex, `\n` in code) goes into files through Write/Edit, never
through Bash. Git Bash on Windows turns `\\` into control characters or drops escapes. The rule is loaded in every run,
yet agents broke it 3 times in 4 days in the owner's error log: a JS file written through a heredoc stopped compiling,
a `node -e` replacement applied only partly, a regex edit through a node heredoc silently wrote nothing.

## Decision
- The app's PreToolUse guard (`rules/guards.ts`) refuses a **Bash** command that writes a file and carries a backslash
  (`rules/bash-backslash.ts`): `node -e` / `python -c` with a write call, a heredoc into a file, `tee` or an
  interpreter, `sed -i`, `perl -i`. The reason tells the agent to use Write or Edit.
- Commands that only read (`grep 'a\\b'`, `rg`, `sed -n`, `git`) and the same writes without a backslash pass.
  PowerShell is not Bash and is not checked.
- **Read as a shell reads it.** Each line is checked on its own, with its quoted strings blanked, and a tool counts only
  in command position: a heredoc line writes when it redirects into a file or pipes into `tee`, and an interpreter
  heredoc, here-string or `-e` / `-c` program only with a write call (printing to stdout is not one). So a `gh` or
  `git` body with a Windows path, a title that says "node", and a search for `sed -i` pass.

## Consequences
- An agent that tries the old way gets one refusal and retries with Edit; no file is half-written.
- A legitimate Bash write with a backslash (rare) has to go through Write/Edit too.
