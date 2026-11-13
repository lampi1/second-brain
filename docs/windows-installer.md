<!-- Windows distribution and update contract: for maintainers, CI and the product update UI. -->
# Windows installer and updates

The colleague receives one `second-brain-<release>-windows-x64-setup.exe`. Running it installs for the current user and
starts the product. Node, npm, Git, a checkout and manual PATH edits are not required. Windows 10/11 x64 is the initial
target. Engine account sign-in remains a separate product setup step; the installer never receives credentials.

The installer carries the built app, Electron, the pinned Windows Claude engine and the public empty brain template.
It installs in `%LOCALAPPDATA%/second-brain` with the existing stable layout. Start Menu and desktop links launch the
hidden `launch.vbs`; `launch.cmd` is a fallback for diagnostics. Both use the bundled runtime. The icon is the durable
root `icon.ico`, outside removable release directories. The manual `Second Brain (dev)` shortcut and the checkout are
separate. Stable profile/chats stay in `%APPDATA%/second-brain`; development uses `second-brain-dev`.

## First-run memory

The first setup creates the memory itself: a new, empty brain in the app's data folder (`%APPDATA%/second-brain`),
made on confirmation by `modules/ai-first/default-brain.ts` (only the owner's profile and `brain.json`, ADR 0072), or it
links a brain the owner already has through the native folder picker. No installer, helper or hook runs, nothing is
written outside that folder, and engine login remains explicit in product setup.

## Build and release gates

On a prepared Windows x64 build host, run `npm run package:windows`. The script stages an isolated frozen copy, then
uses Inno Setup **6.5.4**, bootstrapped in portable mode under `test-results/toolchain`. Its official download is pinned
to SHA-256 `fa73bf47a4da250d185d07561c2bfda387e5e20db77e4570004cf6a133cc10b1`. There is no new npm/runtime dependency.
The compiler is never installed on colleagues' PCs. Check the [vendor release assets](https://github.com/jrsoftware/issrc/releases/expanded_assets/is-6_5_4)
and [portable-mode documentation](https://jrsoftware.org/ishelp/topic_technotes.htm) when intentionally updating it.

Outputs are under `test-results/installer/dist`: Setup, update ZIP, SHA-256 files and a portable provenance manifest.
Uncommitted builds are marked DRAFT and cannot be staged as stable updates. `--payload-only` builds just the update
archive without invoking/downloading the Setup compiler; it does not produce an installer or satisfy the release gate.

Branches run `check:branch`; e2e run only on main. Main CI runs the full `check` on Windows/Linux/macOS. Windows then runs
`test:stable`, packages, and runs `test:installer` on those exact bytes. The installer smoke uses a temporary home and
dedicated profile, isolated shortcuts, hidden windows and a PATH without Node/npm. It checks Setup, first launch,
reopening through VBS, durable link targets and a screenshot of the installed product. On CI, `test:stable` uses a
synthetic home/brain while exercising real auto-discovery; local stable checks still use the developer's brain read-only.

The owner can manually start **Windows release draft** on main for an existing `v<package version>` tag on that commit.
It repeats CI, verifies the tag/source/hash, then creates a draft GitHub release. The owner reviews and publishes the
draft. Neither local packaging nor promotion pushes, publishes or tags. GitHub runs are unverified until they actually run.
No signing certificate is configured by this change; this does not claim a signed installer or established Windows reputation.

`promote` remains owner-only: clean main, full `check`, `test:stable`, then activation. `--skip-check` and `--allow-dirty`
are rejected. Tests use `stage-test` exclusively in disposable directories; staging cannot target the real installation.

## One update backend

The product UI owns the trusted release source, download, archive SHA-256 verification, safe extraction and explicit
confirmation. It invokes the installed `release.mjs` with the bundled Electron in Node mode, passing arguments as an
array, never a shell string. No terminal is part of the colleague's update flow.

| Operation | CLI arguments | Effect |
| --- | --- | --- |
| Inspect | `status --json` | Current, previous, bad/history and staged candidates |
| Prepare in background | `stage-update <extracted-payload> <payload-manifest-sha256>` | Rechecks every asset; stages new immutable directories and a marker; leaves current, launcher, shortcuts and running app alone |
| Confirm and apply | `apply-update <id>` | Rechecks staged bytes, replaces compatible bootstrap assets, atomically switches current and retains previous; no process stop/start |
| Roll back | `rollback` | Swaps current/previous and rewrites stable launchers; no profile or chat deletion |
| Start | `launch` | Starts current; reports readiness, skips bad releases and falls back to previous |

The UI must show its modal before apply and coordinate the later quit/relaunch. These CLI primitives do not manufacture
user consent. Profile migrations must remain backward compatible with the retained release; data rollback is not provided.
The manifest is schema 1, paths are relative, source is a full commit SHA and all files have SHA-256. The expected manifest
digest comes from the trusted distribution metadata. Dirty payloads, path escapes, links and incompatible collisions fail
closed. Existing runtime/release directories are never extended or overwritten during staging.

Uninstall removes the files/links tracked by Setup and the generated launcher/state files. It preserves the brain,
credentials and profile/chats. Assets introduced later through local promotion/background updates may remain as backups;
this change does not recursively delete the shared root or user data.
