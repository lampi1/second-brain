<!-- Decision record: reusable commands that worked become brain scripts without a manual Orchestrator step (issue #111). -->
# ADR 0096: Scripts are saved where the command ran, not by the Orchestrator alone

Date: 2026-10-20 · Status: accepted (issue #111; owner rule: brain changes apply by themselves, with a log line and a way
back, no approval) · Amends: ADR 0076 point 3

## Context
ADR 0076 gave only the Orchestrator `brain_script_save`. But reusable commands run in work chats (their own shell) or
through the user's "Esegui" button, and the Orchestrator never sees a work chat's content (ADR 0083). On 2026-10-20 a
deploy to a test web app, a local Populator start and the migration of the test databases all ran fine, and no script
was saved.

## Decision
1. **Every chat gets `brain_script_add`** on its own endpoint (`src/main/brain/scripts-tools.ts`): after a script or
   command it ran worked, the chat saves it itself. Add only: an existing name is refused, so fixes and deletes stay the
   Orchestrator's (`brain_script_save` / `brain_script_delete`). Same checks as a save: no credential lines, a changelog
   line naming the chat. `brain_scripts`' description and the Orchestrator's role text say so.
2. **The app saves reusable "Esegui" runs by itself** (`src/main/brain/auto-scripts.ts`, hooked on the runner's end of
   run in `wiring.ts`): a run with exit code 0 whose command passes a deterministic heuristic (not only look-arounds like
   `ls` / `git status` / `cd`; a single command needs at least 3 words and 24 characters) becomes
   `scripts/cmd-<first words>-<hash>.ps1` (`.sh` off Windows), tagged `auto, esegui` (`produzione` when the runner
   flags it), tested ok, logged in the changelog as `app`. No model call: zero tokens.
3. **Never a secret**: a command with anything `maskSecrets` / `secretLine` flags is skipped whole, not redacted (a
   redacted command would be a broken script).
4. **Dedupe and rollback**: the file name carries a hash of the command (lines trimmed, comments out); an existing script
   with the same body under any name counts too. Undo = delete the script (copy kept in `scripts/.deleted/`); a command
   whose script was deleted is never added back.

## Consequences
The Script section fills during a normal day without anyone remembering to save. Auto-saved scripts are verbatim
commands with the run's folder in their description: the Orchestrator may later rename, generalise or delete them.
Commands a chat runs in its own shell are saved only if the chat calls `brain_script_add` (the app cannot see them
without reading their content).
