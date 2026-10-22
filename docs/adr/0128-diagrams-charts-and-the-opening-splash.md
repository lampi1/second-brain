# ADR 0128 · Diagrams and charts in replies, and the opening splash

Date: 2026-10-22 · Status: accepted (owner, 2026-10-22: «vorrei grafici e diagrammi con qualche libreria figa, per
esempio quando chiedo una spiegazione di qualcosa»; «un'animazione epica all'apertura dell'app, qualcosa di
caratteristico che richiami il grinding … con una frase diversa ogni giorno, sempre a costo bassissimo») · Builds on:
ADR 0057 (i18n), 0061 (dependencies)

## Context
Agents explain things in prose and code blocks only. A flow, a set of states or a breakdown of costs reads faster as a
picture, and models already write Mermaid and chart specs well. The app opened straight onto the Grindhouse with no
moment of its own.

## Decision
- **Two fences are drawn in chat replies** (`components/VisualBlock.tsx`): ```mermaid as a diagram, ```chart as a
  chart from a small JSON spec (`lib/chart-spec.ts`: `{"type":"bar|line|pie|doughnut","title","labels","series":[{"name","data"}]}`,
  plus `stacked`, `horizontal`, `unit`; the Chart.js shape is accepted too). Streaming, an invalid spec, a syntax error
  or a library that fails to load leave the plain code block. "Codice" shows the source, "Copia" copies it; a diagram
  opens large in the image viewer.
- **New runtime dependencies** (exact versions, published more than 14 days before the install):
  - `mermaid` 12.1.0 (MIT, the de-facto diagram language models write). Strict security level, size caps, no HTML
    labels; its SVG is never put into the page: it is serialized and shown as an `<img src="data:image/svg+xml,…">`,
    which cannot run script or load anything. Its parsers are precompiled: no `unsafe-eval`, the CSP is unchanged.
  - `chart.js` 4.5.1 (MIT, one tiny dependency): canvas only, labels drawn as text, only the controllers used are
    registered. Colors: the validated categorical palette, one per theme; text and grid from the app's tokens.
  Both load on demand (dynamic import from `VisualBlock`): the first screen does not parse them (mermaid's core is
  ~90 KB plus one chunk per diagram type, Chart.js ~190 KB, minified). Mermaid's tree is large (d3, dagre, cytoscape,
  katex…): accepted because only the diagram types used are ever fetched and nothing reaches the network.
- **Agents are told in one line** in every role frame (`VISUALS_RULE`, `main/agents/orchestrator-role.ts`), not in a
  skill: it costs ~60 tokens once per session.
- **The opening splash** (`components/Splash.tsx`): an angle grinder cuts GRINDHOUSE out of the dark with sparks, the
  word cools to steel, the day's sentence rises, and it fades into the app; 2.4 s at most, a click or a key skips it,
  prefers-reduced-motion shows it still, the app renders under it from the first frame. SVG, CSS and one canvas, no
  image. Main asks it in the page's query (`window.ts splashQuery`) only when a person opens the app: never under
  SB_HIDDEN, SB_TEST or the frozen demo (SB_SPLASH=1 / hold forces it for its own e2e, 0 turns it off); once per
  window. The sentence is the day's headline main already has (SPEC 18, written by the Battito once a day; no model
  call is ever made for the splash), else one of twelve splash lines, a different one each day.

## Consequences
- An agent may now answer with a diagram or a chart; the fallback is always the code it wrote.
- `npm ci` installs mermaid's tree (~1000 lockfile lines); the built renderer gains about 40 lazy chunks.
- The window URL carries `?splash=1`; the IPC sender check compares file paths without the query (unchanged).
