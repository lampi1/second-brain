<!-- Local classifier scoring rationale and reproducible fixture measurements for maintainers; not model accuracy claims. -->
# Local agent classifier calibration

SPEC 23(a) uses the existing local multilingual E5 worker. No remote model, completion or tie-breaker is called.
Scores are text affinity, not probabilities, success rates, permissions or verified capabilities.

Each active definition contributes name, whenToUse, purpose (the stored description), and the first 2,000
characters of instructions as a deterministic excerpt. Each contributes up to 20 newest qualifying ended runs
of its active version. A completed marker, a done/verified-yes report, or a human/reviewed-evidence successful outcome qualifies, unless an explicit fail/partial
outcome contradicts it. Pruned run goals are unavailable and cannot contribute. No arbitrary popularity bonus is
given: an agent's score is its strongest field or successful goal. Ties sort by ID.

The words channel uses BM25 (k1=1.2, b=0.75), multiplied by query-word coverage and bounded to 0–1:
`coverage * (0.8 + 0.2 * bm25 / (bm25 + 1))`. This keeps exact names useful even when vectors are ready,
without making the top of a completely unrelated ranking look confident. Accents and case are folded.
The semantic channel rescales cosine with `clamp((cosine - 0.65) / 0.35, 0, 1)`; the larger of the two channels
wins. The existing hybrid engine already notes that E5's unrelated passages can have cosine near 0.7.

The initial threshold is 60/100. Offline fake-embedder fixtures measure:

| Cosine, no lexical overlap | Display score | Decision |
| --- | --- | --- |
| 0.70 | 14 | Propose asking the user about creation |
| 0.80 | 43 | Propose asking the user about creation |
| 0.85 | 57 | Propose asking the user about creation |
| 0.87 | 63 | Suggest candidate |
| 0.94 | 83 | Suggest candidate |

The threshold separates these synthetic negative/positive fixtures (5/5); lexical full-query matches exceed 80,
zero overlap scores 0, and one matching word of three stays below 34. Tests assert both semantic decisions and
lexical ranking. These are reproducible boundary measurements, **not a real-model quality evaluation**. The
threshold is provisional until a representative IT/EN owner-labeled corpus is evaluated with the installed model;
that validation remains an integration follow-up, with no model download during these tests.

Below threshold the result says `noneCloseEnough` and `ask-user-to-create`. Neither path creates or starts anything.
MCP retains untrusted-declarations framing; the Orchestrator decides and creation still requires the user's request.
The start dialog shows the suggestion with an explicit choose button; it does not change a user's selection.
When the model is missing or embedding fails, the complete ranking uses words and labels this fallback.

Vectors are cached in memory under SHA-256 of mode and text, at most 6,000 entries; query and passage prefixes
remain distinct. The model revision is fixed by the existing embedding service. Edits change the hash. Neither
raw instructions nor goal excerpts appear in ranking explanations: only the winning field and optional run ID.
