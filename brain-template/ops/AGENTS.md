---
when: {"prompt":["produzione","production","cliente","customer","incidente","incident","deploy","database"],"tools":[],"paths":["**/ops/AGENTS.md"]}
---
# Ops: production and shared systems

Rules and commands for {{OWNER}}'s production work (servers, cloud, databases, customers). Read when: anything about
production, a customer, an incident. Write when: a production rule changes. Empty on day one: it grows with use.

- **Safety**: `me.md` "Safety" (the only copy): the agent proposes, {{OWNER}} runs; read-only checks only after the
  rules there allow them.
- **Procedures**: `ops/runbook/` (one file per topic, listed in `ops/runbook/index.md`): search it first.
- **Tools**: `ops/tools/` holds the generic brain tools; add job-specific scripts next to them, with a header comment
  (what, why, who uses it) and a test in `ops/tools/test.mjs`.
