# ADR 0072 · A fresh brain starts empty: the app's rules, tools and agents stay in the app

Date: 2026-10-18 · Status: accepted (owner, 18/10: "mi aspetto che a installazione pulita non ci siano rule già o
procedure o cose così o skill, mi aspetto pulito; tutto quello che riguarda l'app deve essere invisibile nel brain
dell'utente ma dentro le logiche dell'app. L'utente appena la installa deve essere pulita al punto 0.") · Builds on:
ADR 0062 (machinery in the product, `machinery: "product-v1"`, app-owned tools under userData), ADR 0060 (per-launch
plugin and adapters)

## Context
ADR 0062 moved the template's **code** (tools, hooks) out of a new brain, but both creators still filled the new
folder with the template's **text**: topic rules (`code.md`, `hub.md`, `brain-rules.md`, `map.md`, `routines.md`,
`rules/`, `ops/runbook/`), agents (`.claude/agents/`), skills (`harness/claude/skills/`, `.cursor/skills/`), output
styles, `AGENTS.md` / `CLAUDE.md`, example notes (`now.md`, `ideas.md`, `ai-wins.md`, `START-HERE.md`…), the model
and price table and a `me.md` with preset working-style and safety rules. On a clean install the Procedure page,
the Skill page and the profile showed the app's own content as if it were the user's. The automatic first-run memory
(`src/modules/ai-first/default-brain.ts`) even copied the template's code into the folder.

## Decision
1. **A fresh brain holds only the owner's part**: `me.md` (name, role, language, the empty "Main work" and "How to
   work with" sections the profile page edits), `brain.json` (`machinery: "product-v1"`, the values the owner typed,
   `rules: { topicFiles: [], appRules: true }`) and a credentials `.gitignore`, in a local git with one day-one
   commit. One function writes it (`src/main/rules/new-brain.ts` `writeFreshBrain`), used by BrainCreator (which
   still runs the verified installer into its private stage, then keeps only this) and by the automatic memory
   (which no longer copies anything). The automatic memory also gets an empty `projects/` (its repos folder).
2. **`rules.appRules: true` = the app supplies the product's text at each launch**, from the per-brain copy it already
   renders under userData (`rules/tools.ts` `ensureTools`, now also the template's topic files, Claude agents,
   `explain` and `create-agent` skills, output styles and `harness/models.json`, with absolute brain paths to them
   rewritten to the copy):
   - boot rules (what `AGENTS.md` and `me.md` "Safety" said): `rules/instructions.ts` `appBoot`, before the brain's
     own always-loaded files;
   - topic rules: `rules/topics.ts` reads the copy's topic list (`.sb-tools.json` `topics`) before the brain's own
     `topicFiles`, for the hook runtime and the Codex/ACP launch text alike;
   - agents, skills, output styles: the Claude plugin takes them from the copy after the brain's own folders
     (`brain/adapters/claude-plugin.ts`): a file the owner writes with the same name wins;
   - the model and price table: `rules/tools.ts` `brainFile` (routing) and `prices.mjs` fall back to the copy's
     until the owner adds `harness/models.json`.
3. **Files appear on first real use**: the memory writers create `now.md`, `ai-errors.md`, `journal/`, `ideas.md`
   when first written (`mem.mjs` creates the default section of `now.md`); the tools that read them (`day.mjs`,
   `ctx.mjs`, `recurrence.mjs`, `brain-lint.mjs`, `brain-map.mjs`) treat a missing file as empty. Agent know-how
   folders (`agents/<id>/`, agent packs) are written only when the user creates, imports or edits an agent.
4. **Legacy brains are untouched**: `appRules` defaults to false; a brain with its own `AGENTS.md`, topic files,
   agents and tools keeps them and keeps working as before (no deletion, no migration). `writeFreshBrain` refuses a
   non-empty folder. A brain is recognised by `brain.json` (product) or by `AGENTS.md` + `ops/tools/brain-site.mjs`
   (legacy): `brain/detect.ts`, `brain/index.ts`.

## Consequences
- The brain pages of a fresh brain read empty, with plain empty states (Procedure, Regole imparate, Skill).
- `brain-template/` stays the source of the product's text and the standalone `install.mjs` (README path) is
  unchanged: a person installing by hand still gets the full template in their folder.
- Not delivered from the app yet: the Cursor-only `.cursor/skills/regia` skill and the `{{BRAIN_NAME}}` entry skill
  (both are entries from the user's global CLI config, which the app never wires); Codex gets the topic text but not
  the copy's skills as skill roots.
- Test: `test/unit/brain/fresh-brain.test.ts` (both creators, empty pages, machinery delivered, nothing written into
  the brain), `src/modules/ai-first/default-brain.test.ts`.
