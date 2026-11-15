# ADR 0313 · The workshop picture behind the people, and every person in full

Date: 2026-11-15 · Status: accepted (owner, thread «Proporre nuova Grindhouse e Orchestrator», 2026-11-15: «qui non li
voglio in trasparenza li voglio visibili bene tutti, lo sfondo mi fa un po' cagare mi sembra cheap e poi a volte mi
sembra allineato male. Fammi proposte di sfondo fighe»; of four proposals drawn in the app he picked «la bottega ma
mettici un barile e qualche elemento in più tienilo bello e funzionale occhio agli z index») · Amends: ADR 0312 (points
3 and 6)

## Context

ADR 0312 drew the stage as a tiled stone wall with a beam and planks, and faded a resting person and a resting helper.
The owner found the wall cheap, its bricks cut at the edges of benches of any width, the faded people hard to see, and
on the role cards the stage starting at a different height on each card, with a dashed ring left around a torch.

## Decision

1. **One picture, never tiled** (`src/renderer/assets/stage/bottega.svg`): a workshop of wooden planks, two posts, a
   shelf of jars, tools hanging high, a window on the sunset with its light on the floor, barrels and crates at the
   sides, a plank floor and a soft vignette. It covers the stage from the bottom centre (`cover`), so a narrow bench or
   a card shows its middle and a double bench all of it; the floor stays under the people's feet at every width.
   Bundled by Vite as a file; the bench (`agent-strips.css`) and the role card's hero (`agent-catalog.css`) share it.
2. **Kept clear where things sit on top**: the top corners (the state chip, the bench's buttons) and the band of the
   people's heads hold nothing busy; the people, the helpers' tags and the buttons stay above the picture and the
   torch.
3. **Every person in full**: no fading at rest, on the bench or for a helper. Who works is said by the lit torch, the
   filled chip with the accent border and the helper's dot.
4. **Role cards line up**: the stage starts at the top of every card's front; the torches lost the dashed ring of the
   old round avatar.

## Consequences

- The picture is the same in the light theme (a scene, not a surface).
- One more static file in the bundle (about 6 KB); no motion added.
