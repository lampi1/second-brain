Title: feat(agents): portable .sbagent agent packs with reviewed import/export and learned rules

<!-- PR description for the whole agent-pack stack (core -> flows -> ui) merged with main; used by the integrating Orchestrator. -->

Ships ADR 0069 end to end. Agents export as a deterministic `.sbagent` archive, or as Claude, Cursor or Agent
Plugins layouts. Import reviews foreign plugins, skills and packs before anything is written. Every import and export
runs through a main-owned, expiring review: guard findings with fix and rescan, scripts that need explicit approval,
permission and MCP clamps, collision choices and a personal-data decision. The renderer offers dialogs, a window-wide
drop target and an opt-in anonymous results summary. User skill files live in the brain, with immutable version
snapshots and editable copies; direct edits survive saves and approvals. Agents can propose learned rules
asynchronously, and Brother approves, edits or discards them on the agent card (never as a popup). An open editor
whose agent changed underneath stops saving, and offers to keep the draft as a new agent or reload.

Merged with main (a2c5075 and later). Overlapping parts now reuse main's modules instead of duplicating them:

- Probation: a new imported agent enters main's shared probation (`AgentProbation`, `PROBATION_CAP`, daily judge,
  `agents:keep` / `agents:retire`). The pack's own probation field and `agents:probationDecide` are gone.
  `AgentProbation` gains an optional `source: { kind: 'import', packId, revision }`, validated on read.
- Trials: a pack update and an approved learned rule are not new agents. They open a version trial
  (`trial: { version, baseline }`) that Brother ends with the new `agents:trialDecide` (keep, or roll back to the
  baseline). Neither main nor agent-lifecycle had a user decision for trials, and without one a trial would stay
  open forever.
- Preset comparison: removed (`agents:presetCompare`, `agents:presetResolve`, `PresetComparison`, `syncPresets`),
  because role-presets owns it (`presetUpdates` and the Studio "preset-update" comparison). The "Preset" / "Mine ·
  from preset" fork-on-edit badge and the shipped preset skills stay.
- Learned-rules maintenance job: removed. Pulse's JobScheduler is private to PulseService, and the job would start
  paid engine runs. The proposal tool `agent_learn_propose` and the review IPC work without it.

What Integrazione 2 has to reconcile:

1. agent-lifecycle (`../agent-lifecycle`, "Da approvare"): move the card buttons in `AgentPackDetails.tsx` into the
   approval panel. That means probation keep/retire (main IPC) and trial keep/rollback (`agents:trialDecide`).
   Lifecycle's `trials.ts` should read the trial that `AgentCatalogService.resolveTrial` closes; it must not add a
   second trial store.
2. role-presets (`../role-presets`): the pack exports shipped presets from its `agent-presets/default-*` skill
   folders, and role-presets uses ids in `src/shared/agent-presets.ts`. Align the ids. A preset forked by an approved
   learned rule must still appear in `presetUpdates`.
3. Pulse: if a learned-rules maintenance job is wanted, register it through a public scheduler API, with a budget.
   Today none exists.
4. The trial and probation buttons on the agent card are a stopgap until step 1 lands.

Validation on this branch (Brother's decision of 2026-10-18 16:09: branch checks only, full gate and e2e once on
main):

- `npm ci`, `npm run build`, `npm run lint` and `npx tsc --noEmit` pass, also after merging main a120c8a.
- `npm run check:branch` (on a120c8a^, with the CPU at 100% from other sessions): 1913 tests passed and 6 failed.
  Four suites failed on timing or timeouts and pass when run alone; none of them is touched by this branch:
  correction-catch hook, release-writer, file-diff (passes with a 120 s timeout) and default-brain (passes with a
  120 s timeout). The publish guard failed only on untracked scratch files in `tmp/`, which is not ignored in this
  worktree. Limited to the branch's files (`SB_GUARD_FILES`), the guard passes.
- After merging a120c8a: agent, contract and engine unit suites (33 files, 265 tests) pass.
- Preset sync and comparison tests left with the feature (role-presets owns it). The probation and trial tests were
  rewritten for keep/retire/resolveTrial, not dropped.
- `test/e2e/agent-pack.spec.ts` was NOT run here; per the same decision, it runs in the final gate on main.
