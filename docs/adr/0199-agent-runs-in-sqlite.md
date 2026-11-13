# 0199 — The agent runs move from agent-runs.json to SQLite (userData/app.db)

Status: accepted. Builds on ADR 0094 (node:sqlite for the search index), ADR 0130, ADR 0131 and ADR 0187; first slice
of the app's own database (S3 of the analysis «Second-brain: app solida, brain e Manutenzione»).

2026-10-29.

## Context

`AgentRunStore` (agents/runs.ts) kept every role run, the rollups of pruned runs, `prunedThrough` and Flash's outcomes
in one `userData/agent-runs.json`: up to 5000 runs, about 7 MB. Every change rewrote the whole file (serialize, tmp,
rename). On the main process this froze the window 50-250 ms per write (2026-10-27; slower on Windows with an
antivirus scanning each new file); the deferred writer and the sliced serializer (chunked-json.ts, #293-#297) only
softened it. The file is the user's history of what their agents did: losing or half-writing it is the worst outcome.

## Decision

**One database for the app's own records, `userData/app.db`, on `node:sqlite`.** `DatabaseSync` is built into the Node
that Electron 44 bundles (Node 24.21, SQLite 3.53; checked with `ELECTRON_RUN_AS_NODE`) and into the Node ≥ 22.13 the
tests and the CLIs run on; the search index already uses it (ADR 0094). No new dependency. It is loaded at first use
(`process.getBuiltinModule('node:sqlite')`), so a runtime without it fails at open, never at import. `main/app-db.ts`
opens it with WAL, `synchronous=normal` and a 5 s busy timeout, checks it with `pragma quick_check`, and keeps a
`schema_version(area, version)` table: each area has its forward migrations, one transaction per step; a version newer
than the build knows (a later release, then a rollback) is never downgraded.

**One row per run.** `agent_runs(id primary key, agent_id, started_at, ended_at, json)` with indexes on agent, start and
end, and `agent_runs_meta(key, value)` for the rollups, `prunedThrough` and Flash's log (`agents/runs-db.ts`). The store
keeps its runs in memory as before (the live record is still the chat's mirror); a save compares each run's JSON with
what the database holds and upserts only the changed ones, deletes the pruned ones and writes the meta keys that changed,
in one transaction. The deferred save builds the JSON in slices (chunked-json.ts) and then writes a few rows. Pruning,
the byte and count bounds, the rollups, `revision`, `onPrune` and the read worker's protocol are unchanged; the public
API of `AgentRunStore` is unchanged (plus `backend`, `close()` and an optional `{ db: false }`).

**The move, once, at start.** When the database holds no runs and `agent-runs.json` exists, it is read with the store's
own checks and imported in one transaction; the row count and ids are checked against what was read; the JSON is
renamed to `agent-runs.json.migrated-<date>` and only then is the transaction committed (a failed commit renames it
back). The JSON is kept, never deleted; records out of shape stay in it and are logged. A file the old store already
refused (bad version, bad rollups) is left where it is and the store reports its problem, as before.

**The fallback is the old store.** If the database cannot be opened (no `node:sqlite`, a lock, a schema from a newer
release) or the import fails, `log.error` says why with a hint and the store keeps reading and writing `agent-runs.json`
exactly as before; the move is tried again at the next start. `agent-runs.json` found beside a database that already
holds runs (a session that fell back to the JSON, or an older release that ran after the move) is merged (review
2026-10-29): the runs whose ids `app.db` lacks are added in one transaction (app.db's own copy of a run, its rollups and
Flash's log win), then the file is renamed `agent-runs.json.migrated-<date>` like the first move, with the counts in the
log (`merged`, `alreadyThere`). A file out of shape is left untouched and logged; a failed rename only means the next
start reads it again and adds nothing twice (runs are matched by id).
An empty database with no `agent-runs.json` reads the newest `agent-runs.json.migrated-*`, whether or not the database
was just moved aside: the app may have stopped between the JSON's rename and the import's commit (the rename is undone
on a failed commit, not on a crash).

**A damaged database is moved aside, never deleted.** Only SQLite's own verdict counts (SQLITE_CORRUPT, SQLITE_NOTADB or
a failed `quick_check`): the file and its `-wal`/`-shm` are renamed `app.db.corrupt-<date>`, a new database is created
and the runs are imported again from the newest `agent-runs.json.migrated-*`. Runs recorded after that copy are only in
the damaged file (said in the log). Any other error leaves the file as it is.

**The connection is released at quit** (`ChatManager.shutdown`, after the last flush); a later use opens it again.
Tests release every connection (`closeAppDbs()`) before removing their folders: Windows cannot delete an open file.

**Readers of the old file.** `npm run levels` takes an `app.db`, an `agent-runs.json` (or a migrated copy) or a userData
folder (its `app.db` when it holds runs, else its `agent-runs.json`), and opens the database read only, so it works
while the app runs. `scripts/dev-visual-smoke.mjs` seeds an `agent-runs.json` (the app moves it in at start) and
measures it before the launch. The health log's `agentRunsKb` measures the store in use.

## Consequences

- A run event writes a few rows instead of 7 MB: measured on 4554 runs (7 MB), a sync save with one changed run
  takes about 25 ms (it still serializes every run to find the changed one) against 59-94 ms for the JSON file, the
  deferred save about 10 ms in slices; the one-time move about 0.3 s; loading about 60 ms. Explicit per-run change
  marks could drop the remaining serialization (a follow-up; a missed mark would lose data, so the diff stays).
- `app.db` is larger than the JSON (about 9.7 MB for the same runs: pages and indexes).
- `npm run rollback` to a release before this one starts with no runs (the JSON is renamed). To keep them, rename
  `agent-runs.json.migrated-<date>` back to `agent-runs.json` before starting the old release; back on this release,
  the runs the old release added there are merged into `app.db` and the file goes aside again.
- Later slices add their own areas (tables and migrations) to `app.db` through `app-db.ts`; a damaged file is moved
  aside whole, so each area needs its own way back (as the runs have the migrated JSON).
