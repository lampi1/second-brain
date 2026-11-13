# ADR 0294 · The roles are little people at work on the strips

Date: 2026-11-13 · Status: accepted (owner, thread «Rifare la UI della Grindhouse», after the three animated badges
proposed with ADR 0293: «voglio dei veri e propri omini che fanno cose … molto carini anche nel piccolo; al posto
della stellina di "sto pensando" nel caso dell'Orchestrator e al posto del pallino dello stato nel caso delle
striscioline degli agenti; sentiti libero di farle un pelo più grandi le striscioline»; shown a pixel-art version:
«non li voglio pixelosi, li voglio normali, smooth»; shown smooth ones on a coloured tile: «animazioni veramente
fighe … non dentro un quadrato colorato ma liberi») · Amends: ADR 0293 point 1 (the portrait with the state dot on a
strip)

## Context

A strip showed the role's portrait with a coloured dot for the state; a working chat showed a turning spark. The
owner wants whole little people who do things, readable when small, one per role, changing with the state, smooth
(no pixel art), free on the strip (no tile), with animation that has some acting in it.

## Decision

1. Each role is a small vector person: the head of its portrait (`lib/character-art.ts`) on a body with two legs
   and two arms that bend at the elbow, in the role's clothes (`lib/sprite-rig.ts`, `lib/agent-sprites.ts`).
   Trusted code, never user or model content, like the portraits.
2. While its chat works each role plays its own small scene: the Orchestrator conducts in four beats, the
   Strategist thinks, lifts a chess knight and puts it down, the Scout walks, stops and brings a magnifying glass
   to its eye, the Artisan gives three hammer blows on an anvil and looks at the piece, the Sentinel scans left
   and right with binoculars beside its shield, the Herald breathes in and blows its horn, Flash runs; a chat
   without a role types on a laptop while the lines write themselves on its screen.
3. The other states are the same for everyone: thinking (a hand at the chin, a thought growing), waiting for the
   user (three waves, a hop, an amber «!»), done (two jumps with the arms up, confetti, then still under a green
   tick), error (the head hangs and shakes, a sigh, a drop of sweat, a red «!»), idle (asleep, the head sinks and
   jerks up).
4. A movement is a track of keys in time, each with its own easing, on a joint (a place, an angle, a stretch, an
   opacity): it can load, strike, overshoot, squash on landing and settle, and the head follows the body a moment
   late. A track compiles to one CSS `@keyframes` rule, written once into the page when its scene is first drawn.
   Transforms and opacity only; no image, no dependency, no timer, no script per frame.
5. On a strip the person replaces the portrait and its state dot, free on the row: 60 × 48 px on a root strip (the
   row grows from about 44 to about 56 px), 40 × 32 px on a delegated row. A thin rim in the theme's text colour
   keeps its white and black parts readable on a light and on a dark strip; notes, «z», speed lines and thoughts
   are drawn in the theme's text colour. It thinks on a thought or before the first step and keeps at its work
   between two steps. A role the user gave a picture of their own keeps that picture with the dot.
6. The Orchestrator and Flash have no strip: their person replaces the spark on their chat's working line. Every
   other working line keeps the spark (in a strip it is hidden: the person already moves).
7. A hidden window pauses every movement; reduced motion shows the rest pose, which is always a whole picture.

## Consequences

- The state is read from the person, without a legend; the words stay beside it (pill, tooltip, screen reader label).
- A root strip is about 12 px taller.
- Each visible person runs five to ten small animations inside its SVG; they are painted by the page, not by the
  compositor. Not measured on a slow PC.
- This is the level code can reach (the owner asked for «tripla A»): files made by an animator (Rive, Lottie)
  would need a runtime dependency and could replace a scene behind the same `AgentSprite` (role, state).
- Tried in the demo only, not on a real PC.
