# ADR 0294 · The roles are little people at work, drawn as sprites

Date: 2026-11-13 · Status: accepted (owner, thread «Rifare la UI della Grindhouse», after the three animated badges
proposed with ADR 0293: «voglio dei veri e propri omini che fanno cose … molto carini anche nel piccolo; al posto
della stellina di "sto pensando" nel caso dell'Orchestrator e al posto del pallino dello stato nel caso delle
striscioline degli agenti; sentiti libero di farle un pelo più grandi le striscioline; voglio proprio che crei delle
sprite») · Amends: ADR 0293 point 1 (the portrait with the state dot on a strip)

## Context

A strip showed the role's portrait with a coloured dot for the state; a working chat showed a turning spark. The
owner wants whole little people who do things, readable when small, one per role, changing with the state.

## Decision

1. Each role is a small person in its character's clothes, drawn in code on a 20 × 16 pixel canvas
   (`lib/sprite-rig.ts`: one body, a look, a pose; `lib/agent-sprites.ts`: the frames). Trusted code, never user or
   model content, like the portraits.
2. While its chat works each role does its own job: the Orchestrator conducts, the Strategist moves a chess knight,
   the Scout walks with a magnifying glass, the Artisan hammers on an anvil, the Sentinel scans with binoculars
   beside its shield, the Herald blows its horn, Flash runs; a chat without a role types on a laptop.
3. The other states are the same for everyone: thinking (a hand on the chin, a thought growing), waiting for the
   user (a wave, a hop, an amber «!»), done (a cheer played once, then still under a green tick), error (a squat, a
   drop of sweat, a red «!»), idle (asleep).
4. On a strip the person replaces the portrait and its state dot: 60 × 48 px on a root strip (the row grows from
   about 44 to about 60 px), 40 × 32 px on a delegated row. It thinks on a thought or before the first step and keeps
   at its work between two steps. A role the user gave a picture of their own keeps that picture with the dot.
5. The Orchestrator and Flash have no strip: their person replaces the spark on their chat's working line. Every
   other working line keeps the spark (in a strip it is hidden: the person already moves).
6. One inline SVG per sprite holds every frame side by side, one path per colour, on a dark tile so the colours read
   in both themes; a CSS `steps()` animation moves it (transform only). A hidden window pauses it; reduced motion
   shows the first frame, which is always a whole picture.

## Consequences

- The state is read from the person, without a legend; the words stay beside it (pill, tooltip, screen reader label).
- A root strip is about 16 px taller.
- No image file, no dependency, no network: about 300 lines of pixel data in code, checked by
  `test/unit/agent-sprites.test.ts`.
- Technique read from two public pages: the «pixel-art-sprites» skill (silhouette first, few frames, hard edges) and
  Josh W. Comeau's «Sprites on the Web» (`steps()` with `jump-none`).
- Tried in the demo only, not on a real PC.
