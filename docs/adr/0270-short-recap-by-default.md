# ADR 0270 · The recap is short by default; the detail on request

Date: 2026-11-12 · Status: accepted (owner, issue #384: «Orchestrator status recap is far too long: default to a 1-3
line summary») · Amends: ADR 0260

## Context

On «come va tutto?» the Orchestrator replied with `app_agents_recap` as it is: about 40 lines, one block per agent with
3 steps each, plus ~35 chats closed in the last 6 hours. The owner found it unreadable and answered «in 2 parole»; the
second, short reply was what he wanted.

## Decision

1. `app_agents_recap` is short by default (`src/main/appctl/agents-recap.ts`): one line per agent that works, waits for
   the user, is in the queue, stopped on an error or just finished, `{mark} {title} — {what}`.
   - What: the question waiting for the user, the current step (or the last one done), the last report.
   - No steps list, no sub-agents, no closed chats; idle and stopped chats are left out, and so is a result (done or
     failed) older than 6 hours: «just finished» only.
   - A delegate waiting for the user, at any depth, makes its root's line «aspetta te» (its question stays the
     parent's, ADR 0083).
   - At most 5 lines (`SHORT_MAX`), then «+ altri N: chiedi il dettaglio per vederli tutti».
2. `detail: true` gives the ADR 0260 blocks unchanged. The tool's description says to pass it only when the user asks
   for the detail; the Orchestrator's rule is unchanged (it replies with the text as it is), so its role text stays
   within its size budget.

## Consequences

- The usual answer to «fai il punto» fits in a few lines, on the PC and on the phone (`isAgentsRecap` still tells it).
- The steps of each agent are one question away («dammi il dettaglio»).
