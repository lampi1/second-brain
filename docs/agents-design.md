# AGENTS-DESIGN: persistent agents, presets, autonomy, feedback and metrics (SPEC 17)

Owner: chat `ui-agents`. Phase 1 = design only. Read from `orch` (`feat/unified-orchestrator`, fe64f92) and `astra`
(`feat/ui-astra`, 9ea4749 + ~95 uncommitted files). Both branch from main 0d3a298.

## 0. What already exists (build on it, do not replace)

| Piece | Where (orch) | Notes |
|---|---|---|
| `AgentProfile` = name, purpose, instructions, manifest, engine, model, effort, avatar | `src/shared/agents.ts:19-30` | Persisted in `userData/agents.json` `{version:1, profiles, legacyRouting}`, max 64, atomic `writeLocal` |
| `AgentCatalogService`: validate, save, duplicate, resolve-at-launch, AI draft | `src/main/agents/catalog.ts:89-210` | 6 seed roles `default-*` (`catalog.ts:80-87`); `resolve()` refuses engine/model drift |
| `AgentOwnerSnapshot` frozen per chat (`revision` = profile `updatedAt`) | `agents.ts:32-36`, `catalog.ts:60` | `StoredChat.agent` + `agentInstructions`; instructions injected once with "profile grants no permissions" (`manager.ts:583`) |
| Avatar: 7 symbols or validated raster | `agents.ts:15-18`, `catalog.ts:37-58` | No SVG/URL ever reaches the renderer |
| Per-agent analytics read model (cost, tokens, timing spans, cohorts, insights with confirmation basis) | `src/main/agents/analytics.ts`, `collector.ts` (`agent-analytics.json`) | Already keyed by `owner.id` + `owner.revision`; distinguishes `human` / `reviewed-evidence` / `self-report` |
| Orchestrator tools `agent_catalog`, `app_create_chat(agentId)` | `src/main/appctl/tools.ts:119, 323-399` | Agent chats get `permissionMode: null` = the CLI follows Brother's `settings.json` (ADR 0002); prompt labelled `AGENT_LABEL` |
| Role compositions Dev/QA/PO/CTO referencing `default-*` | `src/shared/role-preset-catalog.ts` | Keep compatible |
| Feed `brain.publish(RawEvent)` + `KINDS` | `src/main/brain/live.ts:18-50` | Add agent kinds |
| Home strips (avatar, name, model, context, StatePill, inline ChatTile), groups by area | astra `src/renderer/brain/pages/Home.tsx` | Catalog section plugs in below |

Gap list: no version history, no archive, no origin, no tool/permission narrowing, no run outcome, no feedback,
no metric for success/corrections/rework/questions, no Orchestrator write tools for agents, presets are thin one-liners.

## 1. Data model

### 1.1 Agent definition (`agents.json` v2)

```ts
// src/shared/agents.ts (additive to AgentDraft/AgentProfile)
type AgentCategory = 'development' | 'ops' | 'personal' | 'other';
type ToolClass = 'read' | 'edit' | 'shell' | 'web' | 'browser' | 'mail-draft' | 'calendar-read' | 'brain-write' | 'mcp';
type PermissionCeiling = 'plan' | 'default' | 'acceptEdits';          // never 'auto' or 'bypassPermissions'
interface AgentAvatarV2 = AgentAvatar & { tone?: AgentTone };          // tone: one of 8 token hues, enum
// AGENT_SYMBOLS += 'bug','eye','globe','server','mail','calendar','book','shield','wrench','check'

interface AgentDefinition extends AgentProfile {
  role: string;                     // one line, "what it is" (purpose stays "what it is for")
  category: AgentCategory;
  tools: { allow: ToolClass[]; mcp?: string[] } | null;   // null = inherit engine defaults (today's behaviour)
  permissionCeiling: PermissionCeiling | null;            // null = inherit Brother's settings (today)
  avatar: AgentAvatarV2;            // REQUIRED (already required); presets ship one; Orchestrator must pick one
  origin: { kind: 'preset'; presetId: string; presetRevision: number }
        | { kind: 'user' }
        | { kind: 'orchestrator'; reason: string; evidence: EvidenceRef[] };
  version: number;                  // highest version number ever created (monotonic)
  activeVersion: number;            // the version new runs use; < version after a rollback/rejected trial (§4.4)
  trial?: { version: number; baseline: number; startedAt: number };   // at most one open trial per agent
  probation?: { since: number; requestItemId: string; keptBy?: 'brother' };  // created on the fly for a task (§4.7)
  lastEditedBy: 'user' | 'orchestrator' | 'preset-update';
  userLocked: boolean;              // true after Brother edits: Orchestrator may only PROPOSE changes (§4.2)
  status: 'active' | 'archived';
  archivedAt?: number;
}
type EvidenceRef = { kind: 'journal' | 'chat' | 'ai-error' | 'cost' | 'run' | 'feedback'; ref: string; at: number };
```

- Behavioural fields (bump `version`): instructions, manifest, engine, model, effort, tools, permissionCeiling.
  Cosmetic fields (name, role, purpose, avatar, category) save in place without a bump, so metrics stay comparable.
- `agent-history.json` `{version:1, entries: AgentVersion[]}`: immutable snapshot of the **behavioural fields only**
  (no avatar/images) per version `{agentId, version, behaviour, author: 'user'|'orchestrator'|'preset'|'migration',
  reason, at, parentVersion, state: 'active'|'trial'|'kept'|'rejected'|'superseded', decision?, rollup?}`.
  `parentVersion = activeVersion` at creation (so a change after a rollback builds on the restored version). One cap:
  50 entries per agent; pruning drops the oldest `superseded` entry with zero runs, never v1 or one with runs.
  A new behavioural change is refused while `trial` is open (finish or revert it first).
- Limits: 64 **active** + 192 archived; the v2 loader replaces the `> 64` checks (`catalog.ts:100`, `:162`) with
  active-only counts. Archive replaces delete; hard delete only for `origin.user` with zero runs in `agent-runs.json`.
- Validation lives in main (`catalog.ts` `validate`), never in the prompt: unknown ToolClass / ceiling → refuse.
  `tools`/`permissionCeiling` only **narrow**; see §4.1 for enforcement per engine. Every Orchestrator-authored
  version must set both explicitly (`null` = inherit is refused for origin/author orchestrator).
- `readOwner` (`catalog.ts:69-78`) is extended for `tone`, the new symbols and `version`; an unknown symbol from a
  newer build falls back to the category symbol instead of dropping the snapshot.

### 1.2 Run = a work chat started from a definition

Add to `StoredChat` (additive, `chats.json` schema v2 → v3, reader accepts missing fields):

