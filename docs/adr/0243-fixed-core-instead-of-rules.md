# ADR 0243 · Rules are gone: a fixed core is always loaded, everything else is a skill

Date: 2026-11-09 · Status: accepted (owner, issue #366, «risolvi tutte le issue aperte») · Builds on: ADR 0241 (skill
packages and library), ADR 0242 (role skill) · Changes: ADR 0077 (Regole page), ADR 0082 («Regole imparate» on the
Regole page), ADR 0062 (topic rules injected by the hooks) · Amended by: ADR 0277

## Context
Davide decided that rules disappear. In his brain the hooks injected 11 topic files (`when:` frontmatter, about 300,800
characters) by keyword, tool or path; maintenance appended rules for every role to `rules/lessons.md` (#337); Memoria
had a «Regole» tab with the topic chips and «Regole imparate». Only a fixed core stays: `me.md` with its Safety
section, the hard rules of `AGENTS.md`, the output style and one line per constraint that protects production, secrets
and external actions. The rest becomes skills, which agents load when their description fits.

## Decision
- **No topic injection.** The UserPromptSubmit and PreToolUse hooks no longer inject topic text
  (`rules/runtime.ts`); the instructions fallback of adapters without pre-tool hooks carries only the fixed core
  (`rules/instructions.ts`). The safety guards and the correction reminder are unchanged.
- **The app's topic rules are app skills.** The app-owned tools copy (`rules/tools.ts ensureTools`) writes each
  product topic rule as an app skill `regole-<name>` (description from its title, «Read when» and keywords; body
  rendered for this brain). They show on the Skill page and are edited like any app skill (a brain copy, «Ripristina
  originale»). A shipped skill with the same name wins. The topic files stay in the copy: other product text links them.
- **No rule writes.** Maintenance and research no longer write rules for every role: a correction lesson of kind rule
  goes to the role's text (`brainmodel/jobs.ts`), a research change or candidate of kind rule needs a role and goes
  there (`research.ts`, `service.ts applyResearch`, `research-candidate.ts`). `rules/lessons.md` is not written any
  more (closes #337).
- **«Sempre caricato».** The Memoria tab (old «Regole», same `regole` id and G L key) shows the fixed files of
  `brain.json` (`fixedFiles`, me.md included) as cards with their characters against `fixedBudget`, the same measure
  the launch and the write guard check (`brainmodel/model.ts coreSize`); the app's own fixed rules come on top. Every
  other rule file is listed under «Non più caricate». «Regole imparate» is no longer shown; the self-improvement
  policies still reach Proposte.
- **Every engine reaches them.** Every role's plugin carries the `regole-*` skills (`agents/pack/flows.ts runtime`);
  Codex gets the app's skills folder (`brain/adapters/codex.ts`); ACP, which has no skills, gets each topic skill's
  description and path in its launch text (`rules/instructions.ts topicSkillIndex`).
- **Lessons.** `agent_learn_propose` no longer offers the target `rule`: a lesson goes to the role or to a skill.

## Consequences
- The brain's own topic files stay on disk but reach no chat; moving their procedures into skills is the migration's
  job (#367). Until then an agent reads them only when it opens them.
- The old rule changes in the change log keep their Undo in the tab's maintenance panel.
