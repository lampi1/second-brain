# ADR 0039 · Fluid brain map: one rAF loop that stops, neurons and axons drawn by shaders

Date: 2026-10-13 · Status: accepted

## Context
The owner (2026-10-13): the 3D map lighting up what is used is great, but it must be more fluid, with nicer animations
and neurons that look like neurons "without overdoing it", "principalmente fluida". The engine redrew a live map with
a 42 ms timer (one frame per tick, the library's loop paused and resumed), stepped fading glows once a second (one
frame per snapshot), rebuilt every node object when a halo came or went, and restarted the library's layout engine on
every change of look. The app's other "alive" marks are stepped, not animated, because infinite animations once kept
the app near half a core (`lib/beat.ts`): the map must never be the reason the machine is busy.

## Decision
- **One loop, ours.** The library's own loop stays paused; `engine.ts` runs one `requestAnimationFrame` loop that
  draws a frame (library tick: layout, controls, camera tween, hover; then the draw) only while something moves: the
  layout settling, a camera flight, the user's hand, a value easing, a breath or a signal of a call at work, a lit path
  for 6 s. When nothing moves no frame is requested at all: no idle timer, zero frames at rest (measured in
  `map-perf.spec.ts`). Hidden or minimized: no frames (the browser gives none, the loop is cancelled).
- **Display rate with focus, about 30 fps without.** While the window has no focus and no hand is on the map, the
  loop draws every other display frame: the map watched beside another app stays smooth at half the cost.
- **Everything eases, nothing is rebuilt.** Each node and link keeps eased values (live light, breath, dim, focus,
  grow-in, signal) applied to uniforms and opacities each frame; time-based easing (`lib/map-motion.ts`, unit-tested)
  lands exactly on its target so the loop can tell it is done. Highlights and live changes never call the library's
  accessors (which rebuild objects and restart its layout). A finished call's fade continues between the app's
  once-a-second snapshots at the snapshot's own rate (at most 1.2 s ahead, so a frozen clock stops the fade).
- **Neurons and axons.** A neuron is one merged low-poly geometry per variant (soma + 3-4 tapered, gently curved dendrite stubs,
  kept sideways, clear of the labels), shared by all nodes, shaded with a lighter core, a rim of its color and the live
  light rising from the core; a soft halo sprite of its color, brighter and breathing while at work. An axon is one
  shared ribbon geometry bent by a vertex shader (quadratic curve, slight bend fixed per link, thinner towards the
  target, never under ~1.3 px, edges feathered by pixel): moving the layout changes two uniforms, not geometry. The
  signal is a soft bump travelling along the axon in the fragment shader; it replaces the library's particles and
  arrows (direction reads from the taper and the signal). Picking walks the same curve on the CPU (16 segments, a
  bounding-sphere early out), so link clicks and tooltips keep working.
- **No snap on reopen.** The settled layout is pinned when the view reopens (only live newcomers settle) and the camera
  is remembered per view: the same picture at once, no warm-up, no flight.
- **Few draw calls (2026-10-13, measured on the real brain: 258 pieces, 711 links).** One object per neuron, halo and
  axon made ~1200 draw calls a frame: the full view drew 46 fps with focus, 18 ms of work per frame. Neurons (one batch
  per variant), halos and axons are now each one instanced draw call (~270 calls, the labels being the rest): a piece
  or link holds a slot of instance attributes, written only while its values move; the library keeps an undrawn
  object per piece and link for the picking. The hover picking (every 50 ms while frames run) is answered from its
  last result unless the pointer, the camera or the layout moved, and is off while the pointer is not on the map.
  Full view after: 59 fps with focus, 7 ms of work per frame (p95 11 ms).
- **Pixel ratio capped at 1.5.** No idle drift: it would cost frames at rest.
- No new dependency.

## Consequences
- A live map with calls running animates continuously (before: ~24 redraws a second); its cost is measured in
  `map-live.spec.ts` (frame interval and main-thread work per frame p50/p95, CPU, with and without focus) and must stay
  within the per-frame budget asserted there.
- `prefers-reduced-motion`: no breathing, no signals; fades still ease.
- The library's link width/color/particle accessors are no longer used; a new look goes through `paintNode`/`paintLink`.