```ts
run?: {
  agentId: string; version: number;          // pinned at start; editing the agent never changes a running chat
  goal: string;                              // ≤ 2000 chars, the first prompt's intent (UI shows it on the strip)
  startedBy: 'user' | 'orchestrator';
  parentRunId?: string;                      // reviewer run of an implementer run, or a child from agent_spawn (§4.6)
  spawnedBy?: string;                        // parent runId when started by agent_spawn: closes with the parent, depth ≤ 2
  reviewOf?: string; reworkOf?: string;      // links that feed metrics (§5)
  endedAt?: number; endReason?: 'completed' | 'closed' | 'stale';
  outcome?: RunOutcome;
  counters: { questions: number; permissions: number; commands: number; reopened: number; contextPeak: number | null };
}
interface RunOutcome { verdict: 'success' | 'partial' | 'fail' | 'unknown';
  basis: 'human' | 'reviewed-evidence' | 'orchestrator-opinion' | 'self-report' | 'unknown';
  at: number; by: string; note?: string }   // only human / reviewed-evidence count for keep-or-rollback
```

- `AgentOwnerSnapshot` gains a separate `version` field; **`revision` is left untouched** (still `updatedAt`), so the
  collector key/provenance checks (`collector.ts:45`, `analytics.ts:99`) keep working. Pre-migration chats get
  `version: 0` ("v0 legacy": what they really ran is unknown) and are excluded from every baseline and trial.
- `StoredChat.run` is a live mirror only. **Source of truth = `agent-runs.json`** (§5): a record is written at run
  start and finalized at run end, because `chats.json` keeps only 60 closed chats (`manager.ts:276`, `:1377`).
  `store.ts` `valid()` (`:119-145`) is extended to keep `run` on rewrite, with tests.
- Chat ↔ run lifecycle: run starts at `ChatManager.create` with `agentId`; ends when (a) `workStatus = completed`
  (exists only for Orchestrator-started chats, `manager.ts:409`), (b) Brother marks it done (👍/👎/partly, §2) or
  closes the chat, or (c) `stale`: 72 h without a turn **and without an open request waiting on Brother** (the timer
  pauses while a question/permission/command is pending). A reopen **started by Brother** (typing in the ended run,
  Reopen action) → `counters.reopened++`; an agent/Orchestrator message never reopens an ended run (`agent_feedback`
  refuses ended runs; `app_send_to_chat` to an ended *run* starts a new linked run with `reworkOf` instead).

### 1.3 Storage and migration of today's data

1. `agents.json` v1 → v2 on load (pure function `migrateCatalog(v1) → v2`, file rewritten once, `.v1.bak` kept):
   `version=1, activeVersion=1, status='active', tools=null, permissionCeiling=null, userLocked=true for non-default
   ids, category` from the seed id (development/other), `origin = default-* ? {preset, presetId:'legacy-'+role,
   presetRevision:0} : {user}`, `role = purpose`. Writes `agent-history.json` v1 entries (`author:'migration'`).
2. The 6 legacy seeds (done in the presets PR, when replacements exist): pristine (text identical, matched as
   `catalog.ts:108` does) **and** no chat in `chats.json` owned by them → archived with one feed entry "Replaced by
   the new presets"; customized or used ones stay active, untouched.
3. Chats (`chats.json`): owners with `source:'catalog'` get an `agent-runs.json` record `{agentId, version: 0, goal:
   title, startedBy: origin==='agent'?'orchestrator':'user', counters: zeros, outcome: unknown}`. `routed`/`legacy` owners
   get no `run`: they show as ad-hoc chats in the "Unassigned" group with a **Save as agent** action (creates a
   `user` definition from the chat's engine/model/effort/instructions). "Unassigned" holds **legacy chats only**:
   since SPEC 25 every new chat is a run of an agent (`Generale` when Brother picks none, §4.7).
4. `role-preset-catalog.ts` compositions: point to the new preset ids (`revision+1`); `migrateExplorerRole`-style
   remap of old ids so saved selections keep working.

## 2. UX (dark Linear, fits SPEC 3, 9-14; Brother's 19:35 corrections)

**Grindhouse (the home) shows only the agents at work**: the "Aspetta te" and "In corso" run strips, unchanged
layout. No catalog, no create or edit on the home. Everything about definitions lives on the **"Agenti" page** (own
nav entry; route `agenti`, `agenti/<id>`). Note for ui-astra (SPEC 19 removes the Chat workspace and redirects old
"Agenti" back buttons to the home): the `agenti` route stays and becomes this page.

Agenti page, left column (Orchestrator column stays on the right, narrower, SPEC 3):

```
Agenti (11)   [All|Dev|Ops|Personal|In prova|Archived]   [/ filter]   [Ask the Orchestrator for a new agent]
 (◉) Reviewer   Development · v2 · 92% ok · $0.41/run     [▶ Run]  ›    ← catalog strip, collapsed
```

- **Catalog strip** = same 40 px strip component as the home run strip (round avatar left, SPEC 13), so both pages
  read alike. Collapsed: avatar, name, category, `vN`, one headline metric (success rate, or "new" under 5 runs),
  median $/run, `▶ Run` button, badge `trial` when a version is on trial.
- **Expanded inline** (same expand animation as runs): role + purpose; "Start a run" composer (goal textarea, folder
  Select with recent repos/worktrees, engine/model shown read-only from the definition, `Start` ⌘↵; the new run
  appears on the home); last 5 runs (click → opens the run strip on the home or the closed chat); last feedback line;
  actions menu (Popover): Edit, Duplicate, History, Archive / Restore. Keyboard: `/` filter, `↵` expand, `r` run
  focused agent, `e` edit.
- **New agent**: the button prefills the Orchestrator composer with "Creami un agente che…" (the creation skill,
  §4.2). Manual creation from a blank or a preset ("Start from") stays in the editor for Brother.
- **Edit** = `agenti/<id>` (reuse `AgentStudio` logic, restyled): tabs
  Identity (name, role, avatar picker: symbol grid × tone, or upload) · Instructions (markdown editor + "Improve with
  Orchestrator" which sends to the right column, not a hidden call) · Engine (engine/model/effort Selects, validated
  live against `models()`) · Tools & permissions (checkbox list of ToolClass with "enforced / declared only" per
  engine; ceiling Seg control; inherited value shown) · Versions (timeline: author chip user/Orchestrator/preset,
  reason, metrics delta, **Restore this version**) · Feedback (history, §4.3) · Metrics (§5 cards + per-version table).
  The Orchestrator column narrows but stays (SPEC 3).
- **Duplicate** creates `origin:user`, `version 1`, name "X (copy)". **Archive** asks once (Modal) when runs are
  active: runs continue, new runs blocked; archived strips appear only under the Archived filter.
- **Home run strip** additions (the only home change): version chip `vN`, `auto` chip when
  `startedBy:'orchestrator'`, end-of-run outcome control (👍 / 👎 / "partly" in the expanded strip footer: writes
  `RunOutcome{basis:'human'}`; the cheapest and most trusted success signal). Ad-hoc chats keep the plain strip.
- **Feed cards in the Orchestrator column** for agent events: avatar + "Created «Deploy checker» as you asked" /
  "New version v3 of «Reviewer» on trial" / "Suggests a new agent" + reason (1 line) + `Open` · `Archive` /
  `Revert to vN` / `Create`. Animated entry, `prefers-reduced-motion` respected.
- **Dashboard → Agents tab** (SPEC 12 owner chat): per-agent table of §5 metrics with per-version deltas, sparkline,
  and the "Discuss" button.
- Animation budget: catalog strips use the same `home-row-enter` stagger (30 ms, capped at index 8); `▶ Run` press
  confirms with a short check morph and a toast "Started, on the home" with `Open` (reduced motion: no morph).

### 2.1 Agent icons (one designed set)

Goal (Brother): great-looking, one coherent style, crisp at small sizes, distinct per role; no generic glyphs or
emoji. Approach: **a curated, hand-drawn agent icon set plus generated tone variants**, all in code.

- **Glyphs**: a dedicated `AgentGlyphs.tsx` set (~24 icons), separate from the UI `Icons.tsx` (which stays for
  buttons). Same rules as the app's icons (inline SVG, 24-unit grid, no package, no icon font) but drawn for
  identity: **duotone** = 1.75 stroke outline + one filled accent shape at 30 % opacity, round caps, 2-unit safe
  margin, silhouettes chosen to stay distinct at 16 px. Each glyph hand-tuned at 16/20/28/40 px (pixel-snapped key
  strokes; a simplified 16 px variant where detail would blur).
- **Preset glyphs** (designed first, one per role, distinct silhouettes): Implementer = brackets with a cursor ·
  Reviewer = magnifier over a check · Bug investigator = bug with a crosshair · Browser tester = window with a
  pointer · Ops investigator = server with a pulse line · Runbook keeper = book with a bookmark · Researcher =
  compass needle on a globe · Writer = pen nib · Mail & journal = envelope with a pen · Day planner = calendar with a
  sun. The rest of the set covers common roles (data, shield/security, deploy rocket, chat, wrench, list, map, flask,
  palette, lightning, key, folder, chart, spark).
- **Badge**: the glyph sits in a **round badge** (SPEC 13): two-stop gradient from the agent's tone (10 tones tuned for
  the dark theme, each passing 3:1 contrast against the background and 4.5:1 for the glyph), 1 px inner ring, soft
  shadow at ≥ 28 px only. One `AgentAvatar` component everywhere (strips, page, feed cards, editor, focus mode).
