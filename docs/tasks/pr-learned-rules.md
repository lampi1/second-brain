Title: fix(brain): handle missing learned-rules CLI gracefully

<!-- PR description for the learned-rules fallback; used by the integrating Orchestrator. -->

Opening Learned rules with a new brain previously delegated to a missing
`ops/improve/improve.mjs` and could display a Node stack trace. Main now returns
an empty status when that script is absent, and the page explains the missing
requirement in Italian and English. Existing CLI installations retain the proxy
path and existing actions. Brain-page errors show a short message with longer
technical details collapsed by default.

ADR 0030 explicitly says the app never writes the loop's state. This change
therefore chooses the brief's empty-state option instead of moving the versioned
policy/backtest/proposal loop into main. It does not implement the missing loop
or write to `ops/state/improve`.

Validation: unit coverage includes a missing CLI, an existing CLI, no selected
brain, the local API response without a data server, status normalization and
error shortening. E2E coverage adds the missing-loop state (no error box, no
folded details, no stack frame) and collapsed error details with screenshots.

- `npx tsc --noEmit`: clean.
- Touched unit suites: 15/15 passed. `npm test`: 2610 passed; the remaining
  failures are timing flakes that pass on rerun, a missing Electron binary
  (passes once installed) and the publish guard flagging untracked local
  `tmp/` notes that are not part of this branch.
- E2E `brain-ui.spec.ts` (new and changed tests) and `miglioramento.spec.ts`:
  passed. "Oggi and Adesso are gone" and "Mappa: direct exploration" fail
  identically on the base commit without this change (pre-existing).
- Review: visible review by the integrator; the stack-trace assertion was
  fixed to match a real frame instead of a whitespace-normalized "at".
