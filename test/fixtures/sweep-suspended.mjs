// Ends the fake CLIs' children left suspended by a test run. Node creates a child suspended and resumes it right
// after (libuv); a fake CLI (fake-claude.mjs) killed in between leaves that child suspended forever: it never runs,
// so its own timer never ends it, and its parent is gone (three such, 7 hours old, found on 2026-10-14). Only
// processes started during this run, with the fakes' exact child command line (`-e "setTimeout(() => {}, N)"`), a
// parent no longer running and every thread suspended: never a running test child, nothing of the user's.
// Used by vitest.config.ts (globalSetup) and playwright.config.ts (globalSetup/globalTeardown).
import { execFile } from 'node:child_process';

/** Stops this run's suspended fake children; resolves with their pids (none off Windows or on any error). */
export function sweepSuspended(sinceMs) {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const ps = [
    `$since = [DateTimeOffset]::FromUnixTimeMilliseconds(${Math.floor(sinceMs)}).LocalDateTime`,
    "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe' OR Name = 'electron.exe'\" | Where-Object {",
    "  $_.CreationDate -ge $since -and $_.CommandLine -match '-e \"?setTimeout\\(\\(\\) => \\{\\}, \\d+\\)\"?\\s*$' -and",
    '  -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue)',
    '} | ForEach-Object {',
    '  $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue',
    "  if ($p -and $p.Threads.Count -and -not @($p.Threads | Where-Object { [string]$_.WaitReason -ne 'Suspended' }).Count) {",
    '    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId',
    '  }',
    '}',
  ].join('\n');
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
      { encoding: 'utf8', windowsHide: true, timeout: 120000 }, (err, out) => {
        const pids = err ? [] : String(out).split(/\r?\n/).map(Number).filter(n => n > 0);
        if (pids.length) console.log(`\n> ended ${pids.length} suspended fake child process(es) left by this run: ${pids.join(', ')}`);
        resolve(pids);
      });
  });
}

/** vitest globalSetup: the sweep runs once all test files are done. */
export default function setup() {
  const since = Date.now();
  return async () => { await sweepSuspended(since); };
}
