# ADR 0323 · A routine package can run a work item again: retrigger tags and entries

Date: 2026-11-18 · Status: accepted (owner, thread «Riavviare routine con tag retrigger»: «let a routine package
re-run a work item it already handled, when a "retrigger tag" is set on it, starting from a chosen step») · Amends:
ADR 0175 (items 7, 9 and 17: the trigger's dedup, the single start, the `routine` command)

## Context

Two things stopped a package from handling the same work item twice.

1. **The trigger's dedup was for ever.** `trigger.ts` records every started item in the runs root's `trigger.json`
   and never starts it again, whatever happens to the item later. A bug fixed by a run and sent back by a tester could
   only be run again by hand.
2. **A package had one way in.** A run from the watch always started at the first step. `--from-step` existed only on
   a manual `routine run`, so a "retest" could not skip the analysis and the fix.

## Decision

1. **`trigger.retriggerTags: string[]`.** At each poll the loop reads the tags of the items it already started (one
   batch read per 200 items, `System.Tags` only). An item starts again when one of the tags is on it, its last run is
   over (`done`, `needs-human` or `failed`) and the usual caps allow it (`maxPerHour`, `maxActive`, the work item and
   workspace locks). The item's state and other tags are not asked again: it only has to be one this package started.
   A `cancelled` or `running` run is not over: it is resumed by the watch as before, never replaced. Without the tag,
   or without the option, nothing changes.
2. **One tag, one run.** The new run records the retrigger tags it took (`run.json` `retrigger`) and takes them off
   the work item before its first step, with a `tags` write through the write adapter (`executeWrites`: the run's
   ledger, verified on DevOps). So `devops.ops` must include `tags`; the preflight says so. The removal is an event of
   the run (`write`, step number 0), a ledger entry and a line of `report.md`. As for every DevOps write, a refusal
   does not stop the run. An item whose run still holds a tag it could not remove **does not start again**: the watch
   tries the removal again at each poll (`settleRetrigger`, five tries in all, then it only looks whether a person took
   the tag off). Any run that starts on an item carrying a retrigger tag takes it: a first run and a manual
   `routine run` too, or the same tag would start the item a second time.
3. **A crash never doubles a restart.** As for a first start, the subject is saved before the run starts: here with
   the run it follows (`restart.from`). At the next poll a run that names that previous run is taken as the item's run;
   if none was made, the item is as before and its tag starts it once.
4. **`routine.entries: [{ name, when: { tag }, startStep }]`.** The first entry whose tag is on the work item decides
   the first step; the steps before it are recorded as skipped, as `--from-step` does. No match, or no entries, is the
   entry `default` (the first step, today's behaviour). `watch` and `run` both choose from the work item's tags, read
   when the run starts (`runtime.startFor`); a work item that cannot be read starts nothing rather than starting at the
   wrong step. `routine run --entry <name>` names the entry; `--from-step` still wins for the first step.
5. **What a step gets.** In a package that uses either option the run has the input `entry` (`{{entry}}`,
   `ROUTINE_ENTRY`) and, when the work item has an earlier run in the same runs root, `previousRun` (`{{previousRun}}`,
   `ROUTINE_PREVIOUS_RUN`): that run's folder, with a prompt section that lists its steps, their folders and their
   summaries. The two names are reserved in such a package. **Read only by instruction, not by the system**: the
   prompt says never to write there; a session runs as the same OS user (the same limit as ADR 0175 item 19), and
   locking the folder would break a later `routine resume` of that run.
6. **Rules checked before a run or a save** (`preflightRoutinePackage`, so `app_routine_save` too), each with its
   field and fix: `startStep` is a step id; entry names unique and not `default`; one tag, one entry; entries need a
   work item and an organization; a retrigger tag is neither in `includeTags` nor `devops.downgrade.addTag` (it would
   start the item again at once); `tags` granted; a retrigger tag that chooses no entry is a warning (the whole
   routine runs again).
7. **A retrigger replaces a parked run.** The new run becomes the item's run in `trigger.json` (the earlier ones are
   kept in `previous`), so a later `@AI` comment no longer resumes the parked one.

## Consequences

- A package without the two options makes no new read and no new write; its run record, inputs, prompts, session
  environment, first event and `trigger.json` entry are as before (pinned by
  `test/unit/routine-runtime/retrigger.test.ts`).
- A package with retrigger tags costs one more DevOps read per poll for every 200 items it ever started.
- Every guard stays: one watch per routine (the watch lock), one run per work item and per workspace (the locks),
  `maxActive`, `maxPerHour`, the attempt fence.
- Not done: entries chosen by anything but a tag (a state, a field); a real read-only mount of the previous run.
