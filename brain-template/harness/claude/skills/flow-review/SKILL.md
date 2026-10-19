---
name: flow-review
description: Studies {{OWNER}}'s past work (Claude transcripts, journal, now.md, ai-errors, ai-wins, proposals, dated rules in me.md, costs) to find where his workflow loses time or money - repeated corrections, permission blocks, stuck work, manual steps done 3+ times, answers he didn't understand - and proposes max 7 ranked, measured changes. Use only when {{OWNER}} asks ("ottimizza il flusso", "dove perdo tempo?", a review he requested). Not for applying changes (brain-edit skill). Read-only; writes only its report and proposals.md.
---
<!-- Shipped skill: the on-demand workflow review. What the app's maintenance jobs already do by themselves is not re-proposed. -->

# Flow review: where the way of working loses time or money

You find where {{OWNER}}'s way of working with agents loses time or money, and propose the few changes worth making,
each with a number to measure it. Report in Italian, plain words; code, paths and rule text in English.

The app already does part of this by itself, with no step from {{OWNER}}: its maintenance jobs turn a task done three
or more times into a skill, a correction into a lesson for the role's text, and merge duplicate skills and memories.
Do not propose those; propose only what needs {{OWNER}}'s decision (a habit, a permission, a script, a rule to drop).

Read first (all under `{{BRAIN}}/`): `ai-errors.md` (count errors by type, area and who noticed; the share the agent
found itself is a key metric), `proposals.md` (never re-propose a `rifiutata` one without new evidence; re-measure
`applicata` ones older than 7 days), `map.md`, `hub.md`, `routines.md` "Revisione", the last 3 files in `reviews/`
and the last `journal/AAAA-Www.md`. {{OWNER}}'s target: automatic pipelines (bug → triage → fix with evidence → PR)
and a harness-independent tool (`ideas.md` "Flow come prodotto").

Input: a period (default: since the previous report in `reviews/`; "oggi" = today), optionally a focus ("permessi",
"QA").

## Steps
1. Signals: `node ops/tools/flow-signals.mjs --since <date> [--until <date>]` (corrections, confusion, bare "ok/vai"
   share, denials, tool errors, waits); `node ops/tools/feedback-stats.mjs --since <date> --devops` (what works);
   `node ops/tools/cost.mjs --since <date>` (where the money goes, `routines.md` "Revisione" 2b).
2. Context for each candidate: `Grep` on `~/.claude/projects/*/<session>.jsonl` (never `Read` a whole jsonl), or the
   session tools when the chat has them; regex hits are only candidates.
3. {{BRAIN_NAME}}: journal `attrito`/`interruzione`/`lezione`, `now.md` lines stuck > 3 days, `bug-log.md` patterns that
   escaped, `git log --since <date> --stat` (churn on rule files = rules that don't stick).
4. Find and count (dates, minutes, one quote ≤ 15 words): the same correction twice, blocks grouped by root cause,
   stuck handoffs, manual steps ≥ 3 times, misunderstood answers, time sinks, costs.
5. Rank max 7 proposals by minutes or $ saved per week ÷ effort; prefer scripts and hooks over prose rules, deleting
   or merging a rule over adding one; mark "(da verificare)" what the docs did not confirm.

## Rules
- Every proposal needs a metric a script or the journal can count, with today's value; no metric → no proposal.
- Read-only: write only `reviews/AAAA-MM-GG-flow-review.md` (in your worktree if you run in one) and, in
  `proposals.md`, new lines `proposta` (next free `P-NNN`) and measured outcomes. Never edit rules, settings, hooks,
  agents, skills, `now.md`, journal.
- Transcripts hold secrets and customer data: quote only {{OWNER}}'s words about the workflow, never passwords, tokens,
  emails or customers' personal data. Safety: `me.md` "Safety". Never search `{{HOME_WIN}}` recursively.

## Report
File: `# Flow review AAAA-MM-GG (periodo)`, sources + counts, proposals as `N. **Titolo** · problema con evidenza ·
cambio esatto · sforzo S/M/L · rischio · metrica + valore oggi`, "Proposte precedenti: esito", "Da verificare".
Final reply (max 8 lines): report path, then the top 3 as `titolo · evidenza in numeri · cambio · sforzo`.
