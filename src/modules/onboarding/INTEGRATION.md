# Host integration (integrator-owned files)

The candidate has no consumed module registry, so the registration export in
`src/modules/registry.ts` is declarative. It does not mount UI or add IPC itself.

1. Create one main-process `OnboardingService(host, new LocalFiles(nativeMetadata))`.
   `host.backupRoot` must be private app userData, outside brain/project/git.
   Supply Electron safeStorage.encryptString/decryptString only when encryption
   is available, plus an allow callback checking installed harness, confirmed
   workspace trust and enterprise policy. The module NEVER changes that policy.
2. Add typed sender-checked IPC for OnboardingPort methods in the shared contract,
   main IPC handlers and preload allowlist, using the same single service.
   `apply` accepts only a previously prepared opaque plan id; never accept a
   renderer-supplied file path, contents, URL or plan object at that endpoint.
3. Mount `<OnboardingScreen port={port} language={language}/>` in FirstInterview
   and `<RegiaConnectAction port={port} language={language}/>` in RegiaOverlay.
   Keep `port` stable. Both surfaces share current() and preserve live undo.
4. Supply a native, no-hydration metadata adapter on Windows/macOS/Linux.
   It must inspect recall/offline/link flags and normalize them to local.ts bits.
   No adapter means discovery and config access stop before content reads.
5. Optional probe must use the official authenticated harness, with a bounded
   initialize/capability/tools-list check, provider identity and expected tools.
   Never use an agent turn, arbitrary command, service write, package install,
   pasted token or custom browser OAuth implementation. Without it: pending.

Current limitations: no production native metadata/login/probe adapter, strict
JSON only, only empty/comment-only existing Codex TOML, no restart recovery.
Azure remote stays pending for all harnesses (official compatibility restriction).
Generated config and existing file sizes are capped at 256 KiB. Concurrent edits
stop undo instead of auto-merging. Multi-file writes use compensating rollback.
`current()` restores the latest live operation across surface remounts; journals
and encrypted snapshots remain for manual recovery after process exit.