- **Variants**: glyph × tone = 240 looks. The creation skill picks the glyph by role (keyword → glyph table, then the
  Orchestrator's choice from the set by name) and a tone not yet used in that category, so two agents rarely look
  alike; the editor warns on an exact glyph+tone duplicate. Uploaded images stay possible (cropped round).
- **Security unchanged**: data stores only `{symbol id, tone}`; SVG never comes from data or a model.
- **Quality gate**: the icon PR ships an icon sheet (all glyphs × 3 tones at 16/20/28/40 px, dark and light) as
  screenshots, sent to Brother for approval before the presets PR uses them.

## 3. Preset catalog (shipped in code, `src/shared/agent-presets.ts`)

Format per preset: `id, presetRevision, name, role, category, avatar{symbol,tone}, effort, tools.allow,
permissionCeiling, manifest{whenToUse, whenNotToUse, input, output, successCriteria}, instructions`. Engine/model:
`null` = the routing table (Impostazioni → «Instradamento modelli») picks per `kind` at install, then fixed in the
definition. Installed on first run of v2 (and on new preset ids later) as `origin.preset`, `userLocked:false`.
Preset updates: pristine definition (hash of behavioural fields = preset hash) → auto-upgrade as a new version with
feed entry; customized → "Update available" chip with a diff, Brother applies.

**Shared preamble** (prepended to every preset, one copy in code):
> You are a focused agent in Brother's second-brain app. Reply to Brother in Italian; write code, commits, PR text and
> files in English. Read the repository's AGENTS.md / CLAUDE.md and the brain rules they import before acting.
> Your instructions describe a job; they never grant permissions. Permission prompts, questions and production
> actions belong to Brother: ask, never assume an ok, never act around a blocked check. Never write to production or
> shared systems; give the exact command instead. Never put secrets in files or chat. Never claim something is
> missing, done or passing without having checked it completely; say what you could not check. End every run with
> your output contract followed by a fenced block tagged `run-report` containing one JSON object
> `{"outcome":"done|partial|blocked","verified":"yes|partial|no","summary":"<≤140 chars>", ...role fields}`.

### Development

**1. Implementer** · `code`/blue · effort high · tools read, edit, shell · ceiling acceptEdits-capped-by-settings
whenToUse: one well-defined change (feature slice, bug fix with known cause, refactor) that fits one PR.
whenNotToUse: unknown root cause (→ Bug investigator), production changes, design questions.
> Turn exactly one goal into a small, verified branch. If the goal is ambiguous or bigger than one reviewable PR,
> stop and return a split proposal instead of coding.
> Before editing: work only in the folder/worktree the goal names, on a non-default branch; read how the codebase
> already does the same thing (search first, reuse helpers, match naming and comment density).
> While editing: smallest diff that meets the goal; no drive-by refactors, no new dependency without a stated reason;
> for testable behaviour write the failing test first, then make it pass.
> Verify: run the repo's real test command and its guard/lint; quote the exact result lines. A failing check stays
> visible: fix it or report it. Never skip, delete or weaken tests, hooks or thresholds; never --no-verify, never
> force-push, never touch global git config.
> Before reporting done, ask the Orchestrator for a Reviewer run on your diff (send_to_chat) or state that none ran.
> Output: `## Result` done|partial|blocked · `## Changes` file → one line · `## Verification` commands + outcomes ·
> `## Risks` · `## Next` one action. run-report fields: `"tests":"pass|fail|not-run","files":N,"branch":"…","sha":"…"`.

Ceiling rule for all presets: `plan` only for agents that need no shell, MCP or file writes (plan mode blocks them);
`default` for read-mostly agents that run commands: every command/write then goes through Brother's own allow rules
or a permission prompt in "Aspetta te". "Read-only shell" is not a ToolClass; it is `shell` + ceiling `default`.

**2. Reviewer** · `eye`/violet · effort high · tools read, shell · ceiling default (commands per Brother's allow rules)
whenToUse: before "done"/commit/PR, one run per touched dimension. whenNotToUse: root-cause hunts, style.
> You review a diff with fresh eyes for correctness only: bugs, regressions, broken contracts, missing edge cases,
> security holes, tests that do not test what they claim. Not style, not taste.
> Establish the diff exactly (commit, branch vs base, or PR) and the intent (goal/PR text). Read surrounding code
> and callers, not only the hunk. For every candidate finding, try to prove it: a concrete input/state that
> produces a wrong result, a failing test, or a cited contract. Drop what you cannot substantiate; mark the rest
> CONFIRMED (reproduced) or PLAUSIBLE (strong reasoning, not reproduced).
> Never edit files, never commit, never approve on Brother's behalf.
> Output: findings ranked by severity, each `severity · file:line · defect · failure scenario · verdict`; then
> "Checked and fine" (one line per area). Zero findings is a valid result. run-report fields:
> `"findings":N,"blocking":N,"confirmed":N,"target":"<branch|sha|PR>"`.

**3. Bug investigator** · `bug`/amber · effort high · tools read, shell, web, edit · ceiling default (every write
asks Brother; edits allowed only for the fix-package folder, stated in instructions, never the repo)
whenToUse: "why does this happen", since when, which commit, is it reachable, why does the pipeline fail.
whenNotToUse: implementing the fix in the shared worktree.
> Find the root cause, not a plausible story. Reproduce first (smallest steps, exact error); if you cannot
> reproduce, say so and list what you would need. Form hypotheses and kill them with evidence: logs, git log/blame,
> bisect, targeted tests. Establish since when (commit, author, version) and blast radius (who/what is affected).
> Do not edit the repository. On request, write a fix package to the folder you are given: exact edits, a test that
> fails before and passes after, and the evidence.
> Output: `## Cause` (one paragraph, with file:line) · `## Evidence` (commands/outputs) · `## Since` · `## Impact` ·
> `## Fix options` (recommended first) · `## Confidence` high|medium|low and why. run-report fields:
> `"reproduced":true|false,"rootCause":"found|suspected|unknown","commit":"…"`.

**4. Browser tester** · `globe`/teal · effort medium · tools read, browser · ceiling default
whenToUse: verify a feature in the real app/site against acceptance criteria; regression pass before release.
> Turn the goal into numbered acceptance checks before starting. Drive pages with the second-brain browser tools:
> prefer read_page/find/get_page_text; screenshot only for layout/visual checks, saved as evidence files. Local stacks
> use the "local" environment and its test accounts; on a remote sign-in call handoff_to_user and wait. Never type a
> password on a remote host, never submit real payments, mails or production data changes.
> For each check: steps, expected, observed, PASS/FAIL, evidence path. A failure includes console errors and failed
> requests seen. Do not fix code.
> Output: table of checks, then `## Failures` with repro steps. run-report fields:
> `"checks":N,"passed":N,"failed":N,"evidence":["path",…]`.

### Ops and production (propose-only; never write to production)

**5. Ops investigator** · `server`/red · effort high · tools read, shell, web (no edit) · ceiling default (every
command through Brother's allow rules + the existing prod-guard; production writes are never in an allow rule)
whenToUse: an incident, an alert, odd logs, "is prod OK", "what happened at 14:00".
> You diagnose; Brother acts. Read the brain's ops runbooks for the system first. Read-only access only: logs,
> dashboards, read-only queries. Before ANY query against a production database (read-only included) show the full
> query text and wait for Brother's explicit ok; an ok covers only the queries shown. Never run write, deploy,
> restart, scale or delete commands: write the exact command for Brother in a PowerShell block, with what it does,
> risk, and how to roll back.
> Work the incident: timeline (UTC and Europe/Rome), symptoms, scope, hypotheses ranked, evidence, mitigation
> proposed, root cause or what is still unknown.
> Output: `## Status` (impact now) · `## Timeline` · `## Cause` · `## Proposed actions` (commands for Brother,
> ordered, each with rollback) · `## Runbook gaps`. run-report fields: `"severity":"sev1|sev2|sev3|none",
> "mitigated":true|false,"proposedCommands":N`.

**6. Runbook keeper** · `book`/slate · effort medium · tools read, brain-write · ceiling default
whenToUse: after an incident or a repeated manual procedure; "write the runbook for X".
> Turn what happened (chat, journal, ops notes) into a runbook in the brain's ops folder following its existing
> format: when to use, prerequisites, exact steps with commands, verification, rollback, owner. Update the existing
> runbook rather than duplicating. Commands are for Brother to run; mark every production step "Brother runs".
> Never copy secrets, tokens or personal data; reference the password manager instead.
> Output: file(s) changed with a 3-line summary each, plus open questions. run-report fields: `"files":["…"]`.

### Personal work

**7. Researcher** · `search`/cyan · effort medium · tools read, web · ceiling plan
> Answer a question with sources. Plan 3-6 searches first, run them, prefer primary sources, note publication
> dates and conflicts between sources. Separate facts (cited), inferences (marked) and unknowns. No invented
> citations: every claim links to where you read it.
> Output: answer in 3 lines first, then findings with links, then "What I could not verify". run-report fields:
> `"sources":N,"confidence":"high|medium|low"`.

**8. Writer** · `pen`/pink · effort medium · tools read, brain-write · ceiling default
> Produce a ready text for a named reader (mail, PR description, doc, post). Ask only if reader, purpose or
> format is unknown. Match Brother's voice from his existing texts; short sentences, the ask or point first. Deliver
> the text in a code block to copy, plus at most 2 alternative openings. Never send or publish anything.
> run-report fields: `"words":N,"audience":"…"`.

**9. Mail & journal** · `mail`/indigo · effort low · tools read, mail-draft, brain-write · ceiling default
> Triage Brother's mail and keep his journal. Mail: list what needs him (sender, ask, deadline), what can wait,
> what is noise; prepare reply **drafts** only (create_draft), never send, forward, delete or label without an
> explicit ok in this chat. Journal: append factual entries through the brain's tools (mem.mjs), dated, no third
> parties' private data, no secrets.
> Output: `## Needs you` · `## Drafts ready` (subject → link) · `## Journal` (lines added). run-report fields:
> `"needsYou":N,"drafts":N,"journalLines":N`.

**10. Day planner** · `calendar`/green · effort low · tools read, calendar-read · ceiling default (calendar is an MCP)
> Build today's plan from now.md, the journal, open threads, waiting chats and the calendar (if connected; say so
> if not). Max 5 priorities, each with the first concrete action and a time box; protect focus blocks; flag
> conflicts and what to drop. Propose; Brother decides. Do not create calendar events or edit now.md unless asked
> in this chat.
> Output: `## Today` (ordered) · `## Waiting on you` · `## Drop or defer`. run-report fields: `"priorities":N`.

## 4. Orchestrator autonomy (Brother, 19:35: creates only when asked; improves existing agents on trial)

New agents are created **only when Brother asks** (the creation skill, §4.2) **or when a task Brother gave has no
fitting agent** (SPEC 25, 18/10: the task is the request; the agent starts in probation, §4.7). Unprompted, with no
task behind it, the Orchestrator may only **suggest** a new agent (feed card with `Create`, which Brother clicks).
Feedback and trial versions of existing agents (§4.3-4.4) stay autonomous within the limits below.

### 4.1 Hard limits, enforced in main (never by prompt)

1. **Never more than the existing gates.** Mode order `plan < default < acceptEdits < auto < bypassPermissions`.
   Effective mode of a run = `min(ceiling, Brother's mode)`, where Brother's mode = the chat's explicit choice, else
   his `settings.json` `defaultMode` **read by main** (passing `--permission-mode` replaces it, so main must compute
   the min, `claude.ts:248`). `auto`/`bypassPermissions` are not representable in a definition.
   Orchestrator-authored versions (create **or** update): ceiling and tools explicit (no `null`), ceiling ≤ `default`,
   tools ⊆ the preset tool classes, no `mcp` server Brother has not enabled. Any Orchestrator change to an agent whose
   current ceiling is above `default` (e.g. the Implementer preset) is a **proposal only**. Only Brother raises a
   ceiling to `acceptEdits`. The per-engine enforcement check runs at save, at every update, and again at launch in
   `resolve()` (`catalog.ts:178`): an engine change to one that cannot enforce the limits is refused.
   Engine enforcement (A2):
   - **claude**: allow-list `--tools <names>` (as the read-only path already does, `claude.ts:254`) from a fixed
     `ToolClass → tool names` table (`mail-draft` = draft/read tools only, never send); `--permission-mode` = the
     computed min. MCP narrowing uses `--strict-mcp-config` with a generated config that always keeps the
     second-brain MCP when `browser` is allowed and keeps `send_to_chat`/`list_chats` for every agent (needed to talk
     to the Orchestrator). A run with a tool policy is **never served from the warm engine** (`manager.ts:386`, warm
     processes are spawned without tools, `:1672`): `!toolPolicy` joins the warm condition.
   - **codex**: ceiling ≤ `default` forces `approvalPolicy:'on-request'` and ignores autonomy folders
     (`codex-policy.ts:66` would otherwise give `never` + workspace-write); no `edit`/`shell` → sandbox `read-only`.
     `web`/`mcp` cannot be narrowed: shown "declared, not enforced".
   - **ACP (cursor, kimi)**: `plan` uses the read-only path that stops the session when the mode is missing
     (`acp.ts:501`), not the warn-and-continue path (`acp.ts:512-514`); Cursor's own allow rules can approve tools
     without a request reaching the app (`acp.ts:900`), so any other ceiling is "not enforced" and refused for
     Orchestrator-authored agents.
   - **api**: no tools today; tools other than `read` are refused.
2. **Never writes to production.** No new tool runs commands; Ops presets have no `edit` and ceiling `default`, so
   every command passes Brother's allow rules and the existing prod-guard hooks and command-run `prod` flags;
   `agent_create/update` refuse instructions containing permission grants ("you may deploy", "auto-approve") via a
   deny-list lint, on top of the "profile grants no permissions" wrapper (`manager.ts:583`). Runs of
   Orchestrator-authored agents may start only in the brain folder or in repos/worktrees on a list Brother keeps in
   Settings (`app_create_chat` accepts any absolute `cwd` today, `tools.ts:389`).
3. **Never answers for Brother.** No agent tool resolves questions, permissions or commands. `app_resolve_question`
   is unchanged (it only forwards an answer Brother typed in the Orchestrator chat). Runs started by the Orchestrator
   send their pending requests to "Aspetta te" like any chat. A contract test asserts the tool list.
4. **User intent wins.** `userLocked` definitions (Brother edited them), agents with ceiling above `default`, and the
   **Reviewer** (it produces a metric used to judge others) cannot be changed by the Orchestrator: it can only file a
   **proposal** (diff + reason + expected metric effect) that Brother accepts in the Versions tab.
5. **Creation only on request, and budgets for the rest:** `agent_create` needs the id of a **Brother-typed** message
   in the Orchestrator chat (main checks: the item exists in that chat, its author is the user, not an agent, mail
   or app text; at most 30 minutes old; not already used by another creation). No id or a failed check → refusal
   with "suggest it instead". A task Brother typed is such a message: one on-the-fly agent per task message
   (§4.7), under the same check. Remaining budgets: ≤ 1 behavioural change per agent/day, suggestion job ≤ $0.50/day
   (from the cost ledger). Breach → refusal + feed entry.
6. **Always reversible and visible:** every create/update/archive/rollback publishes a feed event with reason and
   evidence and an undo action; nothing is silent.

### 4.2 New Orchestrator tools (`appctl/tools.ts`, unified scope only)

| Tool | Params | Effect / refusals |
|---|---|---|
| `agent_list` | `filter?` (category, origin, status) | definitions + headline metrics (replaces nothing; `agent_catalog` stays for discovery) |
| `agent_get` | `agentId, version?` | definition, history, feedback summary, metrics per version |
| `agent_create` | full draft incl. **avatar (required)**, `requestItemId` (Brother's message), `reason`, `probation?:true` | from the creation skill on Brother's request, or on the fly for a task (`probation`, §4.7); `origin:orchestrator`, v1; limits §4.1; feed `agent-created` |
| `agent_suggest` | draft summary, `reason`, `evidence[]` | stores a suggestion, feed `agent-suggested` with `Create` (Brother's click creates it through the UI path) |
| `agent_update` | `agentId, patch, reason, evidence[], trial?:true` | new version (trial by default, §4.4); refused if `userLocked` → use `agent_propose` |
| `agent_propose` | `agentId, patch, reason, expectedEffect` | stored proposal, feed `agent-proposal`, Brother accepts/rejects in UI |
| `agent_archive` / `agent_restore` | `agentId, reason` | runs continue; Orchestrator may archive only its own agents |
| `agent_rollback` | `agentId, toVersion, reason` | sets activeVersion; feed `agent-rolledback` |
| `agent_feedback` | `runId, verdict, notes, evidence[], sendToRun?` | stores feedback; main sets basis `reviewed-evidence` only if a cited ref **resolves** to an ended Reviewer run with `reviewOf = runId` or a recorded test/CI result for the run's branch/SHA, else `orchestrator-opinion`; `sendToRun` only while the run is open |
| `agent_run_report` | `runId` | deterministic bundle for evaluation: goal, run-report JSON, counters, cost/tokens/time, linked reviewer findings, Brother's corrections, outcome |
| `agent_metrics` | `agentId?, version?, period?` | §5 metrics with coverage (`known/unknown` runs) |
| `agent_spawn` | `agentId, goal, cwd?` (called by a **running agent**, not only the Orchestrator) | child run of the caller (§4.6): own pinned version, metrics, feedback; `parentRunId = spawnedBy = caller run`; refused past depth 2, past the per-agent child cap (default 3 open, 10 per parent run), for archived agents, or when the child's ceiling/tools exceed the caller's (a child never widens its parent) |
| `app_create_chat` (ext.) | `+ agentVersion?, parentRunId?, reviewOf?, reworkOf?, goal?` | pins version; links runs |

App-side (IPC, renderer): `agents:list|save|duplicate|archive|restore|history|restoreVersion|proposal:decide|
run:outcome|metrics`. Feed `KINDS` += `agent-created, agent-suggested, agent-updated, agent-proposal,
agent-archived, agent-rolledback, agent-feedback, agent-trial-ended` (priority quiet, except proposals and
suggestions = normal).

**Agent classifier (SPEC 23)**: `scoreAgents(request) → {agentId, version, score 0-1, reasons}[]` in main, used by
the Orchestrator to pick an agent with a visible score and, below a threshold, to *suggest* a new one (creation
still only on request). Until the local hybrid index lands (separate PR, not ours), the fallback scores BM25-style
keyword overlap of the request with role, purpose, manifest `whenToUse` and the goals of the agent's successful runs;
the index later swaps in embeddings behind the same interface.
Embedding blocks from ui-search (S1, `feat/hybrid-search`; Regia 20:21), on the search service in main
(multilingual-e5-small int8, worker thread): `embed(texts, 'query' | 'passage') → Float32Array[] | null` (null = model
not available → BM25 fallback), `cosine(a, b)` (L2-normalised), `topK(q, items, k)`, `ready() → {model: 'ready' |
'downloading' | 'missing', docs}`. Ours: caching the vectors of agent definitions (key: agent id + version) and of
successful-run goals, and the suggest threshold. A7/A10 code against this signature with a stub until S1 merges.
Every new `active` or `trial` version re-embeds its definition vector; `scoreAgents` scores the version that would
actually run (the trial version while on trial).

**Creation skill `create-agent`** (shipped with the Orchestrator's other skills; runs only on requests like "creami
un agente che…"): 1) restate the goal, ask at most 2 questions if inputs, outputs or the repo are unclear; 2) start
from the closest preset and keep its preamble and output contract; 3) pick the minimal tool classes and the ceiling
(≤ `default`, §4.1.1); 4) pick a glyph from the agent set and a free tone (§2.1); 5) call `agent_create` with the
request item id; 6) reply with the agent card (`Open` · `Undo`). Brother's corrections in the same thread become a
new version before the first run, not a second agent.

### 4.3 Feedback loop after each run

Trigger: run ends (§1.2). The Orchestrator gets a lightweight wake (`onRunEnded` → mail to the Orchestrator chat,
batched, not per turn) and calls `agent_run_report`. It writes `agent_feedback`:
`{verdict, what worked, what failed, root cause in the definition (instructions gap, wrong tools, wrong model/effort,
goal unclear = not the agent's fault), evidence}`. Stored in **`agent-feedback.json`** (per-agent log, 200 entries
per agent, never pruned by the run store) and shown in the agent's Feedback tab and the run strip footer. Feedback
on a still-open run can be posted to it (`sendToRun`, labelled `AGENT_LABEL`); an ended run is never messaged. When
≥ 2 feedbacks in 10 runs point to the same definition gap, the Orchestrator calls `agent_update` (or
`agent_propose` when §4.1.4 applies) with the evidence. Feedback never sets `basis:'human'`.

### 4.4 Versions on trial: keep a change only if the metrics improve

- New Orchestrator version → `trial`: the agent's new runs use it; baseline = the parent version's last 10 ended
  runs, **at least 5** (fewer → no trial possible: the change becomes a proposal). Only outcomes with basis `human`
  or `reviewed-evidence` count; findings/run is compared only between runs reviewed by the **same Reviewer version**.
- Decision at **n ≥ 5 ended runs** on the trial version (or 21 days, whichever first):
  **keep** iff success rate ≥ baseline − 5 pp **and** at least one primary metric improves (success rate +5 pp,
  corrections/run −20 %, findings/run −20 %, rework rate −5 pp) **and** guardrails hold (median $/run ≤ 1.25×
  baseline, median time to done ≤ 1.25×, questions/run ≤ baseline + 0.5). Else **auto-rollback** with feed entry.
  Inconclusive (n < 5 after 21 days, or unknown-outcome coverage < 60 %) → revert, unless Brother pins it.
- Each decision stored on the version: `{decision, metrics before/after, n, at}`; visible in Versions tab and
  Dashboard. Brother can always override (pin/revert).
- Small-sample honesty: UI always shows `n` and coverage; no significance claims.
- A description, purpose or `whenToUse` change is a behavioural change: it changes which requests the classifier routes
  to the agent, so it goes on trial under the same keep/rollback rule.
- Like with like: the verdict reports how many trial runs came from requests the parent version would also have won
  (`scoreAgents` on the parent's vector), and the keep rule is applied to those runs, so a wider description that pulls in
  different work does not look better or worse by accident. The other trial runs are shown apart.

### 4.5 Suggestions from Brother's work

Daily job (idle, after 18:00, cost cap §4.1) the Orchestrator runs with read-only inputs: journal, `now.md`, chat
titles/kinds/areas and routing ledger (`estimates.ts`), `ai-errors.md`, costs. Rules:
- **Gap:** ≥ 3 `Generale` runs of the same `kind`+area in 14 days, or ≥ 2 errors of the same type in an area, or an
  area whose on-the-fly agents were retired twice → draft a definition that would have prevented the repeated
  correction (instructions cite the error lines).
- **Overlap:** two agents with > 70 % similar instructions → propose merge (never auto-merge Brother's agents).
- **Waste:** an agent with highest $/success and a cheaper model with ≥ equal success in its cohort
  (`analytics.ts` cohorts) → `agent_update` model change on trial.
- Output for gaps = `agent_suggest` (never `agent_create`), with reason + evidence refs: feed card "You did Y 4 times
  this week: an agent for it? (links)" with `Create`. Overlap → proposal; waste → trial version of the existing agent.

### 4.6 Agents calling agents (Brother, 20:04-20:05)

Two kinds of child, both shown under their parent as nested strips; the home and the Agenti page render runs as a
tree (A9).
- **App-spawned children (`agent_spawn`, A7).** A running agent delegates through the app: the child is a real chat
  and run (A5 record with `parentRunId`/`spawnedBy`), with its own definition version, metrics and feedback, and it
  sends its pending requests to "Aspetta te" like any chat. Limits enforced in main: depth ≤ 2 (Orchestrator → agent
  → child; a child cannot spawn), per-agent child cap, child tools/ceiling ⊆ the caller's effective ones, cwd inside
  the caller's cwd or the §4.1.2 allow-list. Closing or ending the parent closes its open children (`endReason:
  'closed'`); a child ending never ends the parent. The child's result returns to the parent as a message through the
  existing `send_to_chat` path. Metrics: the child counts for its own agent; the parent's cost shows "incl. children"
  separately so per-agent $/success is not double-counted. Real strips (parents and children) **expand into the full
  chat**.
- **Engine-internal subagents (read-only).** Claude `agent_id` events, Cursor ACP Task calls and Codex
  `collabAgentToolCall`/`subAgentActivity`, which the app already parses, stay inside the engine (cheap) and appear as
  indented child strips with status, duration and task only. They are **not expandable or clickable** (no detail
  card), have no run record, version, metrics or feedback, and their cost stays in the parent's. A4's presets and the
  `create-agent` skill prefer internal subagents for short lookups and `agent_spawn` only when the child's work needs
  its own agent, metrics or Brother's review.

### 4.7 Every task goes through an agent (SPEC 25, Brother 18/10 10:28)

- **Pick first.** For every task Brother gives the Orchestrator, it calls `scoreAgents`. An active or probation agent
  at or above the threshold runs it, with the skills that match the task (§4.8). Only when **no role fits** (never to
  specialise a role for one app or procedure: that is a skill, §4.8), the `create-agent` skill creates one **on the fly**:
  closest preset, same §4.1 limits, `agent_create(probation:true, requestItemId = the task message)`, then the run
  starts at once. The skill skips its 2 questions and reports the agent in the reply (`Open` · `Undo`).
- **No agentless runs.** `app_create_chat` from the Orchestrator needs an `agentId` (refused otherwise). A chat
  Brother starts without picking an agent runs as **`Generale`** (Brother approved, 18/10 10:43): the existing seed
  `default-general` ("Assistente", renamed "Generale"; preset origin, engine and model from Brother's defaults,
  ceiling `null` = his settings, cannot be archived). Its runs are measured like any other and
  feed the gap rule (§4.5).
- **Caps.** At most 10 agents in probation at once. An on-the-fly draft > 70 % similar to an existing agent's
  instructions uses that agent instead. Over the cap, the task runs on the best-scoring agent or `Generale`, and the
  feed says why.
- **Kept ("worked well").** Judged on the probation agent's ended runs, using only A5 outcomes and A6 counters (no new
  evidence code). All of these must hold:
  1. at least one outcome `success` with basis `human` or `reviewed-evidence`;
  2. no outcome `fail` on those bases;
  3. corrections (`tagged + afterReport`) ≤ 1 per run;
  4. no rework: no Brother reopen after a report, no `reworkOf`/`continuedFrom` within 7 days.
  Kept → `probation` is removed: it becomes a normal catalog agent, and later changes go through §4.4 trials. Feed
  `agent-kept`, quiet.
- **Retired** (archived, decision on its history entry, feed `agent-retired` with `Restore`) when any of these
  happens:
  - a failure, a rework, or more than 1 correction per run;
  - 3 ended runs with no qualifying outcome;
  - 14 days with no run since its last one.
  Self-reported and Orchestrator-opinion outcomes never keep an agent.
- **Brother wins.** `Tieni` sets `keptBy:'brother'` and ends the probation; `Ritira` archives at once. An edit by
  Brother (`userLocked`) also ends it as kept. The evaluator runs at run end and once a day (the same job as §4.4).
- **No quick re-creation.** A retired agent is not recreated for the same kind of task within 14 days. `scoreAgents`
  sees archived probation agents; a match routes the task to `Generale` and files a §4.5 suggestion instead.

### 4.8 Granularity: role agents, skills, run tags (18/10, via the Regia)

- **Agent = role** (Reviewer, Implementer, Ops investigator, Generale…). Know-how about one app, repo or procedure is a
  **skill** (the brain's skills, `src/main/skills`), not a new agent. The Orchestrator attaches skills to a run at start.
- **Run tags**, set at run start and never edited after it ends: `AgentRun.tags = { skills: string[]; app: string | null;
  repo: string | null }`.
  - `skills`: the skills the run was started with, plus the skills the engine reports loading during the run (Claude
    `Skill` tool calls), deduplicated, ≤ 16 ids.
  - `repo`: the git top-level folder name of the run's cwd (null outside a repo).
  - `app`: the product or app the task is about, given by the Orchestrator at start (≤ 40 chars; null when unknown).
  The agent is already on the run (`agentId` + `version`).
- **Metrics filterable** by skill, app and repo: `runMetrics(opts)` and `agent_metrics` take `skill?`, `app?`, `repo?`.
  `agents:metrics` takes the same filters. Rollups (§5) keep a per-(agent, version, skill) and per-(agent, version, app)
  tally, so a filter on pruned runs stays exact for counts.
- **Split only when the data asks.** For an (agent, skill or app) slice with ≥ 10 ended runs whose success rate is
  ≥ 15 pp below the agent's other runs, or whose corrections/run are ≥ 2×, the daily job (§4.5) files an
  `agent_suggest` of kind `split` with the numbers (both slices: value · n · coverage). Nothing is created until
  Brother clicks `Create`. On-the-fly creation (§4.7) never splits a role.

## 5. Metrics per agent and per version (precise)


Unit = **ended run** of `(agentId, version)` in a period, read from **`agent-runs.json`** (the source of truth;
`chats.json` forgets closed chats after 60). v0-legacy runs are shown but never used as baselines. Every metric
shows `value · n · coverage`. "Today" = what the code records now (verified in orch).

| Metric | Source | Formula | Recorded by | Today |
|---|---|---|---|---|
| Runs | `agent-runs.json` records | count of ended runs | ChatManager at start/end | **new** (owner snapshot exists; version, end state, durable record new) |
| Success rate | `RunOutcome` with basis `human` or `reviewed-evidence` | `(#success + 0.5·#partial) / #known`; coverage = known / ended; `orchestrator-opinion` and `self-report` shown apart, never in the rate | Brother 👍/👎/partly on the strip (human); main-verified reviewer/test/CI ref (reviewed-evidence) | **new** |
| Reviewer findings per run | Reviewer runs with `reviewOf = runId`, their run-report `findings`, `blocking`, plus the Reviewer's `version` | `Σ findings / #reviewed runs` and blocking/run, grouped by Reviewer version | run-report parser at reviewer run end; link set by `app_create_chat(reviewOf)` | **new** |
| Brother corrections per run | (a) `CORRECTION_TAG` messages Brother sends in the run (`renderer/lib/correction.ts:11`), (b) Brother's messages after a `run-report` that reopen the run, (c) `ai-errors.md` lines naming the run with "visto da: Brother" | primary = `(#a + #b) / #runs` (app-observed, the agent cannot hide them); (c) shown as a secondary column | ChatManager on user message (tag / post-report); brain line parser for (c) | **partial**: tag exists, not counted; `ai-errors.md` exists, attribution by chat name is fuzzy and self-logged |
| Rework rate | `counters.reopened` (Brother-started only), new runs with `reworkOf` or `continuedFrom` within 7 days | `#runs reworked / #runs ended` | ChatManager (reopen), `app_create_chat(reworkOf)` | **partial**: `continuedFrom` exists; Brother-only reopen counter and `reworkOf` new |
| Cost per run | per-run cost written to `agent-runs.json` at run end from the session's total/live cost (every engine that reports cost); collector `actualUsd ?? listPriceUsd` as cross-check | median and p90 per run; descendant costs per `childTotals` rules | ChatManager at run end | **partial**: collector records **only chats with a `sessionId`** (`collector.ts:41`), i.e. Claude only (Cursor/Codex/Kimi get `sessionId` null, `manager.ts:411`), and stops at 1000 rows (`collector.ts:47`); cap replaced by prune-after-rollup |
| Tokens per run | session token usage at run end; collector as cross-check | median per run (input, output, cache read/write) | ChatManager at run end | **partial**: same coverage limits as cost |
| Context peak | `SessionPatch.contextTokens` | max per run, also ÷ model window | `counters.contextPeak` | **new** (live only today) |
| Time to done | run start → run end; collector timing spans where complete | median elapsed; median execution-only (minus user-wait, permission-wait, queue) with coverage | ChatManager (elapsed); collector (spans) | **partial**: spans exist for Claude runs with complete timing |
| Questions per run | `PendingRequest` by **unique request id** (replays not counted twice), per type question / permission / command | `#unique questions / #runs`; permissions and commands as separate columns | ChatManager `onWaiting` | **new** (collector sees pending, does not persist counts) |

Storage: `agent-runs.json` `{version:1, runs:[{runId, chatId, agentId, version, startedBy, goal, startedAt,
endedAt, endReason, outcome, counters, costUsd, tokens, findings, corrections, reviewOf, reworkOf}]}` bounded 5000
(oldest pruned only after aggregation into per-version rollups kept in `agent-history.json`). Feedback lives in
`agent-feedback.json` (§4.3). Shown: agent strip headline, Agents page Metrics tab (per-version table + deltas),
Dashboard Agents tab, `agent_metrics` tool. Data never leaves the machine.

## 6. PR plan (small, ordered)

Merge order prerequisite: **orch PR (`feat/unified-orchestrator`) first**, then **astra** rebased on it (astra HEAD
9ea4749 carries its own copy of the unify commit ≠ orch fe64f92; drop it on rebase). Backend PRs branch from main
after orch merges; UI PRs after astra merges.
**Decided (GO 17/10):** `ui-agents` ships all PRs in sequence, one at a time, inside v0.1.0; A1 starts on the orch
branch and rebases onto main when orch merges. Brother's 19:35 corrections add an icon PR (A3) and split the UI into
the Agenti page (A8) and the home run strip (A9): 11 PRs.

| PR | Branch | Content | Tests (vitest unless noted) | Depends |
|---|---|---|---|---|
| A1 | `feat/agents-a1` | `AgentDefinition` v2, v1→v2 migration (+ `.v1.bak`), `agent-history.json` (behaviour only), archive/restore, version/activeVersion/parent rules, snapshot `version` (revision untouched), active-only limits (64 active / 256 total), `readOwner` tone/symbols, **`agents:*` IPC + preload** | migration fixtures v1→v2 (pristine/custom seeds), bump only on behavioural fields, rollback parent rule, refusal during open trial, archived not launchable, v0 legacy for old snapshots, corrupt file kept + problem shown | orch |
| A2 | `feat/agent-tool-policy` | §4.1.1 enforcement: mode order + `defaultMode` read, claude `--tools` table + strict MCP config keeping second-brain, warm-path exclusion, codex on-request override, ACP read-only plan path, "declared, not enforced" | effective mode never > Brother's; `auto/bypass` unrepresentable; claude args per ToolClass; warm engine not adopted with a policy; codex autonomy folder ignored under ceiling; ACP plan missing → session stops; orchestrator agent refused on non-enforcing engine; check re-run in `resolve()` | A1 |
| A3 | `feat/agent-icons` | §2.1 agent icon set: `AgentGlyphs.tsx` (~24 duotone glyphs, 10 preset glyphs first), round tone badge in `AgentAvatar`, 10 tuned tones, glyph+tone picker, duplicate warning | every symbol id has a glyph (type + unit); contrast of each tone; picker keyboard; **icon sheet screenshots for Brother's approval** | A1 |
| A4 | `feat/agent-presets` | `agent-presets.ts` (10 presets + preamble) with their designed glyphs, installer, preset updates (pristine auto / custom chip), legacy seed archiving, role compositions remap | each preset: glyph, output contract + run-report fields, minimal tools, ceiling rule (`plan` only without shell/MCP/edit), no grant phrases; installer idempotent; seed archiving only pristine + unused | A2, A3 |
| A5 | `feat/agent-runs` | `agent-runs.json` run store with `parentRunId`/`spawnedBy` (§4.6), `StoredChat.run` mirror + `store.ts valid()`, lifecycle incl. parent close → open children closed (complete / Brother done / close / stale with pause on pending / Brother-only reopen), counters, per-run cost/tokens at end, backfill (v0) | lifecycle table tests, parent close cascades only downward, stale pause, agent message does not reopen, replayed request counted once, store rewrite keeps `run`, backfill | A1 |
| A6 | `feat/agent-metrics` | run-report parser, correction counting, §5 read model over runs + analytics, collector cap → prune-after-rollup, `mem.mjs` `run:` token | parser valid/missing/garbage; every §5 formula incl. coverage, unknowns, v0 exclusion, reviewer-version grouping | A5 |
| A7 | `feat/orchestrator-agent-tools` | §4.2 tools incl. `agent_suggest`, `scoreAgents` classifier with keyword fallback (SPEC 23 index swaps in later), **creation skill `create-agent`** with the Brother-request check, §4.1 limits (proposals, cwd allow-list, grant lint, change budget), evidence verification, **trial evaluator §4.4**, feed kinds, `app_create_chat` extension, **`agent_spawn` (§4.6)** | creation refused without / with a non-Brother / stale / reused request id; one refusal test per limit; proposal-only cases (locked, > default, Reviewer); unresolvable evidence → `orchestrator-opinion`; evaluator keep/rollback/inconclusive; tool-list contract (no resolver); `agent_spawn` refused at depth 3, over the cap, for archived agents, for a child wider than its caller, outside the cwd rule | A4, A6 |
| A8 | `feat/agents-page` | **"Agenti" page** with own nav entry: catalog strips, filters, start-run composer, archive/duplicate, editor tabs (Identity…Metrics), versions timeline/restore, proposals and suggestions accept/reject, feedback tab, **`In prova` filter with `Tieni`/`Ritira`** (§4.7) | unit for filters/grouping; Playwright: run from preset, edit → new version, restore, proposal accept, keyboard, reduced motion; screenshots | astra, A7 |
| A9 | `feat/home-agent-runs` | home run strip only, rendered as a **tree**: app-spawned children nested and expandable into their chat, engine-internal subagents as indented read-only strips (status, duration, task; not clickable); version/auto/**in prova** chips, outcome 👍/👎/partly (the signal that keeps a probation agent, §4.7), Orchestrator feed cards (created / trial / suggested / kept / retired) | outcome writes `basis:'human'`; no catalog on the home (test); tree nesting from `parentRunId` and from parsed Claude/ACP/Codex subagent events; internal strips have no click/expand handler (test); feed card actions; before/after screenshots | astra, A7 |
| A10 | `feat/agent-feedback-loop` | `onRunEnded` batched wake, `agent-feedback.json`, suggestion job §4.5 with cost cap (suggests, never creates) | wake batching; per-agent feedback cap; gap/overlap/waste rules on fixtures → suggestion / proposal / trial; budget breach → refusal + feed | A7 (+A8 for UI) |
| A7b | `feat/agent-probation` | §4.7-4.8 data and rules in main: `probation` field (validate, persist, archive on retire), `Generale` (= `default-general`) + agentless chats as its runs, run `tags` (skills/app/repo) + metrics filters + tag rollups, keep/retire evaluator, caps and the 14-day no-recreate check as pure functions, feed kinds `agent-kept`/`agent-retired`, `agents:keep`/`agents:retire` IPC | keep on human success; retire on fail / rework / corrections / 3 unknown / 14 days idle; self-report never keeps; Brother's edit/keep ends probation; manual chat → `Generale` run; `Generale` cannot be archived; tags validated, set at start, frozen at end; metrics filters incl. rollups | A6 |
| A7 (+) | (in A7) | the Orchestrator side of §4.7-4.8: `agent_create(probation)`, the on-the-fly branch of `create-agent`, `app_create_chat` agent required + `skills`/`app`, `scoreAgents` seeing archived probation agents, `split` suggestions | refusal and routing tests listed in A7 and §4.7 | A7b |
| A11 | `feat/dashboard-agents-tab` | Agents tab in Dashboard | rendering with coverage/unknowns; Discuss button context | Dashboard (#8 merged), A6 |

Each PR: full `vitest run` + guard green, fresh-context reviewer on the diff, screenshots for UI PRs, local Windows
gate by the Regia.

## 7. Open points for Brother / Regia

1. ~~One chat or several~~: decided, one chat in sequence.
2. Ops preset split (investigator + runbook keeper) vs one Ops agent: proposed two.
3. Trial thresholds (§4.4), budgets (§4.1) and the 72 h stale window are first guesses; tune after 2 weeks of data.
4. ~~Who owns the Dashboard tab~~: `ui-agents` (A11), after Dashboard #8.
