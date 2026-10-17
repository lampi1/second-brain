# Release writer protocol 1

The installed release CLI is the only activation path. A public update manifest and release metadata declare
`writerProtocol: 1`. `status --json` reports the loaded code's `writerProtocol`, the installed state's `stateProtocol`,
and `lock` (null when no operation owns the root). Main enables automatic application only when both protocols are 1,
there is no lock, and its normal checkpoint, consent and quiescence requirements have succeeded.

Commands used by main:

- `stage-update <payload> <expected-manifest-sha256>` verifies/stages without activation.
- `apply-update <id> <expected-manifest-sha256> <expected-current-id>` checks the consented digest and current selection
  inside the common writer lease, then verifies every asset before replacing bootstrap files or activating.
- `rollback-if <expected-current-target> <expected-previous-running>` refuses to swap a selection another operation changed.
  Both arguments are mandatory. Manual `rollback` remains an explicit operator action; main never uses it for recovery.

All supported writers acquire the same exclusive `.release-writer-lock` directory: installation, promotion and
retention, staging, bootstrap replacement/application, rollback, and launcher's bad-release update. Each lease records
a random owner token and PID. Ownership/inode/token are checked before writes and cleanup. A process cannot release
another process's lease. There is no expiry, PID-based reclamation or automatic stale-lock stealing.

The launcher releases its short selection lease before waiting for the app. It compares the complete saved state
again under a lease immediately before spawning and before marking a failed release bad. A concurrent activation
therefore stops the superseded launcher without restoring its old current/history/bad snapshot. No readiness wait
blocks a different supported writer for 30 seconds.

Before the first mutation, the lease persists copies and SHA-256 hashes of prior bootstrap/current/launcher files in
`.release-writer-lock/before`, then records dirty ownership. A successful operation persists a clean commit before
removing its own lock. An exception after mutation, failed commit persistence, termination or crash preserves the lock
and journal. New writers and launch refuse to continue. Status remains read-only; its lock report is diagnostic, not
permission to reclaim. Keep the directory, owner token and backups for explicit maintenance: stop all affected writers,
verify the token and backup hashes, determine whether to complete or restore the interrupted operation, then validate
the restored bootstrap/state before releasing ownership. There is no command which blindly deletes a stale lock.
The journal does not promise automatic recovery from a partial bootstrap update or power loss.

Inno copies its entire payload to a private per-Setup staging directory beneath `.installer/<id>/<token>`, not into
active release/runtime/bootstrap paths. Its temp-directory-derived token keeps concurrent Setup payloads separate.
The staged pinned bootstrap invokes `install-payload`, verifies the manifest and publishes immutable directories plus
active state under the common lease. The installer payload checksum is compiled into Setup. Draft local installers
remain drafts and never qualify as published automatic updates.

The uninstaller holds the same native exclusive-directory lease from initialization until completion/cancellation.
It validates its owner token and parent PID through a read-only CLI preflight, refuses a running stable app, checks
managed trees for reparse points, and journals active files before deletion. Dirty failures preserve recovery evidence.
It removes managed binaries, staging and shell registration; `%APPDATA%/second-brain`, the chosen brain, and the dev
profile remain untouched. An incomplete Electron process census refuses uninstall instead of assuming no app is running.

Historical scripts which never implemented this protocol cannot be made cooperative retroactively. Automatic adoption
of a nonempty legacy state is refused for every supported writer, including Setup; an offline maintenance migration
must first stop all legacy writers. Do not upgrade flags or copy a new bootstrap over a running legacy writer and claim
it is serialized. An initially empty installation can initialize protocol 1 normally. Updates with missing/different
manifest or release protocols are rejected before publication.

Validation of the implementation uses inert Node/CLI/filesystem fixtures and an Inno syntax-only compilation. Native
uninstall preparation with a live readiness PID is rejected. In the restricted development context, an attempted idle
census encountered an Electron process with an unavailable image path and correctly refused uninstall; successful idle
uninstall still needs the normal-host installer smoke. No real installer, application exit, restart or user data deletion
is exercised by these tests. Final installer/app-update smoke and e2e run only on main under the project gates.
