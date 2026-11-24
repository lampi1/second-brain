# ADR 0346 · A plan names the preset, never the model; a chat out of credits waits for its role's card

Date: 2026-11-24 · Status: accepted (owner, issue #462: «voglio poter cambiare spesso il ruolo degli agenti, nel piano
voglio vedere solo se è stato scelto massimo minimo base non anche il modello, perché potrei finire i crediti e dover
cambiare il modello») · Amends: ADR 0336 (presets), ADR 0343 (the plan's boxes), ADR 0218 (a limit error), ADR 0031
(«Riprendi»), the step line of 2026-11-23 («role · model · preset») · Amended by: ADR 0347 (the card a waiting chat follows
is its level's pick)

## Context

- Since 2026-11-23 a plan step stored a preset and a model, filled by the app when the plan was proposed, and the map
  showed «Artisan · Sonnet 5.5 · Base», with «previsto» for a step not started.
- The model shown went stale as soon as the user changed the role's card. The launch itself already read the card
  (`catalog.resolve`), so the plan could show one model and the step start on another.
- A part delegated with `step` and no `preset` started on Base, also when the approved step said Massimo.
- A turn that ended on the provider's credit or plan limit was only recorded as cost data (`CreditBook.observe`). The
  chat stayed in error; a child whose engine died was closed as blocked («Finita con un errore del motore»).

## Decision

- **The plan names a preset only**: `PlanStep`, a work map's box and a project map's flow step carry `preset`, no model
  (`strategy.ts`, `work-map.ts`, `project-map.ts`). A model saved with a step on 2026-11-23 is dropped when the plan is
  read. The map shows «Artisan · Base» (`plan-words.tsx whoOf`); «previsto» and its tip are gone.
- **The model is the card's when the step starts**: nothing is stored with the plan, so a card changed after the
  approval counts. A part that names no preset takes its step's (`stepAsk`, `agent_delegate` and `agent_assign_task`);
  the part's own preset still wins.
- **A role chat out of credits waits** (`ChatSummary.creditWait`, set by `creditStop` when a turn or the engine ends
  on `limitSignal`): no report is asked, the delegation is not closed as blocked, the crash recovery does not retry
  it, the plan step stays under way. The chat says why («In attesa: i crediti di … sono finiti…»); the work map and
  the recap say «crediti finiti: cambia il modello nella scheda del ruolo» among what waits for the user; the project
  map holds the piece on the user; `agent_children` says `waitsOn: "credits"`; the Orchestrator's news says it waits and
  that nothing is to be switched. The wait is saved and survives a restart. A new turn ends it.
- **It goes on when the card changes** (`agents/credit-wait.ts`, at every change of the catalog and of a waiting chat):
  the card is read as a launch reads it (`catalog.cardNow` = `resolve`'s guards) for the preset the chat runs on.
  - Same engine, another model: the chat switches to it and the app tells it to go on from where it was
    (`ChatManager.creditResume`); its run names the new model.
  - Another engine: a chat never changes engine, so the work goes on in a new chat of the same role on the card's
    engine: «Riprendi» with the app's own hand-off note, since the old engine cannot be asked
    (`ChatManager.creditContinue`). The same child of the same parent, contract and worktree; the plan step now names
    the new chat, and the old chat owes nothing more (no report asked, it holds no parent busy). Its preset goes on
    with it. When the parent may not start that engine the chat keeps waiting and says so.
  - The card is compared with the card the wait already answered (`creditWait.card`, «engine:model», from the run the
    chat started on), never with the chat's own model: an ACP engine shows its running variant there
    (`grok-4.7[context=…]`), which would read as a change on every look. A move that stays or fails records the card:
    it is tried again only after the next change. A failure says why in the chat (`creditMoveFailed`) and the chat
    keeps waiting.
  - A job the user stopped («Ferma», ADR 0342), the chat's own or an ancestor's, moves nothing.
- **No automatic fallback**: the app never picks another model or preset. Only the card moves a waiting chat. A card
  that already names another model for that preset when the wait begins counts at once: it is the user's own choice.
  The rule lives in `credit-wait.ts` alone, where a later choice of engine by limits could plug in (the owner asked for
  one on 2026-11-24, after this issue: a separate change).
- **Estimates**: a plan and its steps show none. The estimate on a chat's strip rests on its run's model
  (`task-estimate.ts`), which after a resume is the card's new one.

## Not done

- A chat with no role, and the Orchestrator, do not wait this way: they have no card of this kind to follow (the user
  changes the model on the chat; the Orchestrator follows its own card already).
- Credits that come back by themselves (a plan window that resets) do not resume a waiting chat: the user changes the
  card or writes to the chat.
- The Agenti page does not list the chats that wait on a card.
- A writing child with uncommitted work in its worktree cannot go on on another engine: «Riprendi» refuses a dirty
  worktree (`DelegateWorktrees.prepare`, unchanged). It keeps waiting and says why; a model of its own engine on the
  card resumes it.
- Untried on the owner's PC with a real provider limit: the limit texts are the ones `limitSignal` already knew. A
  short Claude `rate_limit` answer («Usage limit reached…») also reads as a limit, so a brief throttle may leave a
  chat waiting until the user writes to it or changes the card.

## Tests

- `test/unit/agents/credit-wait.test.ts`: `creditMove` and the watch; on a real ChatManager with fake engines the wait,
  what the parent and the maps see, the resume on the card's model, the new chat on the card's engine, the restart; an engine's model variant never moves
  a wait, a stopped job, a resume that cannot be sent, a continued chat that owes nothing.
- `test/unit/agents/delegation-presets.test.ts`: a part takes its step's preset; `catalog-presets.test.ts`: `cardNow`.
- `test/unit/plan-who-group.test.ts`, `workmap-shared.test.ts`, `agents/strategy.test.ts`: no model on a step, a box or a
  flow step; an old saved model is dropped.
