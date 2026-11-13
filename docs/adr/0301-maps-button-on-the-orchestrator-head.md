# ADR 0301 · The project maps button is back on the Orchestrator's head

Date: 2026-11-13 · Status: accepted (owner, 2026-11-13: «vorrei anche che le mappe si aprissero dal pulsante
dell'orchestrator è sparito non capisco il perchè») · Amends: ADR 0287 (the quiet top bar) · Builds on: ADR 0275,
ADR 0276

## Context

ADR 0275 put a maps button in two places: the top bar and the Orchestrator's head (`orchestrator-maps`). ADR 0287,
cleaning the Orchestrator's head, removed the head one together with «Manutenzione» and the "?", and left the maps
only on the top bar. The owner opens the maps where he talks to the Orchestrator (ADR 0276: the map is a page beside
it), so for him the button had disappeared.

## Decision

1. The maps button is on the Orchestrator's head again, beside the night and remote buttons, and on the top bar as
   before. Both are one component, `MapsButton.tsx`: same label, same shortcut (Ctrl+Shift+S), same action
   (`openMaps`).
2. A unit test renders the Orchestrator's head and fails if the button leaves it.

## Consequences

- `MapsButton` moves out of `OrchestratorOverlay.tsx` into its own file (the tile cannot import the overlay that
  imports it).
- ADR 0287's removed list no longer covers the maps: `orchestrator-maps` is a live testid.
