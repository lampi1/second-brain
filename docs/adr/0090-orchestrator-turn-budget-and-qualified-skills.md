<!-- Decision record: the Orchestrator's per-turn workspace budget (issue #98) and the role gate's qualified skill names
(issue #101), both answered in-process through Claude's control protocol. -->
# ADR 0090 · The Orchestrator's turn budget; granted skills by their qualified name

Date: 2026-10-20 · Status: accepted (issues #98, #101) · Builds on: ADR 0083 (roles, delegation, the role gate),
ADR 0085 (every role may do everything by default), ADR 0087 (the quick path) · Changes: nothing in the permissions

## Context
**#98.** The Orchestrator is the user's conversation, but it has every tool class (ADR 0085). On 2026-10-20 it ran
`Grep`, `Read` and `Shell` (`devops-me.mjs`, `gh-issue.mjs`) itself for minutes instead of delegating: it stayed
`running` and the user could not talk to it. Its role text said "never a worker's long task", which was not enough. Its
workspace tools rarely reach the permission prompt (Read, Grep and Glob never ask; with `auto` or `bypassPermissions`
nothing asks), so the role gate (which sees only `can_use_tool`) cannot count them.

**#101.** A delegated child called `Skill("air-qa")` first; the gate refused the bare name (it could resolve to a user
or project skill of the same name) and the child retried as `agent-<hash>:air-qa`. Every launch with a skill paid a
refused call and its retry, because nothing told the child the plugin name, which changes with each launch's content.

## Decision
1. **A per-turn workspace budget for the Orchestrator** (`src/main/agents/orchestrator-budget.ts`). On Claude, the
   Orchestrator's session registers one in-process PreToolUse hook at `initialize` (`hooks.PreToolUse`, matcher `*`,
   callback `sb_pre_tool_use`); the CLI asks it with `hook_callback` before every tool call (`chats/claude.ts`). The
   app answers `{}` (no say) or `hookSpecificOutput.permissionDecision: "deny"` with a reason the model reads. Budgeted:
   Bash/PowerShell, Read, Grep, Glob, LS, edits, WebFetch/WebSearch and any MCP server but the app's own
   (`mcp__second-brain-app__*`, `mcp__second-brain__*`), and starting a sub-agent (`Task` / `Agent`) whose
   `subagent_type` is not `Explore` (a general-purpose one would do the work outside the budget). `ORCHESTRATOR_TOOL_BUDGET` = 3 per turn: a quick read or check
   still runs; the fourth and later calls are refused with "delegate with app_create_chat (scout / herald / artisan /
   sentinel), tell the user in one line, end your turn". The count restarts at each turn's result. A sub-agent's own calls
   (`agent_id` set) do not count. A failing hook never blocks a call.
2. **It is a speed guard, not a permission.** The role keeps every tool class (ADR 0085); nothing is narrowed for work
   roles; the user's permission prompts and modes are unchanged; no settings or hook file is written (the hook lives
   only in the session's control protocol, AGENTS.md rule 6). Cursor, Codex and API Orchestrators have no such hook:
   they get the rule alone.
3. **The rule in the Orchestrator's fixed rules** (`orchestrator-role.ts`, so it reaches every catalog): codebase
   inspection beyond one quick Read, searches, shell commands and scripts, DevOps or CI checks, GitHub issue or PR
   creation and writes through an external MCP server are delegated at once with `app_create_chat`.
4. **Granted skills by their qualified name.** A Claude role launch's instructions carry one line with the qualified
   names (`role-gate.ts qualifiedSkillsLine`: `agent-<hash16>:<name>` for each launch skill, `wiring.ts`); Cursor has
   no Skill tool, so its runtime instructions keep the plain names and the files to read
   (`<skillRoot>/<name>/SKILL.md`, `pack/flows.ts`); the delegation prompt stays engine-neutral and points to the
   role's own list. And the
   role gate rewrites instead of refusing: a bare `Skill("<name>")` of a skill the launch granted is allowed with its
   input field set to `<launch plugin>:<name>` (`GateVerdict.allow.patch` → `HarnessSession.answer(…, patch)` →
   Claude's `updatedInput`), so it always loads the launch's own copy. Only on an engine that runs a changed input
   (Claude); a bare name not granted, another prefix or a launch without a plugin stays refused. The patch is
   main-only: the renderer's `Answer` never carries an input.

## Consequences
- An Orchestrator turn does at most three workspace calls; a longer investigation becomes a visible role chat, and the
  user can keep talking. A wrong refusal costs one tool error the model reads; the budget is one constant.
- No refused first `Skill` call in a delegated chat for a skill its launch granted.
- Pinned by `test/unit/agents/orchestrator-budget.test.ts`, `test/unit/agents/role-gate.test.ts`,
  `test/unit/chats/claude.test.ts` (the fake CLI's `pretool` and `skillgate` turns) and
  `test/unit/agents/delegation.test.ts`.
