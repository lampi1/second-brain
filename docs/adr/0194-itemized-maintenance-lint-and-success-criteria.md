# 0194 — Maintenance quality: itemized changes, a brain lint and «riuscito se…»

Status: accepted. Builds on ADR 0077, ADR 0109, ADR 0129, ADR 0132, ADR 0150 and ADR 0153.

2026-10-29.

## Context

The owner asked to implement the analysis «Second-brain: app solida, brain e Manutenzione». Three of its points are
about the quality of what «Manutenzione» does:

- **M1, context collapse.** ACE (Zhang et al., «Agentic Context Engineering», ICLR 2026,
  https://huggingface.co/papers/2510.04618) measured «brevity bias» and «context collapse» when a memory rewrites itself
  whole: each rewrite drops a few details until the playbook is a stub. Their cure is incremental per-item deltas. Our
  memory tidy-up let a one-shot agent rewrite facts, the upgrade and the migration rewrite whole files, and an approved
  research change goes through the change log with no check of what it removes.
- **M2, a lint.** Karpathy's «LLM wiki» lint
  (https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) checks orphan pages, broken links and concepts
  without a page; Solenta (https://github.com/currentbits/solenta) checks that the files a fact cites still exist. A
  fact about a file that is gone misleads every agent that reads it.
- **M4, did it help?** A proposal says what it expects in free words; nobody checks it afterwards. The evidence layer
  (ADR 0109) measures every change on corrections per run, but needs 20+ runs a side and never proposes an undo.

## Decision

**M1 — itemized changes (`brainmodel/item-delta.ts`).** The items of a markdown text are its non-blank lines (bullets,
headings, paragraph and code lines), compared as a multiset. `ChangeLog.apply` refuses any write of a maintenance job
(every job but the user's own) to a `.md` file that loses an item it does not list in `removed` with a reason, and a
whole file removed without a `WHOLE_FILE` item: nothing is written, a warn log has cause and hint, and `DeltaRefused`
carries an Italian message — the card's error when the user approved a research change, a skipped item with a note in
the migration report. Additions are always allowed. The write paths list what they remove: the migration's regenerated
skill (each dropped generated line, «the source section changed»), the upgrade's moved blocks («moved to <place>»), a
merged skill's deleted file, a forget card's removal, a lint card's one line. An approved role change is checked the
same way on the role's text. The memory tidy-up's rewrites are one item edit each (`checkFactEdit`): a rewrite under a
fifth of the fact's length is refused with a warn log and the fact stays.

**M2 — the brain lint (`brainmodel/brain-lint.ts`, `rules/cited-paths.ts`).** At the click, after the log step, zero
tokens: orphan notes (no inbound `[[wiki]]` or markdown link from another note; index / hub files, `rules/` and the
app's own top files excluded; only in a brain with at least three resolved links), broken links, concepts (a missing
`[[wiki]]` target cited three times or more, or a **bold term** in three notes or more with no note of its own), memory
facts citing a brain or repository file that is gone, confirmed facts whose cited file changed since the lint first saw
it (sha256 kept in `userData/brain-lint.json`), and lines of brain skills and `rules/` files citing a file that is gone.
A path counts only when it looks like one, and is «missing» only when the folder it points into exists where it should
and the file does not; a bare file name, a URL or another machine's path is never missing. Each new finding is a card in
Memoria → Proposte (the existing 'research' source, new kind `lint`, at most 3–5 per check per click, never one already
carded, approved or rejected; an open one whose problem is gone is dismissed) with one plain question, e.g. «Il file
citato non c'è più: tolgo il fatto?». Approving it is one item delta with «Annulla»: the fact retired (a memory tidy undo),
the line removed, the link turned into its text, one line in the hub, or a new note listing who cites the concept. The
launch memory (`rules/launch-memory.ts`) skips a fact citing a file that is gone, with an info log. The research prompt
also asks the model to look for contradictions between notes, rules and skills and propose the fix as a rule or skill
change.

**M4 — «riuscito se…» (`brainmodel/success-check.ts`).** `maintenance_propose` takes an optional `success` from a fixed
set the app computes from what it records: `fewer-corrections` (role optional), `more-verified` (role),
`fewer-log-errors` (a log group key), `skill-used` (skill, n). A brain change without one gets a default (a skill is
used three times, else corrections go down). The card says it in words with what to expect; approving stores it on the
change (`BrainChange.success`). Seven days after the change, `BrainModelService.checkOutcomes` compares the week before
with the week after once (`successCheck`): means need three runs a side and move by the evidence layer's margin, shares
by 15 points, log counts by a quarter and two lines. Worse, and still undoable → a card «Questo cambio non ha aiutato: lo
annullo?» (kind `revert`) with the numbers; approving it is the change log's rollback. It runs 90 s after the start,
hourly, and at every click. `skill-used` with fewer uses than wanted is worse only when the week after had at least
three runs (a quiet week is unknown); `fewer-corrections` leaves out runs started before the app counted the runs'
corrections after a report (ADR 0197). A candidate brain (ADR 0195) applies several findings as one change: it carries
every member's criterion (`BrainChange.successes`, read with `changeCriteria`, an old entry's single `success` too), its
card shows each finding's «riuscito se…», each is checked (`successChecks`) and the first worse one makes the card
(review 2026-10-29). A revert card is never applied by itself and its rollback is not the user undoing a decision
(ADR 0193).

## Consequences

- A maintenance job can no longer shorten a brain text silently. A future job that rebuilds a file must list what it
  drops with a reason; the user's own edits are never checked.
- The lint never writes by itself: every fix is a card. A messy brain gets a few cards per click, not a wall.
- A fact whose file moved is not given to the agents until the card is answered; rejecting the card does not bring it
  back to the launch (the path is still missing), which is the safe side.
- The «riuscito se…» check is coarse (one week, small samples, overlapping changes share runs): it only proposes an
  undo, never makes one, and an unknown result makes no card.
- Contract additions (all optional): `ResearchKind` gains `lint` and `revert` (the tool keeps the seven research kinds,
  `RESEARCH_TOOL_KINDS`), `ResearchProposal.success | lint | revert`, `BrainChange.success | successCheck`,
  `MaintenanceRun.cards.lint | reverts`, the Proposte group `note`.
