# ADR 0341: Ten principles of the app, and what was removed to follow them

**Status:** Accepted (2026-11-23). Groups ADR 0337 (model choice on the card), 0338 (no leftover processes) and 0340 (no
Guida page, a Memoria of four tabs) with the routing and project map changes of the same day. Amends ADR 0083 (who
delegates), 0203 and 0218 (the tiers and Balanced as a choice).

## Context

The app had grown several ways to do one thing: the model of a chat could be set in four places, every role could
delegate, settings existed for behaviour nobody changed, and some features worked on one engine and were silently
missing on the others. The owner wrote down ten principles on 2026-11-23 and asked not to reopen them.

## Decision

1. **Orchestration and planning are the core.** Everything else serves them; what does not is a candidate for deletion.
2. **Every feature works on every harness.** Where an engine cannot, the app shows the gap («parziale», a disabled
   control that says why); it never hides it.
3. **Only the Orchestrator and the Strategist delegate** (`DELEGATOR_ROLE_IDS`). Scout, Artisan, Sentinel and Herald do
   their part and hand anything else back in their report. A Sentinel review is launched by whoever delegated the work.
4. **Work with two or more parts goes to a Strategist.** The Orchestrator routes: a small clear change to an Artisan, a
   read to a Scout, a message to a Herald.
5. **Artisans run well on middle and low models**: the contract carries the thinking, not the model.
6. **The model is chosen on the role card**, as one of three presets (Minimo, Base, Massimo). The Orchestrator or the
   Strategist may pick another of the three when it delegates; Impostazioni has no model control.
7. **Code Mode is per role, on its card, on every harness**, never on the Orchestrator.
8. **The project map shows role, model and preset of each step.**
9. **A Grindhouse card shows the skills the agent used.**
10. **The Grindhouse menu always opens the overview of all agents.** Redundant settings and dead code are deleted, not
    hidden, and a value worth keeping is moved once onto the role cards.

## What was removed

- Balanced mode, the per-tier model table, the global Code Mode switch, the Orchestrator's model settings, the limit on
  running children, the workers' launch lists, the pick history in `credits.json` (nothing reads it any more).
- Mentions of these in the concept cards (`src/shared/concept-guide.ts`), the Settings search words, the role editor's
  hint and the glossary.

What keeps the old words on purpose: the stored `tier` / `tierMax` of a card (the brain registry's fallback model for a
card that names none, and run statistics), the AI-DLC flow steps, the reader of routes written before this date
(`RouteBalanced`), the one-off migrations, and the refusals of a `tier` or `balanced` argument.

## Consequences

- An old `config.json` and `roles.json` are moved at the first start: `test/unit/agents/simplification-migration.test.ts`
  runs both migrations on one old profile and pins the final state of every card.
- The model-tier suggestion (`src/main/agents/suggestions.ts`) is made only for a card that names no model, because a
  card's own model wins over its tier. After the move every card names one, so it rarely speaks; whether to delete it,
  with the tier trials, is a later choice.
- A new setting or a new place to choose something needs a reason against principles 6 and 10.
