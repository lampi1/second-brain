# ADR 0363 · One concept, the Plan: it replaces the project maps and the work maps

Date: 2026-11-25 · Status: accepted (owner, 2026-11-25: «sostituire le mappe dei progetti e le mappe di lavoro con un solo
concetto, Piano»; «la voglio in percentuale, l'avanzamento»; «devono essere veramente fighi i piani, che sia chiaro i passi
parallelizzati, e anche i prompt dello stratega devono favorire la parallelizzazione, sempre con la massima qualità e con
criterio») · Supersedes: ADR 0271, 0276, 0301, 0302, 0307, 0316, 0322, 0326, 0330, 0335 (the project maps) and ADR 0342, 0343
(the work maps) · Builds on: ADR 0344 (doubts and the question ladder), ADR 0346 (a plan names a preset, never a model)

## Context

- Two things said «mappa» and overlapped: the project maps (a project drawn in place of its code, in the brain) and the work
  maps (one per Strategist job). Both held steps, both had statuses, both had a page, a tool and a set of tests.
- The same steps were kept in two places and told two stories. A project map said «ok» for what an agent only reported; a
  work map blocked a step when its chat was closed, so a plan closed with one step blocked and five never started could read
  as finished work in one place and as a failure in the other.
- «Riprendi» could open a second Strategist for a job that already had one; a partial save through the old tools could drop what
  it did not name; the live state depended on the chats being open.

## Decision

1. **One concept, the Plan** (`shared/plan.ts`, `userData/plans/<id>/plan.json` + `history.jsonl`): title, goal, why, an
   editable project, steps, decisions and doubts, constraints, files and links, the chats that work on it, and its versions.
   Only the 3D brain map stays a map: its own entry in the menu, between Log and Chess. «Collegamenti» (links and notes of the
   brain) is a page of its own.
2. **Steps** (`shared/plan-steps.ts`) have an id, a state (da fare, in corso, bloccato, fatto in parte, fatto, annullato, and
   da verificare for what no proof backs), the steps they wait for (`after`), what they touch (`touches`), an estimate
   (`minutes`) and a proof. «Fatto» needs a real outcome and its proof (what was run, read or seen). The percentage is `done`
   one and `partial` one half, never 100 until every step is done. «Aspetta te» is a signal beside the state, not a state.
3. **Closing a plan or losing a chat never changes a step.** The Strategist's final report ends the plan (`finishPlan`) and
   leaves every step as it was; a chat that is closed, removed or gone leaves its step as it was and the live status says so.
4. **Every save is a version; a save changes only what it names** (`shared/plan-edit.ts`: add, set, move, remove, cancel,
   done, import; atomic: a bad operation refuses the whole save). Taking something away is an explicit action. Deleting sends
   a plan to the trash (`deletedAt`), one click restores it; only the user deletes for good. One active Strategist per plan.
5. **«Riprendi»** goes to the plan's own chat, or the one it went on in, and starts a Strategist only when there is none; a
   second click while one starts is refused. It works with every chat closed and after an update, and says when the state
   and the proofs disagree.
6. **Parallelism is a property of the plan**: a Strategist says for every step what it waits for (`after`, [] = it starts at
   once) and what it touches. The steps with nothing to wait for run together; the app refuses a plan whose parallel steps
   touch the same thing, refuses a delegation of a step whose steps have not ended, and refuses a call that leaves a ready step
   out (`stepGate`). The flow text (`PARALLEL_RULE`) asks for as much real parallelism as there is, keeps the review of the
   whole, and does not split what one head must hold together.
7. **One tool, `plans`** (`main/plans/tools.ts`): list, search, read, create, edit, replan, merge, split, project, approve,
   keep, start, stop, resume, archive, delete, restore, compare. The Orchestrator acts on every plan. A Strategist reads all of
   them, edits its own, and on the others says to the Orchestrator what it would change. The user's decisions (approve, start,
   stop) stay the Orchestrator's, with the same authority as before. `app_project_map` and `project_map_*` are gone.
8. **The page «Piani»** (G B): groups Aspettano te, In corso, Fermi, Idee and Finiti (closed by default); search and project
   filter; a row says title, state, «2 di 6» with the percentage, the next step, who and the last update; inside, a clean list
   of steps in turns, the steps that run together side by side, and the tabs Passi, Dubbi e decisioni, Storico and Chat.
9. **Migration at app start** (`main/plans/migrate.ts`, the only reader of the retired formats): the old files are copied with
   a fingerprint of each and the copy is checked; the plans are written in a folder of their own and moved in together; the
   old files are never touched; it is repeatable (a record already named in a plan's `from` is never made twice); a failure
   leaves the old data and the plans already there as they were and the app starts with a notice. A step called done with no
   readable proof is «da verificare». The counts before and after are in `plans/.migration.json`.

## Consequences

- The project map folders in the brain stay where they are (`legacy-map.json` beside the plan keeps what a plan has no place
  for); nothing writes them any more.
- A test (`test/unit/no-old-maps.test.ts`) fails if anything names the old maps again, except the migration reader, the
  historical ADRs and the changelog.
- The old tests of the steps were rewritten for the new model (`test/unit/agents/strategy-steps.test.ts`, `plans/*`), not
  removed; the five guarantees have their own tests: a closed plan keeps its steps, «Riprendi» opens no second Strategist, every
  chat closed and a restart resume at the right step, a partial save deletes nothing, the migration runs twice and survives a
  failure.
- README screenshots of the old maps were removed until the shots are taken again.
