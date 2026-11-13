<!-- Review notes for the first-run fix; used by the integrating Orchestrator. -->
# fix(setup): ask before adopting a discovered brain

A fresh profile used to silently select the only brain found under the home directory. That made setup classify the installation as existing and displayed that brain's diagnostics. Discovery now returns suggestions through typed IPC; only an explicit folder choice connects them. Existing configured profiles and explicit SB_BRAIN overrides keep their behavior.

The existing offline FirstInterview now opens first, asks name and language, and saves resumable Claude Code / Codex / Cursor preferences without granting trust or logging in. Its summary offers detected folders or creation of a private memory inside userData on confirmation. The AI guide remains an explicit option. Existing profiles with unreadable me.md can finish setup with an actionable notice.

Dashboard map diagnostics appear as one count and an expandable details section. The bundled template no longer inherits an established owner's flow assertions, fabricates file references for absent optional integrations, or copies Cursor hooks targeting omitted Claude scripts. Existing brains are not rewritten.

The reported lines describe failed text/reference checks, not invented AI incidents. The auto-selection bug exposed the wrong user's context; stale assertions in the shipped template independently reproduced warnings in a new memory. No diagnostics were run against the owner's personal brain.

## Validation

- TypeScript passed, including the final branch-wrapper typecheck.
- ESLint passed on touched files, including the final engine-prefill change.
- 45 focused unit tests passed in six files, including collecting/checking the actual rendered template with zero warnings/problems and normal-startup service regression.
- Fresh-context reviewer found engine-default and unreadable-existing-profile issues; both corrected and re-reviewed. Final prefill/validation changes were re-reviewed without blockers; the 10 setup tests passed again after stricter validation.
- No e2e executed. Build and hidden visual verification currently blocked by sandbox denying esbuild access to parent directories. Full branch check and commit status are recorded in the handoff.
- Git staging is blocked: permission denied creating the worktree index.lock. Changes remain uncommitted; no push attempted.
- check:branch passed typecheck/lint, then could not load its unit suites because the default TEMP ssr cache is denied (EPERM). No branch-green marker was recorded; the isolated focused tests above did run successfully.

## Reproduce a brand-new profile (PowerShell, from this worktree)

This creates only temporary home/profile directories. SB_HOME changes discovery; it is not a general OS-home or credential sandbox. The memory is created inside the temporary profile when the interview is confirmed. Close the test app before the command restores the environment.

```powershell
$trial = Join-Path $env:TEMP ('second-brain-first-run-' + [guid]::NewGuid())
$trialHome = Join-Path $trial 'home'
$trialProfile = Join-Path $trial 'profile'
New-Item -ItemType Directory -Force $trialHome, $trialProfile | Out-Null
$savedEnv = @{}
foreach ($key in @('SB_HOME', 'SB_USER_DATA', 'SB_BRAIN', 'SB_MCP_PORT')) { $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
  $env:SB_HOME = $trialHome
  $env:SB_USER_DATA = $trialProfile
  Remove-Item Env:SB_BRAIN -ErrorAction SilentlyContinue
  $env:SB_MCP_PORT = '14389'
  npm.cmd run dev
} finally {
  foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key], 'Process') }
}
```

Agents must also set SB_HIDDEN=1 for their own launches. To exercise the discovered-folder offer, use another fresh SB_USER_DATA and omit SB_HOME; do not select the owner's brain during automated verification.
