# 0180 — Requested statistics and durable forgotten skills

2026-10-28. Accepted.

## Decision

Memoria's read-only scans, rollback availability, evidence statistics and the complete estimate backtest run in one lazy worker thread. It receives explicit read requests only; no polling, startup scan or child process is added. Main keeps writes, role changes and Undo. Historical evidence seeds are sealed once by main before the worker reads the log. Malformed optional reports do not hide the page. Routine observation stays governed by ADR 0179.

A migrated skill forgotten by an approved card or the user's delete action leaves one source-specific marker in `ops/state/migration-ignored/<sha256(source)>.json`. Source means the existing file/group/heading identity, not the generated skill name. Changing the source does not override an explicit forget. The marker is in the removal's snapshots: Undo restores the skill and removes the marker. After the bounded change history expires, removing the named marker explicitly permits migration again.

A requested migration backfills retained approved removals, including research entries that the old loader incorrectly excluded. The latest decision wins, including Undo. Only an untouched generated re-creation at the original destination, with no extra personal files, is removed; edits and ambiguous legacy associations stay intact. Already discarded history cannot be reconstructed.

Requested skill maintenance drops absent role declarations using the complete launch inventory (brain, home, shipped and embedded copies), preserving active snapshots and leaving open trials unchanged. Each role correction has its own Undo. Unavailable inventory never means everything is absent.

## Consequences

No routine executor is reintroduced. Estimates retain the same calculation; a worker failure returns a read error instead of running the expensive calculation on main. Ordinary task retries are informational; exhausted/permanent failures still warn once. Run starts join the asynchronous coalesced ledger writer; their chat checkpoint retains the run mirror until that write lands.

Tests assert behavior, data retention, boundaries and measured responsiveness. Five lexical tests that banned source words/CSS names and two stale Windows pixel baselines are removed. Existing behavior assertions and native screenshots remain, as do the public-repository guard and its historical hash pins.
