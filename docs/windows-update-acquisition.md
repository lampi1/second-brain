<!-- Public Windows update acquisition: trust, extraction, integration boundary and execution limits. -->
# Public Windows update acquisition

`UpdateAcquirer` in main/update/download.ts is a preparation helper for the existing release CLI, not another updater.
Main owns the single instance, installed stable version and a dedicated local cache, normally a subfolder of the shared
installation root. Neither URLs nor cache paths come from renderer IPC. This module never stages, activates, restarts,
quiesces sessions, modifies userData, configures engines or changes global settings.

```ts
const acquisition = new UpdateAcquirer({ cacheRoot: mainOwnedUpdateCache });
const candidate = await acquisition.prepareLatest(installedVersion, { signal });
if (candidate) {
  try {
    // Use bundled Electron-as-Node, argv and the one installed release CLI:
    // stage-update candidate.payloadDir candidate.manifestSha256
    // Check returned marker id/source/manifestSha256 against candidate, then expose ready.
  } finally {
    acquisition.discard(candidate); // only after staging is finished, never concurrently
  }
}
```

The main-only return value contains id, version, source, changes, releaseUrl, payloadDir and manifestSha256. Null means
there is no newer stable version (or no published latest release). A returned candidate is acquired, **not ready or
applied**. The release CLI remains the only per-asset hash/layout/immutability verifier and writes its staged marker.
Main must complete that verification before showing ready. Modal consent, checkpoint/persistence, quiescence, application,
recoverable relaunch and rollback orchestration remain main/UI responsibilities. No terminal is exposed to the colleague.

## Fixed source and trust chain

Only the unauthenticated public GitHub latest-release API for lampi1/second-brain is queried. No tokens, cookies or private
repository API is used. Only a published non-draft, non-prerelease vMAJOR.MINOR.PATCH newer than the installed version is
eligible. The helper uses exactly one second-brain-ID-windows-x64-setup.json asset, its GitHub SHA-256 digest, and the
expected second-brain-ID-windows-x64-update.zip asset in that same release. URLs are reconstructed from fixed repository,
validated tag and expected name; arbitrary asset URLs are ignored. Missing GitHub asset digests fail closed.

The wrapper must be clean x64 provenance, matching version and full source SHA; ID's short SHA must prefix that source.
Archive hash must agree between wrapper and GitHub asset metadata. Extracted payload.json must match its pinned hash,
source/version/ID/clean flag and exact archive file inventory. The stage CLI then verifies each immutable asset/hash and
portable release metadata. This authenticates against the trusted maintainer's published repository release over HTTPS;
it does not independently attest CI, code signatures or approval gates. The publisher remains responsible for those gates.

Requests use manual redirects (at most three), HTTPS without URL credentials/alternate ports, exact same-path github.com
asset redirects or the exact release-assets.githubusercontent.com and objects.githubusercontent.com CDN hosts. No wildcard
host trust or authentication forwarding. Release notes are bounded untrusted text; renderer must use its normal safe
text/Markdown rendering. No request to the live repository is made by the tests.

## Resource and extraction boundaries

API/wrapper bodies are capped at 2MiB, payload manifest at8MiB, archive at1.5GiB, each file at512MiB, expanded bytes at2GiB
and ZIP entries at25,000. A4GiB logical cache-file budget reserves the archive plus2GiB expansion before download;
cache enumeration itself is bounded and rejects links. Request/whole-preparation deadlines and AbortSignal are enforced.
One preparation per instance runs at a time. Failed private reservations are removed only after exact canonical path and
directory identity checks; discard accepts only this instance's acquired candidates. Main discards after stage commits or
fails. Crash leftovers count toward budget and must be handled by separately reviewed main cache recovery; they are not
blindly recursively deleted. No disk-space reservation or immunity to arbitrary same-user cache mutation is claimed.

Windows system PowerShell runs a constant .NET ZipArchive extraction program, without profile, ExecutionPolicy changes,
PATH executable lookup or shell interpolation. Paths are environment data. All ZIP entries are preflighted before any
extraction writes. Windows Compress-Archive emits backslash entry names, so both separators are normalized before all
path, directory, type, duplicate and file-parent collision checks. Root/drive/ADS/traversal/empty segments, DOS devices,
trailing dots/spaces, symlink/reparse/special types and canonical case/slash aliases fail closed. Current package paths
must use portable ASCII components. New files use CreateNew and decompression enforces declared/actual length limits.
No archive contents execute. A modified private cache by a hostile process with the same user authority is not a separate
security principal; this is not a general-purpose hostile shared-directory extraction API.

The default extractor is Windows-only; other product platforms must not expose this preparation capability. Dependency
injections for fetch/extract are main/test-only and never IPC inputs. Tests use simulated metadata/response streams,
tiny local ZIPs and the actual existing Compress-Archive producer. Native extraction and stage integration fixtures pass;
real release download, compiled Electron/main/UI update flow, apply/restart and CI remain unverified here.

Primary contracts: [GitHub releases](https://docs.github.com/en/rest/releases/releases),
[GitHub release assets](https://docs.github.com/en/rest/releases/assets),
[Microsoft ZipArchive](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.ziparchive).
