# ADR 0126 · Proposal cards ask a plain question; a contradicted fact asks replace or keep both

Date: 2026-10-22 · Status: accepted (owner, 2026-10-22: «voglio che le domande siano chiare, human readable, che
capisco cosa sto approvando o no, non roba a basso livello, per tutte le cose; per script e query voglio vedere lo
script e la query»; the same day: approving a fact failed with «Conflicting confirmed fact requires explicit
supersession») · Builds on: ADR 0123 (the Proposte deck)

## Context
A deck card showed the source's raw data: a fact's `subject · predicate` as its title («setup · note»), its scope as
`roleId: scout · project: C:\…`, an applied change's action and target, a policy's domain and confidence interval. The
user could not tell what Approva would do. Scripts and queries a change wrote were not shown at all. A proposed fact
whose subject and predicate matched an already confirmed fact with another value could never be approved: the memory
store refused it with an English error and the card stayed.

## Decision
- **Every card carries `ask`** (`shared/proposals.ts ProposalAsk`): what it asks as data (role ids, values, names),
  never prose. The renderer words it (`lib/proposal-ask.ts cardWords`) in the UI language: one question ending in «?»
  («Scout deve ricordarsi questo?», «L'app ha aggiunto da sola lo script «x»: va bene così?», «Cambio «Battito: budget»
  da 0,25 a 0,4?»), what each side does («Se scegli «Approva»» / «Se scegli «Rifiuta»»), where a fact holds («Vale nel
  progetto «brain-v2»», the folder name of the project path), the app's advice on a trial. A fact whose predicate says
  nothing (note, fact, info…) shows its value alone, otherwise «subject predicate value».
- **Raw data moves behind «Mostra tutto»** («Dettagli tecnici»: the old facts), and the quote under who proposed it is
  the first evidence line that is words, never a bare run id or `file:line`.
- **Code is shown.** A change that writes or removes a file under `scripts/` or `queries/` carries `code` (the file as
  written; a query note's fenced block, ADR 0124), at most 20 000 characters, shown first under the question, in a
  scrollable block; such a change is in the new group «Script e query».
- **A contradicted fact asks.** The memory source lists the confirmed facts with the same scope, subject and predicate
  and another value (`ask.conflicts`). The card shows them and two choices, «Sostituiscilo con il nuovo» and «Tienili
  entrambi»; Approva waits for one (the hint says so). The choice travels as `keep` (`proposals:decide` →
  `memory:confirm { keep, conflicts }`) and `confirmMemory` accepts it only on exactly the conflicting ids it finds
  now: `new` retracts them (superseded by the new one), `both` confirms beside them with a `kept-beside:` reason. Without
  a choice the store still refuses, so a model cannot get around it.

## Consequences
A new kind of card needs an `ask` variant and its words in three languages; the type system makes both mandatory. The
demo has a contradicted fact and a script change, decided in test/e2e/proposals-deck.spec.ts.
