---
when: {"prompt":["d'ora in poi","non fare più","regola","rule","skill","agente specialista"],"tools":[],"paths":["**/brain-rules.md","**/rules/**","**/.claude/agents/**","**/.claude/skills/**"]}
---
# Brain rules: how the brain itself is changed

The rules every agent follows when it changes the brain (rules, preferences, skills, agents, tests), above all the
`brain-edit` skill, which applies {{OWNER}}'s requests like "d'ora in poi fai X", "non fare più Y", "cambia questa
skill". Read when: before changing any rule, preference, skill, agent, output style or test. Write when: {{OWNER}}
changes how the brain must be edited.

1. **One rule per concept.** Before writing, search every place a rule can live for the same concept, by keywords and
   synonyms; update or replace the existing line instead of adding one; if two places say it, keep one and point
   from the other (duplicates drift apart).
2. **The right place, chosen from `map.md`.** How {{OWNER}} wants every chat to talk or work → `me.md`; only the hub →
   `hub.md`; code work → `code.md`; a recurring procedure → `routines.md`; production → `ops/AGENTS.md` or
   `ops/runbook/`; a skill → its `SKILL.md`; a subagent → `.claude/agents/<name>.md` (`rules/agent-standard.md`);
   how the brain is edited → this file; a new kind of knowledge → propose a new file with a `map.md` row.
3. **Remove before adding.** If the request makes an existing line obsolete, delete it; the shorter text wins. **The
   fixed context never grows**: a change that adds to it removes, shortens or moves at least as much in the same edit.
   The hook `.claude/hooks/brain-limits.mjs` refuses writes that grow it past the budget.
4. **Format of a rule.** One bullet, {{OWNER}}'s words where possible, the date, the reason in parentheses:
   `- **Short title**: what to do (YYYY-MM-DD, "their words").`
5. **Every rule has a test.** Add or update its case in `tests/behavior.md` (situation, expected, fails if, rule,
   state `nuovo`); a removed rule retires its case. A case that turns `rosso` blocks the change.
6. **Every change is measured.** Add a line to `proposals.md` with the number it should move. Run
   `node ops/tools/brain-lint.mjs` before and after and report the fixed-context and duplicate counts.
7. **Never permissions, settings or hooks.** `~/.claude/settings.json`, `.claude/settings.json`, allow/deny rules and
   hook wiring are written only by {{OWNER}}: prepare the exact text as a proposal and return it.
8. **The live system outside this folder is applied by the hub.** Output styles and skills under `~/.claude/` are not
   edited by the agent: return the exact old → new text; the hub applies it after {{OWNER}}'s ok.
9. **Safety only tightens.** A request that loosens `me.md` "Safety" is not applied: it goes back as a question.
10. **Unclear or conflicting → ask, don't guess.** Change nothing and return one question (2-3 options, the
    recommended one first). A new rule that undoes one born from a correction is a conflict: show the correction.
11. **Report in five lines max**: where, before → after, test case, lint delta, what the hub must still apply.
12. **What never becomes a rule**: a ban born from a temporary failure (a tool down, a login blocked once), a failed
    attempt written as a procedure, a fact of one bug or ticket (→ `now.md`, `journal/`). "Nothing to save" is valid.
