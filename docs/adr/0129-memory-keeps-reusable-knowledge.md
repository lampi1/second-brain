# ADR 0129 · Memory keeps reusable knowledge: a worth gate, fewer cards, a maintenance that generalizes

Date: 2026-10-22 · Status: accepted (owner, 2026-10-22: «le proposte di Memoria mi sembrano troppe, ho paura che la
memoria si riempia e perda valore; l'auto-miglioramento deve funzionare perfettamente»; on the card «setup · note:
Statistiche prestazioni locally: https://localhost:44309/… (after login ExampleApp runs on 44309, not 44319)»: «è inutile,
specifico di un caso. Mi aspetto che la memoria salvi cose importanti e procedure ripetibili, non cose specifiche;
generalizza piuttosto i dati salvati. Voglio che anche la Manutenzione ne tenga conto») · Builds on: ADR 0077 (the
maintenance), 0123 (the Proposte deck), 0126 (plain cards)

## Context
A fact reached Memoria → Proposte from three writers with no check of its worth: `memory_propose` (no limit),
agent_report's `remember` (up to 3 lines per report, every one stored as `setup · note`) and the `agent` CLI. The
instructions even said "facts about this user's setup … never a general rule". The store deduplicated only the very
same text; a proposed fact never expired; every fact was its own card. The maintenance's `merge-memory` job did
nothing. And since every `remember` line is `setup · note`, each new one "contradicted" every confirmed note of the
role, so its card asked replace or keep both for unrelated notes.

## Decision
- **A worth gate** (`main/rules/memory-worth.ts`, pure, zero tokens) looks for the signs of a one-off fact: a URL with
  a port, a query or an id in its path; a ticket, PR, work item, tracker key, GUID or commit id; a path in one user's
  home; a single date or «oggi / today»; a branch name. Ids, commits and dates make a fact case-specific however it is
  worded; URLs, user paths and branches only when it is not stated as a reusable rule or procedure (it starts with
  when / before / always / use / check… in Italian, English or German, numbers its steps, or its predicate says
  procedure / convention / rule). `proposeMemory` refuses a case-specific fact (every writer goes through it), and
  agent_report refuses a report whose `remember` line is one, before the report is accepted: the error says what was
  found and what to save instead, so the agent generalizes the line or leaves it out.
- **The instructions ask for reusable knowledge** (the launch text `REMEMBER_HINT`, `memory_propose` and the
  `remember` field): procedures, conventions, how-tos, where things are kept, dead ends; a specific finding is
  generalized first («after login the local app runs on a port other than the default: read it from the launch
  profile», not the URL).
- **Fewer cards, the same facts** (`main/proposals/memory-deck.ts`): proposed near-duplicates in one scope (the same
  words at 80 %, or exactly the same words when short) are one card led by the best fact («Proposto N volte»), decided
  together (approve: the others go as merged into it); a proposal with the same words as a confirmed fact is not
  shown; per role and per day at most 3 cards, rules first and case-specific facts last, the rest one batch card
  («Artisan deve ricordarsi questi 5 fatti?», the list as its body, decided as a whole). A contradiction keeps its own
  card. A case-specific fact still in the store says so on its card («Sembra legato a un caso solo (…)»).
- **Free notes never contradict.** A fact whose predicate says nothing (note, nota, fact, info…) is its own fact:
  `memoryConflicts` and the deck no longer pair it with other notes.
- **The maintenance tidies the memory** (`merge-memory`, `brainmodel/memory-tidy.ts`), by itself every six hours and
  on the button, with no approval (owner, 2026-10-19): it retires proposals already confirmed and merges proposed
  near-duplicates (zero tokens), and sends up to 20 case-specific facts (proposed or confirmed) to the one-shot agent
  with no tools that the upgrade job uses: each comes back as the general rule behind it (a new record with the same
  scope, subject, predicate and status, the old one retired) or is dropped (retired); a rewrite that is still
  case-specific is dropped. Without an engine only the merges run. Each pass is one change per role in the change log,
  with what was merged, rewritten and dropped as its evidence, and its Annulla (`ChangeLog` → `undoMemoryTidy`: the
  retired facts open again, the written ones go) while those facts are unchanged; a fact the user brought back is never
  touched again. Nothing is purged and nothing is promoted across scopes.

## Consequences
- A memory card is rarer and states a rule or a procedure; the badge counts batches and merged cards once.
- A false positive of the gate costs the agent one retry (it rewrites or drops the line); a false negative is caught by
  the card's flag and the maintenance's next pass.
- The maintenance spends tokens for case-specific facts only (at most two one-shot questions per pass).
