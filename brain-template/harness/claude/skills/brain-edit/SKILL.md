---
name: brain-edit
description: Applies {{OWNER}}'s requests to change the brain itself - "d'ora in poi fai X", "non fare più Y", "cambia questa skill/stile", "ricordati che..." about how agents must work - following brain-rules.md. Finds where the rule belongs, updates or removes instead of duplicating, adds the test case, logs the proposal, runs brain-lint, reports before/after in 5 lines. Use with {{OWNER}}'s exact words. Not for product or production knowledge. Never touches permissions, settings or hooks.
---
<!-- Shipped skill: the brain's editing method (brain-rules.md is the rule text; this is the procedure). -->

# Brain edit: changing the brain on {{OWNER}}'s request

You change {{OWNER}}'s brain (`{{BRAIN}}/`) on his explicit request, with his exact words. Report in Italian, plain
words, no bare ids.

Read first: `brain-rules.md` (the rules: follow them exactly), `map.md` (where things live), `me.md` (already in
context in Claude); for an agent change also `rules/agent-standard.md`. Work in the folder you were started in (the
main checkout; in a worktree, write there and say so).

Input: {{OWNER}}'s exact words and, if given, the case that triggered them. Missing words → ask back, change nothing.

## Steps
1. Restate the request as one rule in one line. Ambiguous or in conflict with an existing rule → rule 10: change
   nothing, ask one question.
2. Search for the same concept everywhere a rule can live (rules 1-2): `Grep -i` with 3-5 keywords and synonyms
   (Italian and English) over the brain's `*.md` (skip `journal/`, `reviews/`, `ops/` data, `playbooks/`), plus
   `~/.claude/output-styles/*.md`, `~/.claude/skills/*/SKILL.md` and `tests/behavior.md`.
3. `node ops/tools/brain-lint.mjs` → fixed context and duplicate count (before).
4. Choose the place (rule 2) and the smallest edit: update or replace the existing line, remove what becomes obsolete
   (rule 3), format per rule 4. Files outside the repo (output styles, skills under `~/.claude/`) or any
   permission/setting/hook: do not edit, prepare exact old → new text (rules 7-8). Safety loosening: rule 9.
5. Apply the in-repo edit with Edit (never Bash for text with backslashes); in fixed-context files trim first, then
   add (the `brain-limits` hook refuses growth while over budget). Add/update the case in `tests/behavior.md` (next
   free `B-NN`, state `nuovo`) and the line in `proposals.md` (next free `P-NNN`, `applicata`).
6. `brain-lint` again (after): if the fixed context grew (output styles counted on the proposed text), trim the same
   amount now; re-check the cases that name a touched file (rule 5). Main checkout: the Stop hook commits. Worktree:
   `git -C <worktree> add -A`, then `git -C <worktree> commit -m "brain: <what>"` (one command per call, never push).

## Never
- Edit `~/.claude/settings.json`, `.claude/settings.json`, hook wiring, `autoMode`, allow/deny rules; a blocked edit →
  stop and report it, never retry another way ({{OWNER}} writes permissions himself).
- Touch production, DevOps, notebooks (`playbooks/`) or other threads' `now.md` lines. Search `{{HOME_WIN}}`
  recursively.

## Report (max 5 lines, rule 11)
`Dove:` file and section · `Prima → dopo:` the exact text (or "nuova riga" / "tolta") · `Test:` B-NN ·
`Lint:` contesto fisso X → Y caratteri, doppioni A → B · `Resta da applicare:` exact external edit or "niente".
