# 0193 — Proposte asks only when the answer is not obvious

Status: accepted. Builds on ADR 0123, ADR 0126, ADR 0132, ADR 0150, ADR 0153 and ADR 0186.

2026-10-29.

## Context

The owner, 2026-10-29: «le proposte in memoria mi trovo spesso ad approvarle tutte, dammi solo quelle sensate dove
realmente l'approvazione non è scontata. Deve essere efficace l'app». Every Proposte card (ADR 0123) waited for a click,
even in groups the owner has never refused, and the app kept no memory of how the owner answers: decisions were only a
log line (`decided by the user`). The owner's standing rule: approval stays only for production actions,
permissions/settings/hooks and texts to colleagues or external systems (GitHub issues included); everything else may
apply by itself with a log entry and an Annulla.

## Decision

**A decision ledger.** `proposals/ledger.ts` keeps one entry per decided card in userData
`proposal-decisions.json` (the last 2000, atomic writes through `agents/local-store.ts`): when, source, group,
`ask.kind`, already applied or not, reversible from here, verified evidence (runs the card can open), size (characters
of content and code), the answer, who answered (`user` / `auto`), the time from the card first shown on top of the deck
(the renderer reports it once with `proposals:shown`) to the decision, the change-log entries the decision made or kept
(`Source.decide` now answers them: a candidate's promotion, a finding's change, the applied change itself) and, later,
`undoneAt`. `ChangeLog.onRolledBack` tells the service after every rollback, from anywhere (the deck, the Log, the
feed): an approved or auto-applied change taken back counts as a no. A corrupt file is moved aside
(`.corrupt-<ms>`), never overwritten, and the ledger starts empty. Nothing is seeded: a fresh install asks everything.

**A policy per group** (`proposals/policy.ts`, pure). Over a group's last decisions (at least 10, at most 200; an undo
after a yes is a no) the 90% Wilson lower bound of the yes share (`shared/success.ts` `successInterval`, z = 1.645, the
same helper as ADR 0186) must reach 0.80: new cards of the group are then approved by themselves through the same
`source.decide` the user's click uses, logged (`proposals` `auto-applied` with group, source and the policy line),
written to the activity journal (kind `brain`) and listed under the deck in «Applicate da sole» with Annulla (the
change log's rollback, or `learn:act` rollback for a loop policy) and «Carte risparmiate questa settimana: N» (since
Monday, not undone). With z = 1.645 this means 11 yes in a row, or 19 with one no. The integrator lowered the brief's 0.95 (52 yes in a row, about 87 with one no) because it would almost never apply anything, against the owner's «deve essere efficace»; safety comes from the undo check (more than 5% of the last 20 undone sends the group back to asking, each undo raises the bar by 0.05, at most 0.95).

**Risk control.** In the spirit of conformal risk control: of the last 20 cards a group applied by itself, more than 5%
undone sends the group back to asking, counting only decisions made after the last such undo, and each undone auto card
raises that group's bound by 0.05 (at most 0.95). Deterministic: everything is recomputed from the ledger at each read.

**Never by itself, whatever the rate.** An explicit allow-list, `AUTO_GROUPS` in `shared/proposals.ts`: skill, rule,
fact, script (scripts and queries) and learning. Never: role (permissions, tiers, tools), setting, forget, issue
(GitHub = external publication); and, inside the allowed groups, a tier or a trial, a card whose text, code or files
touch permissions, tools or hooks (`allowed-tools:`, `.claude/settings`, `hooks/`), production (`prod`, `production`,
`produzione`), an app idea or bug (external). A card that cannot be undone from here (the Battito's rules edit a role's
text without a change-log entry) or whose approve side is blocked is also asked. A failed automatic approval leaves the
card to the user and is not retried.

**Every card still shown says why** («Te la chiedo perché: …», `Proposal.why`, worded by `lib/proposal-ask.ts`
`whyText` in it/en/de): it touches permissions or goes outside, it cannot be undone, first time for this kind, only n
decisions so far, «in questo gruppo hai detto no 2 volte su 6», auto cards of this kind were undone, not yet sure
enough, or it could not apply by itself. Never a suggested answer and no preselected button (Bondi et al., AAAI 2022:
telling people the AI deferred, without its guess, improved their accuracy).

**The maintenance learns from it.** The research data pack (ADR 0132) gets a `decisions` section: per group the yes,
no and undo counts, the bound and the mode, so a research stops proposing what is always rejected.

## Consequences

- The first weeks only record; the deck shrinks as the owner's answers become predictable, never for roles, settings,
  permissions, issues, production or outside texts.
- Auto-applying a «Tieni» card (an applied maintenance change) only takes it off the deck; Annulla stays in «Applicate
  da sole» and in the Log.
- Group statistics mix sources of one group (a research rule and a Battito rule are both «rule»); the per-card checks
  (reversible, never-auto) keep the unsafe ones asked.
- A loop policy undone outside the deck (Impostazioni) is not seen as an undo; the change log's rollbacks are.

## Alternatives considered

- One-sided z = 1.2816 (about 32 yes in a row): faster, rejected for now to keep the brief's 90% two-sided helper.
- Per-source instead of per-group statistics: finer, but each source would need its own 10 decisions before helping.
