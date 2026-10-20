# ADR 0101 · Honest statistics, one vocabulary, explanations in place

Date: 2026-10-20 · Status: accepted (owner, 2026-10-20) · Amends: ADR 0087 (the estimate's accuracy line), ADR 0053
(its last card), ADR 0077 (the Brain pages' statistics)

## Context
The owner: «le statistiche sono troppo confusionarie e con una UI disallineata; l'app non spiega abbastanza». A UX audit
rendered every page of the frozen demo and measured the DOM; a second audit read the learning code. They found:
- the same amount in four spellings ("0,35 $", "40,04 USD", "$0.00", "≈ 1,84 $"), the same unit of work under six names
  (task, lavoro, run, esecuzione, chat, turno), the user's folder under three ("brain", "Cervello", "memoria"), and both
  "Orchestrator" and "Orchestratore";
- numbers that mislead: "Token spesi 0" (a constant), a "Pronto a calibrarsi · ne bastano 20" meter for a calibration
  removed in bb953da, "Lo sapevi?" facts and "sta imparando" trends built on 5 cases, the classifiers' coverage shown as
  if it were accuracy, an estimate "precisione 68% · +63 pt in 7 settimane" that is the share inside a ×0.5–×2 band and a
  last-week-minus-first-week trend whatever their n, memory "richiami" that count every run started after a line (loaded
  is not used), skills called "utile" or "debole" on 2 outcomes, a "Giorni senza errori" streak, the "Battuta del
  Grindhouse" line, and a second estimator (the brain's cost/time loop) still shown after ADR 0053 retired it;
- layout bugs: page titles at three x positions, Regole's cards overflowing, Qualità's text one word per line, an orphan
  KPI tile, labels touching controls, the 3D map's legend over its nodes, the plan spilling over the Orchestrator's
  messages, a US date field in an Italian UI;
- 62 "?" explanations, none leading to the Guida, whose cards named internal MCP tools and missed six concepts.

## Decision
1. **One money format**: `lib/format.ts formatCost` (the number in the UI locale, then " $"; three decimals under
   0,10 $; `round` for totals) is the only one; `brain/lib/format.ts fmt.usd` delegates to it. No Intl currency, no
   "$x.xx", no "USD".
2. **A statistic stays only if it is true and leads somewhere**; where a percentage stays, k/n is beside it.
   - Classificatori: no "Token spesi", no calibration meter, no card for the retired estimator (Regole imparate hides
     its policy too); the measure is named for what it is ("Copertura", "Uguali al suggeritore", "Entro ×2") with a
     one-line explanation; the curiosities, the trends and the hit-vs-miss comparison (a correlation read as a cause)
     are gone; a piece of advice appears only from 20 cases (10 a side for a cost comparison) and only when it ends
     with something to do.
   - The task estimate says "entro ×2: k/n"; `EstimateAccuracy` carries `hits` and no `trend`.
   - Memoria: no "richiami"; a skill verdict needs 10 known outcomes (`MIN_VERDICT`).
   - No "Giorni senza errori", no "Battuta del Grindhouse".
3. **One vocabulary** in the Italian UI: "brain" for the user's folder (never "Cervello"; "memoria" only for the Memoria
   page), "Orchestrator" (never "Orchestratore"), "lavoro/lavori" for one unit of work in the estimate, the classifier
   card and the approvals ("Task" stays the Azure DevOps page). Comments quoting the owner keep their words.
4. **Explain in place**: `HelpTip` takes `guide` (a Guida card id) and ends with «Come funziona →», which opens the Guida
   with that card (the page's arg); `PageHead` takes `guide` too. Tool names live only in a card's "Strumenti interni"
   row (a test refuses snake_case identifiers in the main text). New cards: Manutenzione, Versioni in prova e «Da
   approvare», Chiusura automatica, Novità trattenute, Contesto e passaggio di chat lunga, Qualità.
5. **Navigation**: the sidebar's "Andamento" group holds Costi and Qualità; the Task page's reading settings (automatic
   read, interval, sound) move to Settings → Notifiche, the page keeps a one-line state with a link.
6. **One page gutter** (`--page-gutter`, `--page-top`) and the audit's layout bugs fixed, each checked on a screenshot.

## Consequences
- Fewer numbers on screen, each with its n; what was removed was not measuring what its label said. A statistic that
  comes back needs a source, a window, an n and an action.
- `EstimateAccuracy.trend` and `CLASSIFIER_NEED` are gone (no consumer left); the brain's estimates policy is still
  read, only not shown. `src/shared/contract.ts` is unchanged.
- E2E specs that pinned the removed strings (estimates card, "precisione", "Lo sapevi?" on the cards, the Task toolbar,
  "La tua memoria e i tuoi progetti", the sidebar's three groups) are updated on the branch and first run on main.
