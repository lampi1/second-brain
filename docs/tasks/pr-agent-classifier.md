Title: feat(agents): suggest agents with local request affinity scores

## Summary

Add a local advisory classifier for SPEC 23(a). It ranks active agent definitions and successful goals from their
current version using the existing hybrid-search embedder plus BM25 word matching. Results include 0–100 affinity,
the winning field/run, an explicit words fallback, and a below-threshold proposal that requires the user's request
before creation. Vectors are cached by text hash; private instructions and goal excerpts are not returned.

`agent_catalog` accepts optional request text on both MCP mounts while preserving untrusted declarations and
paginated metadata. The start dialog shows an IT/EN suggestion with its score and an explicit choose action,
without automatically replacing the selected agent. The catalog overview page is untouched.

Threshold rationale and synthetic boundary measurements are in `docs/tasks/agent-classifier-calibration.md`.
Real-model IT/EN quality calibration remains open; the score is not a capability or success probability.

## Test plan

- Targeted Vitest: classifier, manifest/discovery and start-dialog regressions (17 tests pass).
- ESLint on touched TypeScript files: pass.
- TypeScript: full check reports only missing `highlight.js` modules in untouched `file-format.ts`; the package is already declared but absent locally.
- Fresh-context correctness/security/UI review: complete; trusted successful outcomes added and re-reviewed, no remaining blockers.
- No build or e2e in this sandbox. Integrator must build, inspect the hidden dev dialog in IT/EN, and run the main gate.
- No commit, push or PR creation performed.
