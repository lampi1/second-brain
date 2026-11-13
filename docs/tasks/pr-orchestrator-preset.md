Title: feat(agents): add default Orchestrator preset

The canonical Orchestrator now starts from a catalog-owned, editable coordination preset (`default-orchestrator`) instead of a hardcoded workflow. Its compact instructions delegate execution immediately, specify complete worker briefs, track workers, demand evidence before completion claims and keep the user conversation. Classifier scores inform worker selection when available; they never imply capability or permission. App-owned boundaries (updater, approvals, app space) stay composed around the editable text in `orchestratorRole()`.

The Orchestrator is still no agent's run: `resolve()` keeps the chat unassigned (routed owner, selected Claude Code / Codex / Cursor engine, model and effort), so no run, metrics or probation start for it. It takes only the preset's instructions and policy. The instructions are snapshotted on the chat (`agentInstructions`), so existing chats stay frozen and new coordinator chats use the latest edit. Legacy coordinators without a snapshot get the built-in instructions. Ordinary worker launches of the preset are rejected, and it is `routable: false` in seeding and restore, so discovery never offers it as a worker.

Seeding is an additive migration next to the pulse preset: added once, history before catalog, existing definitions and v1 files preserved, catalog capacity respected (full catalogs use the built-in text until a slot frees). Corrupt catalogs stay untouched. The origin follows the role-preset shape: `{ kind: 'preset', presetId: 'default-orchestrator', presetRevision: 1 }` (not a `legacy-*` seed). Editing uses the existing v2 semantics: a user-locked behavioural version on the same id, original seed in history.

Design sources, read 2026-10-18:

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): orchestrator-worker decomposition, synthesis, evidence-driven verification.
- [Anthropic: Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system): bounded delegation with objectives, output expectations, tool boundaries and proportional effort.
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) and [OpenAI AGENTS.md conventions](https://learn.chatgpt.com/docs/agent-configuration/agents-md): focused contexts and explicit repository instructions.
- [OpenAI: A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf): the manager owns the user interaction and delegates specialised work.

Merge history: the in-progress merge with #38 (pulse, `routable`) was resolved and committed; origin/main with #39 (agent catalogue overview) and #41 merged cleanly. #39 touches no main-process catalog code; the Orchestrator appears as a card in the overview like any active agent.

Fix found by the full unit run: the original commit made Orchestrator chats owned by the catalog preset, which started an agent run for the coordinator and broke the existing contract in `test/unit/agent-probation.test.ts` ("the Orchestrator stays unassigned"). The code now keeps it unassigned; the branch's own tests were aligned to that contract (`orchestrator-preset.test.ts`, `chats/orchestrator.test.ts`: owner `routed`, no run, preset instructions still used).

Wiring: none. This branch changes no `src/shared/contract.ts`, `src/main/wiring.ts` or `src/main/index.ts`; the merge did not touch them either.

Integrazione 2 must reconcile (role-presets owns the ten role presets and routing; this preset fits that model and does not duplicate it):

1. **role-presets** (`src/shared/agent-presets.ts`, `installPresets()` in `catalog.ts`): keep the Orchestrator seed outside `roleAgentPresets()` (it has no `TaskKind`, is non-routable and must not be pinned to a routed model), or move it into the packaged list with a `presetHash` so revisions flow through `presetUpdates`. Either way: it must not appear in `LEGACY_ROLE_REPLACEMENTS`, keep `presetId: 'default-orchestrator'`, and its seed block stays before `installPresets()` in the constructor. Both blocks touch the same constructor region: keep both.
2. **agent-mcp-policy** (`author()`, `protectedAgent()` in `author-policy.ts`): the Orchestrator must not be able to rewrite its own definition or use it as a base. Add `default-orchestrator` (and `default-pulse`) to `protectedAgent()` and refuse `author({ presetId: 'default-orchestrator' })`; add a unit test for both. Its new `agentVersion` check in `resolve()` sits after the orchestrator branch, so it does not affect coordinator chats. The `manager.ts` hunks (run links, `req.goal`) touch `create()` only and do not overlap with the role composition line changed here.
3. **agent-lifecycle** (b8ded1b, `onRunEnded` in `manager.ts`): no textual overlap. Because the Orchestrator has no run, lifecycle evaluation and feedback never fire for the coordinator; keep it that way.
4. **.sbagent fork-on-edit**: this branch uses the existing save path, no Orchestrator-specific edit semantics. When .sbagent lands, use its common preset fork flow and keep the customised coordinator as the one `resolve()` reads (it looks up `default-orchestrator` by id).

Validation (this worktree, after merging origin/main a2c5075):
- `npx tsc --noEmit` clean; `npx eslint .` clean.
- `npx vitest run`: 2626 passed, 7 failed in the full run. Fixed: `agent-probation` (above). Pass when run alone: `correction-catch-hook` (one timing assertion, 1939 ms vs 1400 ms under load), `file-diff` and `default-brain` (15 s timeouts under load), `release-writer` (Electron asset not yet installed during the run). `publish-guard` flags only the local untracked `tmp/`. Focused suites (preset, orchestrator chat, probation, manifest, agents, versions): 95/95.
- `npm ci` failed with EPERM on a locked `claude.exe`; dependencies were installed with `npm install` (lockfile unchanged).
- No e2e (runs only on main, ADR 0027), no app launch, no visual check.
