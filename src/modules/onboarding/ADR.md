# Confirmed project connector exception

The existing coexistence rule prohibits changing harness config without the person.
This isolated module proposes a narrowly scoped exception: a person selects a local
project, sees a redacted immutable plan, then confirms that plan once. Only project
MCP files are changed. Hooks, allow/deny settings, user config, organization policy
and trust remain outside the module. Host integration must explicitly adopt this
exception; an agent message cannot activate it or authorize real config changes.

Snapshots require an OS-encrypted host implementation (Electron safeStorage with
encryption available). Never commit or send snapshots to agents. Authentication
belongs to the official harness; configuration saved is always pending until a
host adapter proves provider identity using initialize and tools/list only.

Catalog reviewed 2026-10-17 against official sources in catalog.ts. Azure remote
authentication does not support Codex; Claude Code/Cursor require a custom Entra
application. Azure plans stay pending without writing config. No package install,
invented stdio command or automatic downgrade is permitted.

This slice accepts strict JSON and empty/comment-only Codex TOML. JSONC and existing
nontrivial TOML stop before publication rather than discarding comments/settings.
Undo preserves concurrent edits and requests review instead of overwriting them.
The journal and encrypted snapshots survive process exit, but automated restart
recovery is not implemented; the integrator must keep the recovery evidence.
Content hashes are rechecked immediately before publication; noncooperating
external writers can still race the OS rename. Do not claim a filesystem-wide
compare-and-swap or atomic transaction across three different files.

Cross-platform paths use os.homedir() and the correct path flavor. No shells run.
LocalFiles requires a host-native residency/attribute adapter on EVERY OS; it must
map cloud recall/offline/reparse metadata into the normalized Windows-style bits
documented in local.ts. Missing/unknown metadata fails closed before content reads.
Node fs alone cannot establish residency. No such native bridge ships in this
candidate; integration is blocked on that adapter, including on macOS/Linux.
