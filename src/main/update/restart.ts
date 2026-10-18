// Main-only Windows update restart handoff. A hidden helper holds the original process handle, waits for its
// real exit without a launch deadline, and starts only the generated stable VBS launcher. No activation here.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Readiness means a cold node + Windows PowerShell 5.1 start (antivirus scan included): 5 s was too tight on a busy PC
// (the native test failed under load). Both windows only bound a helper that never answers; a healthy one is faster.
export const RESTART_READY_MS = 30_000;
export const RESTART_CANCEL_MS = 15_000;

// Fixed code: all paths/PID travel in environment values. The launcher may legitimately change during apply,
// so verify its complete generated grammar both at readiness and immediately before starting it.
const helper = String.raw`
$ErrorActionPreference = 'Stop'
function Assert-Local([string] $Value, [bool] $Directory) {
  if ($Value -notmatch '^[A-Za-z]:\\' -or $Value.Contains('"')) { throw 'Expected local absolute path' }
  $Full = [IO.Path]::GetFullPath($Value)
  if ($Full -cne $Value) { throw 'Noncanonical path' }
  $Item = Get-Item -LiteralPath $Full -Force
  if ([bool]$Item.PSIsContainer -ne $Directory) { throw 'Unexpected path kind' }
  while ($null -ne $Item) {
    if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse path denied' }
    if ($Item -is [IO.FileInfo]) { $Item = $Item.Directory } else { $Item = $Item.Parent }
  }
}
function Assert-Launcher {
  Assert-Local $env:SB_RESTART_BASE $true
  $Launcher = [IO.Path]::Combine($env:SB_RESTART_BASE, 'launch.vbs')
  Assert-Local $Launcher $false
  Assert-Local ([IO.Path]::Combine($env:SB_RESTART_BASE, 'release.mjs')) $false
  if ((Get-Item -LiteralPath $Launcher).Length -gt 16384) { throw 'Launcher too large' }
  $Text = [IO.File]::ReadAllText($Launcher)
  $CrLf = [string]::Concat([char]13, [char]10)
  $Lines = $Text.Split(@($CrLf), [StringSplitOptions]::None)
  $Expected = @("' second-brain stable launcher, hidden and independent of cmd/PATH", 'Dim s, f, b, r',
    'Set s = CreateObject("WScript.Shell")', 'Set f = CreateObject("Scripting.FileSystemObject")',
    'b = f.GetParentFolderName(WScript.ScriptFullName)', 'r = ""')
  $Count = 0
  for ($i = 6; $i -lt $Lines.Length; $i++) {
    if ($Lines[$i] -notmatch '^If r = "" And f[.]FileExists\(b & "\\electron\\([0-9]+[.][0-9]+[.][0-9]+)\\electron[.]exe"\) Then r = b & "\\electron\\\1\\electron[.]exe"$') { break }
    $Version = $Matches[1]
    $Expected += 'If r = "" And f.FileExists(b & "\electron\' + $Version + '\electron.exe") Then r = b & "\electron\' + $Version + '\electron.exe"'
    $Count++
  }
  if ($Count -lt 1 -or $Count -gt 8) { throw 'Invalid runtime candidates' }
  $Expected += @('If r = "" Then WScript.Quit 1', 's.Environment("PROCESS")("ELECTRON_RUN_AS_NODE") = "1"',
    's.Environment("PROCESS")("SB_RELEASES_ROOT") = b',
    's.Run Chr(34) & r & Chr(34) & " " & Chr(34) & b & "\release.mjs" & Chr(34) & " launch", 0, False', '')
  if ($Text -cne [string]::Join($CrLf, $Expected)) { throw 'Unrecognized stable launcher' }
  return $Launcher
}
$ParentProcess = [Diagnostics.Process]::GetProcessById([int]$env:SB_RESTART_PID)
$null = $ParentProcess.Handle
$null = Assert-Launcher
[Console]::Out.WriteLine('SB_RESTART_READY')
[Console]::Out.Flush()
$ParentProcess.WaitForExit()
$Launcher = Assert-Launcher
$Start = New-Object Diagnostics.ProcessStartInfo
$Start.FileName = [IO.Path]::Combine([Environment]::SystemDirectory, 'wscript.exe')
$Start.Arguments = '"' + $Launcher + '"'
$Start.WorkingDirectory = $env:SB_RESTART_BASE
$Start.UseShellExecute = $false
$Start.CreateNoWindow = $true
$Start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$Child = [Diagnostics.Process]::Start($Start)
if ($null -eq $Child) { throw 'Launcher failed' }
$Child.Dispose()
$ParentProcess.Dispose()
`;

