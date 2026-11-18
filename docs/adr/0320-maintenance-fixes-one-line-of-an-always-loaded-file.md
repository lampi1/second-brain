# ADR 0320 · The maintenance fixes one line of an always-loaded file

Date: 2026-11-18 · Status: accepted (owner, issue #435: «Maintenance can change skills and role texts, but not the rule
files every job loads at start … A card … targets one line of an always-loaded rule file; shows the exact before and
after text; goes into the brain candidate version like skill changes … never allowed on safety, permission, settings
or hook lines») · Amends: ADR 0243 («No rule writes»), ADR 0195 (the candidate brain)

## Context

Since ADR 0243 the maintenance writes skills and lines of a role's text, never the fixed core every job loads
(`brain.json` `fixedFiles`: `AGENTS.md`, `me.md`…). A fix that holds for every role could then land only in one
role's text while the always-loaded file kept the old, wrong line. Seen in the owner's brain: a commit rule was fixed
for one role; the other roles kept following the always-loaded line (stage everything) and committed other chats'
pending files several times.

## Decision

1. **One line, where it is.** A research finding of kind `rule` may carry `change { file, before, text }` and no role:
   `file` is an always-loaded file of the brain, `before` the whole line as it is now, `text` the line that takes its
   place (`src/main/brainmodel/rule-line.ts`). No new card kind: it is a `rule` finding, so the caps, the wording and
   the «riuscito se…» check stay the ones of a brain change. A rule for every role without `file` is still refused
   (ADR 0243): new knowledge for everyone remains a skill.
2. **Exactly that line.** The line is found by its whole text (trimmed, inner spaces folded, as the item delta of ADR
   0194 compares lines) and must be in the file exactly once; its indentation and every line end stay (a file with
   mixed line ends keeps each). One line per finding; a line break, a control character, an empty line or more than
   800 characters is refused.
3. **Never a safety line.** Refused when the old or the new line is about safety, permissions, settings, hooks,
   production or secrets (a word list, plus `checkPermissionText`), or when the line sits under a heading with one of
   those words (the «Safety» section of `me.md`). Those lines stay the user's to edit by hand. The guard refuses when
   in doubt (independent review, 2026-11-18): the words are English, Italian and German and are also looked for with
   `_ * \` ~` and camelCase taken apart (`__Safety__`, `dangerously_skip_permissions`, `GITHUB_TOKEN`); a heading
   counts in every form (ATX at any indentation, Setext, a bold-only line, a `# …` inside a code block until the next
   heading); a line that opens or closes a code block is never written or replaced, and a block closes only with its
   own marker, so no edit can hide a section inside a code block.
4. **Through the candidate brain.** The finding is a brain-file finding (`isCandidateFinding`): it is planned with the
   others on the virtual copy, and the candidate's before/after diff of the file is that one line. Rejecting the
   candidate writes nothing; approving applies it as one change whose «Annulla» puts the old line back; a file edited
   in between makes the candidate stale, as for every candidate. Applied alone (no candidate), the card shows the line
   before and after as a diff and goes through the change log the same way (`service.ts applyResearch`).
5. **Checked three times.** By the tool when the research proposes it (the answer names the always-loaded files and
   says why not, so the research corrects itself at once), by the candidate's plan, and at the apply, each on the file
   as it is then.
6. **The exact text on the card.** The finding's «removes» and «adds» are written by the app from the two lines, never
   the research's own words.
7. **Never past the fixed budget.** A line that would make the always-loaded files grow past `rules.fixedBudget` is
   refused at the three checks (`editAlwaysLoaded`): over it every launch stops (`rules/instructions.ts`), which the
   agents' write guard already prevents (`rules/guards.ts`). A line that shortens the core passes even when the user
   left it over the budget.

## Consequences

- An always-loaded file can now change without the user typing it; the change is always one visible line with its
  undo, and never a protective one.
- The research is told to fix a wrong always-loaded line where it is instead of working around it in one role's text
  (`research-prompt.ts`).
- Tests: `test/unit/brainmodel/rule-line.test.ts`, `research-candidate.test.ts` (plan, reject, approve, undo),
  `service.test.ts` (a card applied alone).
