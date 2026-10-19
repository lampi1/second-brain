<!-- Decision record: every role has every permission by default and the user narrows it from the role's card; the
brain's declared read-only node tools; agent_report from a root chat; skill-tool warnings at launch (issue #93). -->
# ADR 0085 · Every role may do everything by default; the user narrows it from its card

Date: 2026-10-19 · Status: accepted (owner, 2026-10-19 evening: «di default devono essere attivi i popup e i permessi
tutti hanno tutto all'inizio di default e l'utente può modificarli facilmente dalle card degli agenti ma tutti hanno il
permesso di tutto seppur mantengono ruoli definiti»; issue #93) · Changes: ADR 0083 §1 (each role's default tools and
ceiling), §3 (the planners' launches, `launchGap` as a rule for the defaults) · Builds on: ADR 0083 (roles,
delegation), ADR 0082 (role changes as versions), the security baseline (AGENTS.md rule 2)

## Context
ADR 0083 shipped each role with a narrow default policy: a Scout with read-only commands and a `default` ceiling, the
Judge and the Router in `plan` with only `read`, an Artisan capped at `acceptEdits`, the planners allowed to launch only
Scout and Judge. On the owner's machine this meant refused calls (a Scout's `node tools/my-tasks.mjs` refused as
`commandReadOnly`, issue #93), roles that could not do a natural task (a Herald with no Write and no shell asked to open
an issue), and a flood of permission popups: a ceiling clamps the user's own mode, so a user who runs Claude in `auto`
or `bypassPermissions` got `default`-mode prompts for every edit and command in a Scout or a Sentinel chat. A role's job
is in its instructions, skills and launches; the narrow policy added friction, not safety the owner wanted.

## Decision
1. **Full defaults** (`shared/roles.ts`): every role, the Orchestrator included, has every tool class (`ALL_TOOLS` =
   `TOOL_CLASSES`) and no ceiling (`ceiling: null`: the run takes the user's own mode, the chat's choice or the engine
   settings', up to the most permissive the app runs). The role keeps its name, instructions, skills, model tier and
   launches. Pulse (background, not a role) keeps no tools. A role on the API engine reads only (it has no tools).
2. **Launches restored**: the Strategist launches Scout, Artisan, Sentinel, Herald, Judge, Scribe; the Router the same
   plus the Strategist; the Herald and the Scribe launch a Scout. The planners' and the Orchestrator's instructions say
   so; a part refused because the user narrowed the parent still goes in the report as a ready contract.
3. **Narrowing stays**: a child never gets more than its parent (`belowParent`, `narrowest`, the role gate's
   `aboveParent`), `launchGap` refuses a launch whose child needs a class the parent lacks, the Skill-prefix check, the
   engine sub-agent rule (Explore only) and the production-action rules are unchanged. With the defaults all of it is a
   no-op; it bites only below a parent the user narrowed.
4. **The permissions card** (`renderer/components/RolePermissions.tsx`, on the role's page, linked from the card back's
   "Modifica permessi"): a switch per tool class in two groups (Leggere, Agire; a narrower class under the wider one that
   includes it, shown "inclusa in …" while the wider is on), the ceiling as four choices (Nessun limite · predefinito,
   Accetta modifiche, Chiede conferma, Solo piano), each with a HelpTip saying what it allows, a status pill («Tutto
   consentito» or «Ristretto · n di 11 strumenti · limite …»). Saving is a role edit (`agents:save`): a version like any
   other, `userLocked`; "Ripristina predefiniti" saves the defaults. The card is a list of sections
   (`PERMISSION_SECTIONS`) over one draft, so a further permission (a role's MCP servers) is one more section. The role
   editor no longer carries tools and ceiling.
5. **Migration** (`agents/role-migrate.ts`, at catalog start): a role the user never edited (not `userLocked`, last
   written by the default or the maintenance, no trial) whose tools, ceiling and launches are exactly ADR 0083's
   defaults (frozen there) moves to the new ones as a version by the default, "Permessi completi predefiniti (ADR
   0085)"; its text too where it is still ADR 0083's text (a maintenance lesson is kept). Anything else is left alone.
   Running chats keep the policy they started with. A new Orchestrator the user starts (Ricomincia, Cambia motore) runs
   its role as the catalog says now, not narrowed by the chat it replaces.
6. **The unauthenticated mount stays read-only**: a chat opened through the plain `/mcp/app` mount (any local process)
   was bound by the Orchestrator's policy, read-only in `plan` by default; with the Orchestrator now unrestricted it is
   bound by `narrowest(Orchestrator, FAIL_CLOSED)` instead, so it still reads only, in plan mode.
7. **Issue #93**:
   - *Declared read-only tools*: `read-only-tools.md` at the brain root lists node scripts (`- tools/my-tasks.mjs: …`,
     relative to the brain or absolute, `.mjs .cjs .js`, existing files only). Under shell-read, `node <script> [args]`
     reads when the script's real path (links resolved, from the chat's folder) is one of them; no node option may come
     before the script (`-e`, `--require`, `--import` run other code), no glob, and every other rule of the classifier
     holds (no chaining, redirection, substitution; a pipe only into a reader). Any other node use is refused as
     before (`agents/read-tools.ts`, `tool-policy.ts readOnlyCommand`). The list is the user's: the role gate refuses a
     role's Edit/Write of it (`sys.readToolsList`).
   - *agent_report from a root chat*: a chat the Orchestrator opened with `app_create_chat` (run started by the
     Orchestrator, no parent) reports with `agent_report`: the result is kept on its run and reaches the open
     Orchestrator as a result message, once per assignment (`ChatManager.reportRoot`). A chat the user opened has
     nobody to report to and is refused, as before.
   - *Skill-tool warnings*: a skill's tool classes come from what the brain model reads in it (allowed-tools, the
     commands its text names, its scripts: `agents/skill-needs.ts`); `app_create_chat` and `agent_delegate` return
     `warnings` for a skill whose classes the started chat's policy lacks, and `agent_catalog` lists `skillWarnings` per
     role for its own skills and the `skills` the caller names. Advisory: never a refusal, never a grant.

## Consequences
- A fresh install asks only what the user's own mode asks; a user in `default` mode still answers each edit and command,
  as in a plain chat. The app's own gates (the Skill list, sub-agents, the child-above-parent rule, production actions
  left to the user) are unchanged.
- What the role gate checks (brain-only edits, the read-only-tools list, read-only commands) is checked only on the
  requests the engine asks about: a request the user's mode or allow rules approve never reaches it (as in ADR 0083).
  The declared tools are trusted to only read: listing one is the user's word for it.
- The demo narrows its Judge (read and web, `plan`) so both states show.
- Tests: `test/unit/agents/role-migrate.test.ts`, `read-tools.test.ts`, `skill-needs.test.ts`, `delegation.test.ts`
  (narrowing under parents narrowed to the 0083 policies, a Strategist launching an Artisan, a root chat's report),
  `test/unit/chats/agent-policy-manager.test.ts` (the mount, a renewed Orchestrator), `test/unit/appctl.test.ts`
  (warnings); e2e `test/e2e/role-permissions.spec.ts` with screenshots of the card dark and light.
