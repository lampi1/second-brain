Title: feat(brain): detect user corrections with the warm local embedder
<!-- PR draft for SPEC 23c; maintained by the correction-detect worker for the integrating Orchestrator. -->

The correction hook currently treats ordinary explanation requests such as "spiegami questa storia" as corrections.
Add a separate semantic correction decision to the authenticated local recall endpoint. Compare logged said/true
pairs against ordinary requests on the same topics, using the existing local embedder and cached passage vectors.
A semantic yes flags; a semantic no clears only a confusion-only regex match ("spiegami", "non capisco"), while an
explicit correction match always flags. A missing, busy, failed or slow service keeps the existing regex.
Repeat-error recall remains independent. Detection has a 180 ms service / 200 ms hook deadline and never stores prompts.

Validation:
- `npx tsc --noEmit` clean; touched suites (hook, detector, search) 72/72; full `npm test` and the local Windows gate
  results are in the integrator's message for this PR.
- New synthetic tests cover corpus parsing, positive/negative decisions, cold/warm behavior, refresh, brain changes,
  failures and bounded queries; hook-process tests cover semantic yes, fallback, agent-message exclusion, and that a
  warm semantic no never hides an explicit correction ("no, ti ho detto di aspettare") while it clears "spiegami".
- Integrator review fix: the first draft let a warm semantic no suppress every regex match, which would have hidden
  real corrections on topics not yet logged; status-driven warming now runs once when the model becomes ready.
- No app launch; no real-message measurements or personal transcript reads.

Limitations: thresholds are initial policy, not calibrated accuracy. Real-model semantic quality and warm latency need
validation with real messages (owner permission). Existing installed hooks are not modified by this branch.
