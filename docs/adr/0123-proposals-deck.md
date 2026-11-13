# ADR 0123 · Memoria → Proposte: every proposal is one card in one deck

Date: 2026-10-22 · Status: accepted (owner, 2026-10-22: «tutte le proposte che fa l'app devono essere una card in quella
sezione, mi raccomando pulizia e ordine») · Builds on: ADR 0122 (Memoria as the hub, its tabs), ADR 0083 (trials and
tier suggestions), ADR 0030 (the improvement loop), owner rule 2026-10-19 (changes apply by themselves, with Annulla)

## Context
What the app proposed was decided in six places: memory facts in MemoryReview, skill candidates in LearningReview, tier
suggestions and trials in the Agenti «Da approvare» inbox and on the role page, the loop's policies under Regole
imparate, an agent's setting request in its chat. Changes the maintenance applied by itself were only in the change log.
The user had to know where to look, and each page decided in its own way.

## Decision
- **One deck.** Main's `ProposalsService` (`src/main/proposals/`) gathers every card the user decides, newest first:
  proposed memory facts, skill candidates, the maintenance's applied changes to skills, rules, memory and roles in the
  last 14 days not yet reviewed, agents' setting requests, role trials, tier suggestions, the Battito's rules, the
  improvement loop's policies (not the retired estimates). Every card carries who proposed it, where (chat, run, files),
  when and the evidence. Left out: a live chat's permission and question prompts, the dashboard's ephemeral ideas, the
  brain's own format moves (migration, upgrade) and the user's own edits.
- **Each source keeps its own path.** A decision goes through the same handler the old page called (`memory:confirm`,
  `learning:promote`, `brainmodel:rollback`, `settings:confirm`, `agents:trialDecide`, `agents:lifecycleDecide`,
  `approvals:decide`, `learn:act`). Main rereads the source first (still open? that side still possible?) and holds one
  decision per card at a time. A refusal brings the card back with the reason.
- **Applied changes are «già applicata»: Tieni / Annulla.** Annulla is the change log's rollback; Tieni marks the change
  reviewed (`userData/proposals-reviewed.json`, 60 days). A change that cannot roll back any more shows Annulla blocked.
- **Held decisions.** The renderer holds a decision about 6 s before sending it (the next decision or leaving the deck
  sends it sooner); Z / Ctrl+Z / «Annulla ultima» takes it back meanwhile. Most sources cannot undo a sent decision.
- **The human gate stays.** A skill candidate's Approva is locked until its draft and evidence are opened on the card.
- **The deck UI.** One card at a time: drag with rotation and an APPROVA / RIFIUTA stamp (threshold or flick, spring
  back), round ✕ / ✓ buttons, ← / →, group chips with counts, an end state with the counts, «Rivedi le rifiutate» and an
  empty state. The badge beside Memoria is `proposals:count` + `proposals:changed`, minus a held decision.
- **No decision UI elsewhere.** MemoryReview, LearningReview, the Agenti page, the role page and Regole imparate show a
  line that points to the deck; the Agenti inbox (`AgentApprovals`) is gone.

## Consequences
One place, one gesture, one order for everything the app asks. A new kind of proposal is a new source in `sources.ts`
over its module's existing decide path, never a second write path.
