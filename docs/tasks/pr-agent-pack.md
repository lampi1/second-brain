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

Integration on main 34808a4 (after #43 role-presets, #46 agent-lifecycle, #49 authoring tools, #54 Battito, #55
Orchestrator preset); the stack was squashed and rebased:

1. role-presets: `src/main/agents/presets/` now has one know-how folder per packaged preset id, the ten
   `roleAgentPresets()` ids, `default-orchestrator`, `default-general` and the five legacy seeds still present in older
   catalogs. `test/unit/agent-pack-presets.test.ts` asserts the folders equal those ids and load through the runtime
   lookup (`presetSkills` in `pack/read.ts`), whose id check had refused hyphenated ids (`default-bug-investigator`).
   A learned-rule or pack trial no longer drops `routable: false` from the Orchestrator.
2. agent-lifecycle: the "Da approvare" panel is read-only (proposals plus "Esamina proposta", which opens the agent
   page); it has no keep / retire / trial buttons, and its trial evaluation reads the same `trial` field that
   `resolveTrial` closes. So the decisions stay on the agent page (`AgentPackDetails`), the one place with them, with
   no duplicate controls. Learned-rule proposals (`agent-learn-proposals.json`) are not agent feedback; the one
   `agent_feedback` store in `agent-authoring.json` is unchanged.
3. Battito: not registered. Pulse's `JobScheduler` is private to `PulseService`; its budget (`admitRun`) knows only
   the `pulse` and `headline` jobs (80/20 split), and its runs go through `OneShotService`, which runs a digest with
   "Do not use tools". The learned-rules job must read run histories and call `agent_learn_propose`, so it would need
   a tool-enabled paid run, a third budget share and a public registration API in pulse: not a small, safe change.
   Battito's own `learned-rule` approvals (rules for `default-pulse` appended to its instructions) are unchanged.

Fixes from the fresh-eyes review, each with a regression test seen red first:

- `rejectTrial` (lifecycle) and `authorRollback` (Orchestrator tools) kept the newer know-how when going back to a
  version without it, and did not refresh the editable brain copy, so the next save resurrected rolled-back rules.
  The catalog now reports each know-how swap (`onKnowhowChange`) and the packs republish it once.
- The authoring tools could pass `knowhow` / `pack` in a draft or patch: an automatic write could attach any brain
  folder as an agent's skills or forge a pack identity. They are stripped (`withoutPackFields`).

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
