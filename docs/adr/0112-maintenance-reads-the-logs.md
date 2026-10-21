# ADR 0112 · One Manutenzione that reads the app logs and ends in the Orchestrator

Date: 2026-10-21 · Status: accepted (owner, issue #150) · Builds on: ADR 0077 (brain maintenance jobs), ADR 0111 (Log page)

## Context
The «Manutenzione» button ran the brain jobs only, from the Skill, Regole and Memoria pages, and its result stayed in a
dialog. The app's own logs (`userData/logs/app-*.jsonl`) were not part of it: on 2026-10-21 a manual read of two days
found three new app bugs, and the user had to start that read and ask for the issues by hand.

## Decision
- **One place.** The same button is also an icon on the Orchestrator's head, so it is reachable from every page; the
  page buttons stay as shortcuts to the same pass.
- **Logs are a step of the full pass the user starts** (`brainmodel/log-scan.ts`): the warn and error lines written
  since the previous such pass (the first time, two days), grouped by `scope | msg | cause` with numbers folded, a count
  and one sample line each. No LLM. A timer's pass and a single job skip it.
- **Known noise.** «Noto, ignora» on a group writes its key to `userData/maintenance-noise.json`; a known group is listed
  apart and never handed on.
- **Hand-off.** At the end the app sends the open Orchestrator one message, labelled as the app's (never the user's
  consent): each job's result, the new groups with the file paths, and what to do: for each app bug, a Herald reads the
  open and recent issues of the app repository, comments on the one that covers it or opens a new one (cause with log
  lines and file:line, fix proposal, test). Opening or commenting an issue is an external write: the user's permission
  rules apply. With no Orchestrator open the dialog says so.

## Consequences
The pass the user starts may cost tokens (the Orchestrator's turn and the Herald's), unlike before; a timer's pass still
costs none. The dialog shows a «Log dell'app» row and the groups; the e2e is `test/e2e/maintenance-logs.spec.ts`.
