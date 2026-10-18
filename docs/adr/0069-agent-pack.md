# 0069 — Agent pack (`.sbagent`): an agent's know-how to export, share and load, also in Claude, Cursor, Codex

Date: 2026-10-18. Status: proposed (design only, no product code; Brother's answers in). Builds on AGENTS-DESIGN
(branch `docs/agent-first`: §1.1 definition, §4.4 trial versions, §4.7 probation, §4.8 agent = role, know-how =
skills, run tags), ADR 0018 (skills, `src/shared/skillmd.ts`), 0059 (brain domains, deny list per domain), 0060
(per-launch adapters), 0061 (guard `tools/guard/scan.mjs`), brain-pulse (scheduler, "Da approvare"; in progress).

## Context

Brother (18/10): every agent has its own know-how (files and skills) that grows over time, is easy to export and share
with colleagues, and easy to load back into the app. He chose an app format, `.sbagent`, not a bare Claude Code plugin.
Hard requirement (same day): a pack must also be fully usable in Claude Code, Cursor and Codex without the app.

What exists: `skillmd.ts` checks a SKILL.md (name `^[a-z0-9]+(?:-[a-z0-9]+)*$` ≤ 64, description ≤ 1024, closed
frontmatter, no duplicate keys); `skills/service.ts` lists and writes skills through the user's PreToolUse hooks;
`brain/adapters/claude-plugin.ts` already builds a Claude plugin folder (`.claude-plugin/plugin.json`, `skills/`,
`agents/`) passed with `--plugin-dir`; `brain/adapters/codex.ts` passes skill roots to Codex; `agents/catalog.ts`
validates avatars against `AGENT_SYMBOLS` × `AGENT_TONES`; `brain/guard.ts` runs the scanner on a domain push with the
domain's deny list, fail-closed. No zip library is a dependency.

### What each tool loads (official docs, read 2026-10-18)

| Tool | Skills | Agent (role + instructions) | Always-on rules | Package |
|---|---|---|---|---|
| Claude Code | `~/.claude/skills/<n>/SKILL.md`, `.claude/skills/`, plugin `skills/`; Agent Skills standard, extra keys allowed [1] | `.claude/agents/*.md`, `~/.claude/agents/`, plugin `agents/`; keys `name`, `description` required, `tools`, `model` (alias, id or `inherit`), `effort`, `skills` (preload), `permissionMode`, `color` [2] | `CLAUDE.md` (a plugin's own is not loaded [3]) | `.claude-plugin/plugin.json` (`name` only required, kebab-case, no `claude-` prefix), `skills/`, `agents/`, `hooks/`, `.mcp.json`, `bin/` [3] |
| Cursor | `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/`, `~/.cursor/skills/`, also `.claude/skills/`, `.codex/skills/` [5] | `.cursor/agents/`, `.claude/agents/`, `.codex/agents/` (+ `~/` variants); keys `name`, `description`, `model` (`inherit` or a Cursor id), `readonly`, `is_background` [7] | `.cursor/rules/*.mdc` (`description`, `globs`, `alwaysApply`), `AGENTS.md` root and nested [6] | `.cursor-plugin/plugin.json` or root `plugin.json` (Agent Plugins); `rules/`, `skills/`, `agents/`, `hooks/`, `mcp.json` [8] |
| Codex | `$CWD/.agents/skills`, parents up to the repo root, `~/.agents/skills`, `/etc/codex/skills`; optional `agents/openai.yaml` [9] | `~/.codex/agents/*.toml`, `.codex/agents/*.toml`; `name`, `description`, `developer_instructions` required; `model`, `model_reasoning_effort`, `features.*` = false to narrow; inherits the parent's permissions and MCP [11] | `~/.codex/AGENTS.md`, repo root → cwd, 32 KiB total [10] | root `plugin.json` (Agent Plugins 1.0: `$schema`, `name`, `version`, `description`) or `.codex-plugin/plugin.json`; `skills/`, `mcp.json`, `hooks/`; no `agents/` [12][13]. Custom prompts are deprecated in favour of skills [14] |

The Agent Skills spec [4]: folder name = `name`, 1-64 chars, no leading, trailing or double hyphen; `description`
1-1024; only `license`, `compatibility`, `metadata`, `allowed-tools` besides; `scripts/`, `references/`, `assets/`.
Claude-only keys (`model`, `effort`, `hooks`, `context`, `disable-model-invocation` …) are a hard error on claude.ai
and ignored elsewhere; and a SKILL.md body may run shell at load (`` !`cmd` ``) in Claude Code [1].

## Decision

### 1. Format: the zip is a valid Claude Code plugin, Cursor plugin and Agent Plugin at once

```
sbagent.json                      the app's manifest (only the app reads it)
.claude-plugin/plugin.json        {name: <agent-id>, version, description}            Claude Code
.cursor-plugin/plugin.json        same three fields                                  Cursor
plugin.json                       Agent Plugins 1.0 ($schema, name, version, description)  Codex (+ Cursor)
agents/<agent-id>.md              the agent: Claude and Cursor subagent
skills/<agent-id>/SKILL.md        the agent's OWN know-how skill: when to use, an index of its files
skills/<agent-id>/learned-rules.md   "Regole imparate"
skills/<agent-id>/references/…    the agent's knowledge files
skills/<other>/SKILL.md (+files)  owned and shared skills; scripts only inside a skill: skills/<n>/scripts/
codex/agents/<agent-id>.toml      generated Codex custom agent (header "generated from agents/<id>.md")
```

- **Knowledge is a skill, not a top-level `knowledge/` folder.** None of the three tools loads a plugin's
  `knowledge/` or a plugin `CLAUDE.md`; all three load skills. The agent's own skill (`skills/<agent-id>/`) carries the
  learned rules and the files, so they reach every tool unchanged. A root `scripts/` is likewise not loaded by any
  tool: scripts belong to the skill that calls them (Agent Skills `scripts/`).
- **SKILL.md frontmatter = the six spec keys only** (+ `metadata` for our ids). Claude-only keys in a source skill are
  listed at export ("Cursor e Codex li ignorano; claude.ai li rifiuta") and kept only if Brother ticks them.
- **`agents/<agent-id>.md`** frontmatter: `name`, `description` (role + manifest `whenToUse`, ≤ 1024), `model:
  inherit` (valid in both Claude and Cursor), `effort`, `tools` (ToolClass → Claude names: read → Read, Grep, Glob;
  edit → Edit, Write; shell → Bash, PowerShell; web → WebFetch, WebSearch; mcp/browser → `mcp__<server>__*`),
  `readonly: true` when the agent has no `edit`/`shell` (Cursor), `skills: [<agent-id>, …owned]` (Claude preload).
  Body = the instructions, then `## Contratto` (manifest whenNotToUse, input, output, successCriteria), then "Usa la
  skill `<agent-id>`: regole imparate e file di riferimento". No `permissionMode`, `hooks`, `mcpServers` ever.
- **`codex/agents/<agent-id>.toml`**: `name`, `description`, `developer_instructions` = the same body,
  `model_reasoning_effort` from effort, `features.shell_tool = false` without `shell`; no `model` (engine-specific).
- **`sbagent.json`** (`format: 1`): `packId` (`<agent-id>-<16 hex>`, kept on the agent at first export, never a GUID:
  the guard flags GUIDs), `revision` (monotonic per packId), `contentHash` (sha256 of every other file, sorted),
  agent `{id, name, role, category, instructionsFile, manifest, engine, model, effort, tools, permissionCeiling}`
  (model and ceiling are **recommendations**), `icon {symbol, tone}` only, `skills: [{name, owned|shared, hash}]`,
  `createdAt`, `exportedAt`, `appVersion`, optional `stats` (§3). Instructions are not duplicated: the app reads them
  from `agents/<agent-id>.md`; the TOML is regenerated on import and a hand-edited copy is ignored with a note.

### 2. On disk in the app, owned vs shared, growth

- **Rule (Brother, 18/10): "agents are specific to each user, except the presets".** **Presets** (the built-in
  `default-<role>` agents: today the `ROLES` table in `catalog.ts`, know-how in `src/main/agents/presets/<id>/` in
  the pack layout, shipped as `out/agent-presets/` like `out/guard/`) are read-only templates; an untouched preset
  follows app updates (a higher `presetRevision` = a new version on trial, §4.4). **Fork on edit**: the first edit
  of a preset (instructions, know-how, an approved learned rule), an import or a new agent makes it the **user's
  own**: files copied to the brain, `origin: {kind: 'preset', presetId, presetRevision}` (already in `catalog.ts`)
  kept as the fork base. A newer preset never overwrites a fork: the agent page shows **"Preset aggiornato ·
  Confronta"** (old preset → new preset diff beside the fork): Tieni il mio · Adotta il nuovo (new version on
  trial) · Copia a mano; any choice moves the fork base to the new revision.
- **The user's own agents live in the brain**: `<domain>/agents/<agent-id>/skills/<agent-id>/…` + other owned
  skills (the pack layout minus generated files). Why not the app data folder: the rule makes an agent the *user's*
  data; the brain is the user's (one per person, versioned, synced between their PCs, backed up, ADR 0059), app data
  is per install and per machine (lost on reinstall); a colleague has their own brain, so a fork is never shared by
  accident. Presets stay in the app: they are the app's, versioned with its releases. The definition stays in
  `agents.v2.json` (versions, trial, probation are local run state) and gains `knowhow: { folder, linked: string[],
  hash }` and `pack?: { id, revision, importedFrom? }`; `knowhow.hash` is a behavioural field (`BEHAVIOUR_FIELDS`):
  a know-how change makes a new version and goes through the §4.4 trial.
- **Owned** skills live in the agent's folder and travel with it. **Shared** skills are the brain's or the user's
  (`.claude/skills`, `.agents/skills`), referenced by name in `linked`; the Orchestrator still attaches extra skills
  per run (§4.8), and run tags keep recording them. At run start: Claude gets the folder in the per-run plugin
  (`claude-plugin.ts`), Codex as a skill root (`codex.ts`), Cursor UNVERIFIED (no per-launch skill root known; until
  then the own skill's SKILL.md and learned rules are appended to the injected instructions).
- **Growth.** Writers: Brother (agent page, direct edit → `userLocked`, §1.1) and the Orchestrator, which only
  proposes, through **periodic maintenance jobs**: scheduled app jobs run as agents on whatever engine routing picks
  (engine-agnostic), read recent runs and feedback (§4.3) and call `agent_learn_propose {agentId, rule, evidence}`.
  Never a popup: proposals wait in the asynchronous **"Da approvare"** section, opened when Brother wants (Approva ·
  Modifica · Scarta). Scheduler and card surface are the brain-pulse ADR's (branch `docs/brain-pulse`, in progress);
  this ADR only supplies the job and the card kind `learned-rule`. Approved → appended to `learned-rules.md`
  (`- <rule> · <date> · <evidence ref>`) → a **new version in probation** (§4.4, §4.7); on a preset it forks first.
  Caps: 200 lines of learned rules, 50 knowledge files, 10 MB per agent; past a cap the proposal asks to merge.
- **Modern practice (checked 2026-10-18).** *Presets vs user copies*: Claude Code lets a user or project subagent
  override a built-in or plugin one by name (managed > `--agents` > project > user > plugin) [2]; GitHub Copilot
  dedups custom agents by file name, "lowest level takes precedence" (user > repo > org > enterprise) [15]; Cursor
  loads user, project and plugin agents [7][8] (precedence on a clash UNVERIFIED). All shadow a whole file by name
  and keep the user's copy as plain files in user scope; none of the docs read warns that the shadowed base changed,
  so "Confronta" is above the norm. *Suggested memories*: ChatGPT saves memories itself, shows "Memory updated" and
  lets the user review or delete them [16]; Copilot Memory stores repo facts with code citations and no approval,
  re-validates them before use, drops unused ones after 28 days [17]; Claude Code auto memory writes `MEMORY.md`
  with no approval (edit via `/memory`), while `/doctor prompt-audit` proposes edits and applies nothing unasked
  [18]; Cursor removed Memories in 2.1 in favour of user-written rules [19]. Brother's queue + probation is stricter
  than all four, which fits: a learned rule changes behaviour and travels in packs to colleagues.
- **Recommendation differs (small, additive; Brother decides):** borrow Copilot's hygiene so "Da approvare" never
  becomes a backlog: each proposal carries its evidence refs and the job re-checks them at review time (stale →
  marked "superata"); pending proposals expire after 30 days and duplicates are merged by the job; an approved rule
  whose evidence no longer holds (the job finds it on a later pass) is proposed for removal, never deleted silently.

### 3. Export: included, excluded, guard first

- **Included**: the active version's behaviour, the own skill, owned skills, linked shared skills (decided 18/10:
  pre-ticked, each can be unticked), icon `{symbol, tone}`. **Excluded, always**: metrics, run records and tags,
  chats, feedback, version history, trial/probation state, origin evidence, `userLocked`, raster avatars (fall back
  to the category symbol), MCP server configs, hooks.
- **Anonymous summary** (decided 18/10: a checkbox at export, off by default): `stats: {runs, successHuman,
  failHuman, versions, monthsUsed}`, counts only, no skill/app/repo slices (app and repo names are customer data),
  no dates finer than months. A colleague sees "40 runs, 31 confirmed successes" without any content.
- **Guard before the zip.** Export writes the files to a staging folder in the app's temp, runs the shipped
  `out/guard/scan.mjs --json` (secrets, emails other than example domains, private IPs, user paths, GUIDs, forbidden
  files) once per domain deny list (`brain/guard.ts` `findGuard`; a missing deny list blocks, fail-closed, as a push
  does), and only on a clean result writes the zip. A block shows a readable list grouped by file (`file:line · rule`,
  never the value) with per-item fixes: **Escludi** (drops the file, rescans), **Apri** (edits it in the agent's
  folder, rescans), **È un falso positivo** (a hash-pinned line in a private `allow-agentpacks.txt` in the publish
  folder, ADR 0061 rules). Binary media is blocked by the scanner's rules: Escludi or convert to text.

### 4. Import: what is accepted and how it is checked

- **Accepted sources**: `.sbagent`; a `.zip` or folder that is a Claude plugin (`.claude-plugin/`), a Cursor plugin
  (`.cursor-plugin/`), an Agent Plugin or Codex plugin (root `plugin.json` / `.codex-plugin/`), a single skill
  folder (SKILL.md at its root); single files `.claude/agents|.cursor/agents/*.md` and `.codex/agents/*.toml`. Each
  agent file becomes an agent draft, each skill an owned skill of it (a plain skill: a shared skill, no agent).
  Foreign `hooks/`, `mcp.json`/`.mcp.json`, `bin/`, `commands/`, `settings.json`, `rules/*.mdc` are never imported
  (they run or apply on their own): shown under "Ignorati" (a `.mdc` rule can be pasted into instructions by hand).
- **Archive limits** (own zip reader, `node:zlib` only, no dependency): ≤ 20 MB packed, ≤ 50 MB unpacked, ≤ 500
  entries, ≤ 2 MB per text file (the scanner's limit), ratio ≤ 100:1 per entry, depth ≤ 8; methods stored/deflate
  only; refused: zip64, encryption, symlinks, absolute paths, drive letters, `..`, backslashes, Windows reserved
  names, case-insensitive duplicates. Extraction into a fresh staging folder; nothing touches the brain before Apply.
- **Validation**: `sbagent.json` `format` known (newer → "aggiorna l'app"); every SKILL.md through `checkMd('skill')`
  plus name = folder; agent `.md` through `checkMd('agent')`; TOML through a strict subset reader (strings, multiline
  strings, booleans, `[features]`; anything else refuses the file). The guard scan runs on staging: a secret refuses
  the import; personal-data findings are shown and Brother decides.
- **Permissions never above Brother's ceiling**: an imported agent is treated as Orchestrator-authored (§4.1):
  explicit `tools`, ceiling ≤ `default` (a pack's `acceptEdits` is shown as "richiesto, non concesso"), MCP names that
  do not exist locally are dropped with a note; runs still use `min(ceiling, Brother's mode)`.
- **Scripts**: every file under `scripts/`, any `.sh .ps1 .py .js .mjs .cmd .bat`, every `` !`cmd` `` line and
  `hooks:` key in a SKILL.md are listed with their full text; they need an explicit "Approvo questi script" (else the
  skill is imported without them and marked so). The app never runs them; executables (`.exe`, `.dll`, `bin/`) are
  refused.
- **Icon** only from `AGENT_SYMBOLS` × `AGENT_TONES` (`checkedAvatar`); unknown → the category symbol. No image.
- **Collisions**: same `packId` and higher `revision` → offered as an update, saved as a **new version on trial**
  (§4.4, Brother confirms); same or lower revision → "già presente" (Importa come copia). Another agent with the same
  id or name → renamed `<id>-2`, "(importato)". A skill name already taken by a different skill → kept as owned in the
  agent's folder (namespaced in Claude), the user's skill untouched.
- **Probation**: a new imported agent starts in probation (§4.7) with `probation.source = {kind: 'import', packId,
  revision}` instead of a request item; same keep/retire rules and the cap of 10 (over it the import is refused with
  Tieni/Ritira links).

### 5. Sharing (v1: a file)

v1 shares a file: a `.sbagent` sent by any channel; the colleague drops it on the app, or unzips it for a tool (§6).
Later, without changing the format: a git repo of packs (one folder per packId, `revision` as the tag, the app
pulls and shows updates as trial versions) or a team folder (OneDrive/SharePoint) watched for new revisions; both
reuse import as is. A Claude/Codex marketplace file (`marketplace.json`) over that repo is a cheap third option.

### 6. Use in each tool without the app, and what is lost

"Esporta per…" writes a folder that mirrors the tool's config dirs, to merge into `~` or a repo root:
**Claude Code** `.claude/skills/<n>/`, `.claude/agents/<id>.md` (or the unzipped `.sbagent` as is with
`claude --plugin-dir`, names namespaced `<id>:<n>`); **Cursor** `.cursor/skills/<n>/`, `.cursor/agents/<id>.md`;
**Codex** `.agents/skills/<n>/`, `.codex/agents/<id>.toml`. Same bytes as the zip, pure function of it.

| Feature | Claude Code | Cursor | Codex | App only (`sbagent.json`) |
|---|---|---|---|---|
| Skills (Agent Skills) | yes | yes | yes | owned/shared, hash |
| Instructions + contract | subagent body | subagent body | `developer_instructions` | — |
| Learned rules, knowledge files | own skill | own skill | own skill | — |
| Skill preload by the agent | `skills:` | lost (by description; UNVERIFIED) | lost (by description) | linked list |
| Model | `inherit` | `inherit` | omitted | recommended model, engine |
| Effort | `effort` | lost | `model_reasoning_effort` | effort |
| Tool narrowing | `tools` | `readonly` only | `features.shell_tool` only | ToolClass list |
| Permission ceiling | not emitted | not emitted | not emitted (inherits parent) | recommendation, clamped |
| Icon, category, versions, probation | lost | lost | lost | `{symbol, tone}`, category |
| Plugin install | `--plugin-dir` / marketplace | UNVERIFIED local install | marketplace.json (UNVERIFIED with a zip) | — |

UNVERIFIED (not in the docs read): Cursor ignoring Claude-only keys in `agents/*.md` (else the Cursor export drops
them, as it does); Cursor with both `plugin.json` and `.cursor-plugin/plugin.json`; Claude plugin subagents honouring
`effort` and `skills`; a Cursor subagent seeing project skills.

### 7. UI, IPC, PRs

- **UI**: Agenti page, agent detail menu: **Esporta…** (target `.sbagent` · Claude Code · Cursor · Codex; the include
  list with ticks; stats opt-in; scan result with per-item fixes; save dialog in main). List header: **Importa…** and a
  window-wide drop overlay ("Rilascia per importare"), any page, for `.sbagent`, `.zip` or a folder; both open the
  same review dialog (kind, agent, skills, scripts to approve, permission clamps, findings, collision choice) →
  **Importa in prova**. New tab "Regole imparate" (the file, with a link to its pending cards in "Da approvare",
  brain-pulse). Presets: badge "Preset" (read-only until edited, then "Mio · da <preset>") and the "Preset
  aggiornato · Confronta" banner (§2).
- **IPC** (`contract.ts` map + `INVOKE_CHANNELS`, `test/unit/contract.test.ts`): `agents:exportPlan {id, target}` →
  `{token, items, findings, warnings}`; `agents:exportFix {token, item, action: 'exclude'|'rescan'|'allow'}` → plan;
  `agents:export {token, includeStats}` → `{ok, path} | {ok:false, findings}` (main picks the path);
  `agents:importInspect {pick: true} | {dropped: string}` (path from preload `webUtils.getPathForFile`, main checks it
  is an existing file or folder) → review `{token, kind, agents, skills, scripts, ignored, findings, clamps,
  collision}`; `agents:importApply {token, approveScripts, collision: 'update'|'copy'|'rename'}` → profiles;
  `agents:importCancel {token}`; `agents:learnList|learnDecide {id, proposalId, decision, text?}` (the
  `learned-rule` card's backend in "Da approvare"); `agents:presetCompare|presetResolve {id, choice}`. Tokens live in
  main, 10 min, one use; the renderer never sends a path to read except the dropped one.
- **PR 1 · pack core (main, no UI)**: `src/shared/agent-pack.ts` (types, validators, ToolClass maps), `agents/pack/
  zip.ts`, `pack/emit.ts` (zip + 3 tool targets), `pack/read.ts` (kind detection, TOML subset), `guard.ts`
  `scanTree`, `knowhow` on the definition. Tests: round trip byte-identical; golden layout per target (Claude: plugin
  name = agent id, not reserved, every SKILL.md name = folder with spec keys only, agent md keys ⊆ Claude's; Cursor:
  `.cursor/agents/<id>.md` keys ⊆ {name, description, model, readonly}; Codex: TOML has the 3 required keys and
  parses, skills under `.agents/skills`); zip-slip, bomb, limits, symlink, zip64 fixtures; guard blocks a private IP
  and a real-looking email, passes `@example.com`; a live test runs `claude plugin validate --strict` on an unzipped
  pack when the CLI is present.
- **PR 2 · flows + IPC**: export plan/fix/allow, import inspect/apply for every accepted kind, clamps, scripts
  approval, collisions, probation source, `agent_learn_propose` + learn channels, the learned-rules maintenance job
  (registered with the brain-pulse scheduler), preset fork-on-edit and compare. Tests per channel (contract test,
  demo wiring): secret refuses import; `acceptEdits` clamped; update → trial version; rename; cap 10; scripts
  unapproved → skill without scripts; foreign hooks/MCP listed as ignored, nothing written; editing a preset writes
  only to the brain; a higher `presetRevision` leaves the fork's files byte-identical and raises Confronta.
- **PR 3 · UI**: dialogs, drop overlay, Regole imparate tab, it/en strings (ADR 0057). Fast e2e (ADR 0042): export →
  import round trip lands in "In prova"; drop a file; a blocked export shows the list and Escludi clears it; the
  review shows a script and needs the tick.

## Consequences

One package serves the app and the three tools; the price is three small manifests and one generated TOML per pack,
and model/effort/permissions that only the app carries faithfully. The guard and the import checks make a pack a
reviewed artifact, never auto-run code. A zip reader is code to own; it is small and fixture-tested. Nothing is
Claude-only: presets and forks share the pack layout and export to all three tools (§6); the job runs on any engine.
The four open questions are closed (Brother, 18/10: §2 know-how and learned rules, §3 summary and shared skills);
only the "Recommendation differs" hygiene (§2) awaits his call.

## Sources (read 2026-10-18)

[1] https://code.claude.com/docs/en/skills · [2] https://code.claude.com/docs/en/sub-agents ·
[3] https://code.claude.com/docs/en/plugins-reference · [4] https://agentskills.io/specification ·
[5] https://cursor.com/docs/context/skills · [6] https://cursor.com/docs/context/rules ·
[7] https://cursor.com/docs/context/subagents · [8] https://cursor.com/docs/reference/plugins ·
[9] https://learn.chatgpt.com/docs/build-skills (from developers.openai.com/codex/skills) ·
[10] https://learn.chatgpt.com/docs/agent-configuration/agents-md ·
[11] https://learn.chatgpt.com/docs/agent-configuration/subagents ·
[12] https://developers.openai.com/codex/plugins/build · [13] https://agent-plugins.org ·
[14] https://developers.openai.com/codex/custom-prompts (deprecation seen in the search result, page not opened) ·
[15] https://docs.github.com/en/copilot/reference/custom-agents-configuration (precedence seen in the search
result, page not opened) · [16] https://help.openai.com/en/articles/8590148 (page returned 403; content from the
search result and OpenAI's memory announcement, UNVERIFIED first-hand) ·
[17] https://docs.github.com/en/copilot/concepts/agents/copilot-memory · [18] https://code.claude.com/docs/en/memory ·
[19] https://forum.cursor.com/t/are-my-memories-gone/144057 (Cursor staff reply)
