# ADR 0272 · Esegui commands are checked before the user sees them

Date: 2026-11-12 · Status: accepted (owner, issue #388: «Pre-check Esegui commands before showing them; send broken ones
back to the worker») · Amends: ADR 0239 (a command asked once), ADR 0259

## Context

In two days five Esegui commands failed before they started: three times the same `bash.exe` path that does not exist
on the PC, once an interactive bash with no stdin, once a `<commit>` placeholder left in. A rule in the brain about the
right form did not hold. Each one cost the user a run, a failure and a new round with the agent.

## Decision

1. Before a block becomes a «Comando da eseguire» (`src/main/run/asks.ts`), the app checks it
   (`src/main/run/precheck.ts`):
   - `src/shared/command-check.ts` (pure): on Windows a leftover `<name>` placeholder (outside comments, quoted text,
     here-strings and match patterns, or a quoted `"<name>"` alone; in bash `<` is a redirection); a shell or
     interpreter started with nothing to run (`bash -l`, `wsl`, `powershell -NoExit`…) and `Read-Host` /
     `Get-Credential` / `pause` as a command; a program or script the block starts (the command itself, after `-File`
     or an interpreter) at an absolute path that does not exist (`%VAR%`, `$env:VAR`, `~` expanded; other variables,
     WSL and bash POSIX paths skipped); a relative script the block's first command starts, missing from the chat's
     folder, when the block never changes folder. A path named earlier in the block is never checked (it may make it).
   - On Windows, a parse of the block in Windows PowerShell 5.1 (`Parser.ParseInput`, the block passed as base64);
     powershell.exe missing or slower than 8 s = no problem found.
2. The blocks of one reply are checked together: the good ones are shown, the broken ones go back to the chat in one
   app message (`CHECK_LABEL`, «controllo di
   Esegui», shown folded like a run's result), with the command, the reasons and «correggilo e riproponilo». It does not
   count as the chat going on for its other open commands. It waits while the chat works or waits on its own question
   (as a run's result does); if it cannot be sent, the blocks are shown with their problems.
3. After 3 returns in a row from one chat (`MAX_BOUNCES`), its next broken block is shown anyway, with «⚠ Potrebbe non
   partire: …» on the card: the loop never burns tokens without end. A block that passes, or the user's own message, resets the count.
4. Only the real app checks (the chat service can write to chats); the demo shows blocks as before.

## Consequences

- The user only sees Esegui commands that can start, as far as these checks see; a command that fails while it runs
  (a wrong argument, a failing test) still runs and its result goes back as before.
- A good command waits for the check: immediate off Windows, up to the PowerShell start (about half a second) on Windows.
- Untried on the owner's PC: the parse error text comes in the language of his Windows.
