# ADR 0359 · The user's engine choice holds for the whole work tree, and a limit stops one model

Date: 2026-11-25 · Status: accepted (owner, project thread «Far rispettare il motore scelto a tutto l'albero», 2026-11-25:
when the user names an engine or model for a task, the whole tree obeys it, and one refused model does not block its whole
provider) · Amends: ADR 0296 (userModel), ADR 0354 (credit rule) · Builds on: ADR 0352, 0356, 0357

## Context

Already on main before this ADR (checked, not redone): one shared limit rule and a 5-minute short pause instead of 24 h
(ADR 0354), pools per engine/provider/account (0354, 0357), `userModel` inherited by children when their role's levels hold
it (0354 point 7), engine moves that carry the plan (0356). Still missing: a record per role for the whole tree, engines
the user excludes, a limit that stops one model, and an explicit pick that skips an assumed pause.

## Decision

1. **`routing` on a work tree's root chat** (`ChatSummary.routing`: `picks` = engine/model/effort per work role,
   `exclude` = engines). Set only by the authenticated Orchestrator: `app_create_chat routing` and `app_set_routing`
   (replaces; `{}` clears). Workers cannot choose: `agent_delegate` still has no such field.
2. **Inheritance at any depth, read at every launch** (`routingFor`, wiring `resolveAgent`): the nearest record wins per
   role, excluded engines of all ancestors add up. A change while the tree runs holds for every chat that starts after it.
   A tree pick needs not be on the role card's levels (`freePick`); the level it takes is the delegator's preset.
3. **An excluded engine is never picked and never a fallback**: `unusable()` refuses it, the credit-wait move passes the
   tree's exclusions to the card. With nothing left the launch is refused saying «<engine> è escluso dall'utente per
   questo lavoro»; the user's pick on an excluded engine is refused the same way.
4. **A limit stops one model, unless the provider says the account is out.** `accountWideLimit(text)` (credit balance,
   quota, «hit your usage limit», «your/account/plan … limit») pauses the pool as before; any other limit text (the
   seen «The usage limit has been reached» on gpt-6.2-astra) pauses that model only (`PoolFacts.models`, saved in
   credits.json). The provider's own reset («try again in 2 hours», «retry after 90 s», an ISO time) is the pause, clamped
   from 5 minutes to a day (`providerPauseMs`); without it the 5-minute pause and one probe chat as in ADR 0354.
5. **The user's explicit pick skips an assumed pause once.** A launch with `userModel` (his own or the tree's) asks the
   rule with `ignoreError`: a pause born of a limit error is not applied to it, a window the provider reports as spent
   still is. The pause stays for everyone else; a new refusal sets it again, a clean turn frees the model.

## Consequences

- Tests: `test/unit/agents/routing-tree.test.ts`; `credit-truth.test.ts` uses an account-wide text for pool cases and
  the seen text for the per-model one.
- Untried on a real PC. «Account-wide» is a text heuristic: a provider that words a whole-plan limit without those
  markers pauses one model at a time (each costs one refusal) instead of the pool.
