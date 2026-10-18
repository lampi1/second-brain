# 0068 — Hybrid brain search: BM25 + a local multilingual embedding model

Date: 2026-10-17. Status: accepted (SPEC 23, S1).

The brain is searched by many callers (Ctrl+K, the brain pages' /api/search, the agents) and all of them found only
exact substrings: a paraphrase, the other language (Italian notes, English questions) or a typo found nothing. SPEC 23
asks for one search, by words and by meaning, local and offline, that still works without the model.

## Decision
- **One index, one API.** `HybridSearch` (src/main/search/hybrid) owns a worker thread with the index
  (userData/search/index.db, node:sqlite) and the model. Ctrl+K's brain group, `/api/search` (answered by main through
  `brain.serveApi`) and the `brain_search` tool on every chat's MCP endpoint all call `query`. `embed`, `cosine`, `topK`
  and `vectors(prefix)` are the building blocks for themes, error recall and the agent classifier.
- **Ranking.** FTS5 BM25 (accents folded, file names as a column, the last word also as a prefix, unknown words widened
  to indexed words within 1 typo from 4 letters, 2 from 8) fused by reciprocal rank (k = 60) with cosine nearest
  neighbours of the chunk vectors. A hit says whether it came from words, meaning or both.
- **Model.** `Xenova/multilingual-e5-small`, int8 ONNX (118 MB + 17 MB tokenizer), pinned to a revision and checked by
  sha256, downloaded once in the background to userData/search/model (progress and «Riprova» in the Ctrl+K footer) and
  offline afterwards; CPU, 2 threads, 384 dimensions, "query:"/"passage:" prefixes, mean pooling. Startup never waits:
  the service starts 5 s after the window, and until the model is ready the search is BM25 only.
- **Incremental.** Files = the brain's git files (tracked or new, not ignored), notes only (.md, .txt: scripts may hold tokens and every agent reads the hits), no secret files. A change seen by
  the Live watcher syncs after 3 s; only files with a new size or mtime are re-read, and vectors are keyed by the chunk
  text's hash, so only changed chunks are embedded (newest first, small batches between queries).
- **New runtime dependencies** (exact versions, older than 14 days): `onnxruntime-node` 1.30.0 (runs the model),
  `@huggingface/tokenizers` 0.2.0 (the model's tokenizer, native), `sqlite-vec` 0.1.9 (vector distance in SQLite; a JS
  cosine is the fallback). They are native, so `scripts/build.mjs` copies them into `out/node_modules` (this platform's
  binaries only, no DirectML: about 30 MB) and the release, which ships `out/`, carries them.

## Consequences
- The first full embedding of a brain of ~1,400 chunks takes a few minutes of background CPU, once.
- Disk: ~135 MB model + a few MB of index per brain under userData/search.
- Chat transcripts are not in the hybrid index yet: Ctrl+K keeps ADR 0023's index for them.
- The brain-side CLIs (session-find, ctx, the correction hook) need a loopback endpoint bound to 127.0.0.1 with the
  MCP server's auth: a later step (S3), proposed to the brain as a patch.

## Themes (2026-10-17, SPEC 23 b)

The Dashboard's Temi tab groups ai-errors.md and ideas.md by meaning (`search/hybrid/themes.ts`, `/api/themes`):

- One entry per dated error line (the vector of its chunk, already in the index) or per idea section (its title and
  "Idea:" line embedded on their own, cached by text: through the chunks every idea looked alike, the template
  dominates them).
- Average-linkage clustering over cosine, joined at 0.88; duplicates from 0.95. e5 cosines are compressed (unrelated
  texts still score ~0.75), so both thresholds were measured on the real brain's 326 errors: 0.86 already chains most
  errors into one theme. Only the newest 600 entries are clustered.
- Label: the theme's three most distinctive words (tf-idf against the file). Growing: the theme's share of the last
  7 days at least 1.5× its share of the 7 before, only once the file has 5 entries in that earlier week (a new brain
  has no baseline, and more logging overall is not a theme growing).
- Without the model the tab says the themes appear once it has read the brain; nothing falls back to words.

## Recall engine parity (2026-10-18)

Claude receives past-error context through its UserPromptSubmit hook. For the other app-managed engines,
ChatManager calls the same HybridSearch.recall before delivering initial prompts, later messages and agent mail.
It prepends up to three short, labelled quotations, keeping the original user message in the UI. The lookup has
a 300 ms deadline and failures, unavailable vectors or no matching errors leave delivery unchanged. Internal
handoff-note turns do not need task recall. No CLI login or external engine tokens are used for the lookup.