// Node can run detached without a console; PowerShell 5.1 cannot. Keep its libuv job owned by this
// independent supervisor until the waiter closes. Only that exact waiter is killed on cancellation.
const supervisor = String.raw`
const { spawn } = require('node:child_process');
const notify = message => {
  if (process.connected) process.send(message, () => {});
};
const worker = spawn(process.env.SB_RESTART_POWERSHELL,
  ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', process.env.SB_RESTART_COMMAND],
  { cwd: process.env.SB_RESTART_BASE, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let ready = '';
let announced = false;
process.on('message', message => { if (message?.type === 'cancel') worker.kill(); });
worker.once('error', () => notify({ type: 'failed' }));
worker.stderr.resume();
worker.stdout.on('data', chunk => {
  if (announced) return;
  ready += chunk.toString('utf8');
  if (ready.length > 1024) { notify({ type: 'failed' }); worker.kill(); }
  else if (ready === 'SB_RESTART_READY\r\n' || ready === 'SB_RESTART_READY\n') {
    announced = true;
    notify({ type: 'ready', workerPid: worker.pid });
  }
});
worker.once('close', () => {
  if (process.connected) process.send({ type: 'stopped' }, () => { if (process.connected) process.disconnect(); });
});
`;

export async function prepareUpdateRestart({ base, pid }: { base: string; pid: number }): Promise<{ cancel(): Promise<void> }> {
  if (process.platform !== 'win32' || pid !== process.pid) throw new Error('Riavvio disponibile solo per il processo Windows corrente.');
  if (!/^[a-z]:[\\/]/i.test(base) || base.includes('"') || path.resolve(base).toLowerCase() !== fs.realpathSync.native(base).toLowerCase()) throw new Error('Percorso installazione non valido.');
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !/^[a-z]:[\\/]/i.test(systemRoot)) throw new Error('Directory di sistema Windows non disponibile.');
  const child = spawn(process.execPath, ['-e', supervisor], {
    cwd: base, detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: undefined, NODE_PATH: undefined,
      SB_RESTART_BASE: path.resolve(base), SB_RESTART_PID: String(pid),
      SB_RESTART_POWERSHELL: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      SB_RESTART_COMMAND: Buffer.from(helper, 'utf16le').toString('base64') },
  });
  let closed = false;
  let stopped = false;
  let startError: Error | undefined;
  child.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'stopped') stopped = true; });
  const exited = new Promise<void>(resolve => {
    child.once('error', error => { startError = error; if (!child.pid) stopped = true; });
    child.once('close', () => { closed = true; resolve(); });
  });
  const cancel = async () => {
    if (closed && stopped) return;
    if (child.connected) child.send({ type: 'cancel' }, () => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Helper di riavvio non terminato: aggiornamento bloccato.')), RESTART_CANCEL_MS); })]);
      if (!stopped) throw new Error('Uscita del waiter di riavvio non confermata: aggiornamento bloccato.');
    } finally { clearTimeout(timer); }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const isReady = (message: unknown) => message !== null && typeof message === 'object' && 'type' in message && message.type === 'ready';
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Helper di riavvio non pronto.')), RESTART_READY_MS);
      child.on('message', message => {
        if (isReady(message)) resolve();
        else if (message && typeof message === 'object' && 'type' in message && message.type === 'failed') reject(new Error('Helper di riavvio non pronto.'));
      });
      void exited.then(() => reject(new Error('Helper di riavvio terminato prima della conferma.', { cause: startError })));
    });
    if (closed) throw new Error('Helper di riavvio non più attivo.');
    child.channel?.unref(); child.unref();
    return { cancel };
  } catch (error) {
    await cancel(); // A rejected cancellation must keep main blocked; do not resume editing or apply.
    throw error;
  } finally { clearTimeout(timer); }
}
