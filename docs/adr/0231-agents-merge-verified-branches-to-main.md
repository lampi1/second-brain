# 0231 — Agents merge verified branches into main

Date: 2026-11-07. Status: accepted (the owner, yes in a decision panel, 2026-11-07). Partly supersedes ADR 0061
("Agents still never push"), ADR 0074 (push in "Agents still never promote, roll back, push or publish") and the
rule 8 reference in ADR 0080.

## Context

Until now repo rule 8 kept pushes and merges with the owner: every finished branch waited for his click, also when
its checks and reviews were green. The owner decided that the app's work, today's and future, reaches `main` without
his approval: «tutte le attività dell'app sia di oggi che future devono mergiarsi su main anche senza la mia
approvazione».

## Decision

- An app chat may merge its branch into `main` of this repository and run `git push origin main` without asking, only
  when, on the exact commit pushed: `npm run check:quick` and the e2e specs of the touched part are green, a visible
  change looked at in the dev app (owner, 2026-11-08: this branch gate replaces `check:branch` before a merge); the
  rule 9 reviews (an independent Sentinel per touched dimension) have no open findings; the guard scan and the
  pre-push hook pass on every pushed commit.
- One e2e run at a time on the machine, behind a shared lock file in the temp folder.
- Fast-forward only: if `main` moved, the branch is rebased and checked again.
- The full `npm run check:branch` runs on `main` once after a batch of merges, by one dedicated chat; whoever's
  change breaks it fixes it on `main`.
- The full `npm run check` (e2e) stays the Orchestrator's on `main` after the merge.
- Never a force push, a token, a pull request on the owner's behalf or another remote; other repositories keep their
  own rules.
- «Aggiorna», `npm run promote`, publishing and restarting stay the owner's clicks.

Full text: `docs/agents/rules.md` section 8.

## Consequences

- Finished work no longer waits for the owner; the conditions above are the only gate.
- The app's permission layer still asks before `git push` (ADR 0103) and the harness settings of the owner decide
  whether a push runs unattended: changing them stays his.
- An e2e regression can reach `main` before the Orchestrator's full check; it reaches the owner's stable copy only
  through his «Aggiorna».

## Amendment, 2026-11-08

The owner asked to let every branch finish without the e2e specs. The gate loses the e2e specs and the machine lock: `npm run
check:quick`, a clean Sentinel and the guard (docs/agents/rules.md rules 7 and 8). The e2e suite runs only when the
owner asks. The Orchestrator's runtime frame now references section 7 rather than repeating the superseded gate;
the post-batch main check is the non-e2e part of `npm run check`, not `check:branch`. A narrower current assignment
(for example, owner-only pushes) still takes precedence over this repository default.
