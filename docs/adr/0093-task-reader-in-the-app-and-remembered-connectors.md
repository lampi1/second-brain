# ADR 0093 · The Task page's DevOps reader ships with the app; connector verification is remembered

Date: 2026-10-20 · Status: accepted (issue #95) · Builds on: ADR 0072 (a fresh brain starts empty), ADR 0079 (Task
page), ADR 0016 (one DevOps page, read by a brain script)

## Context
The Task page and the Azure DevOps connector both ran `<brain>/ops/tools/devops-me.mjs`, a script that only the
owner's personal brain had. A brain made at setup holds only `me.md`, `brain.json` and `.gitignore` (ADR 0072), so on a
fresh install the connector could never be verified and the page never read anything. Separately, the connectors'
states lived only in memory: a successful Task read did not mark Azure DevOps verified, and a restart reset every
verified connector to "Accesso da completare".

## Decision
- **The reader is app machinery.** `src/main/tasks/devops-me.mjs` (copied by `scripts/build.mjs` to
  `out/tasks/devops-me.mjs`, so every release has it) prints the same JSON as the personal script, from the Azure
  DevOps REST API with the token of the user's own `az` login (read-only: GETs and WIQL queries; the token is never
  stored or printed). `TaskService` runs the brain's own `ops/tools/devops-me.mjs` when it exists (the owner's script
  wins), else the app's. Nothing is written into the user's brain. Organizations: `--org`, `SB_DEVOPS_ORG`,
  `DEVOPS_ORG` in `brain.json`, else every organization of the account (at most 5). Builds and test cases are not read
  by the app's reader (the personal script may add them).
- **A good Task read is a verification.** `TaskService.onRead` announces each read without error; the connector
  service (`observe`) then reads the Azure CLI account and marks Azure DevOps verified with the projects the read saw,
  as "Prova" would. Skipped while a probe runs (the probe started that read and sets the state itself).
- **Verified states survive a restart.** The last good verification (account, time of the check, the projects seen;
  never a credential) is saved beside the project selections in `userData/connector-projects.json` and shown again at
  start. A failed probe, a new sign-in and a disconnect clear it. A disconnect is saved there too (`disconnected:
  true`, nothing else), so after a restart a Task read still does not verify that connector by itself; "Prova" or a
  new sign-in clears the flag.

## Consequences
- A fresh brain gets a working Task page and a verifiable Azure DevOps connector once `az login` is done.
- Settings may show "verified" from the last run although the login has since expired; the next read or "Prova" tells.
