# Read only the isolated installer's links and stop only its verified test process. Used by test/installer.
param([Parameter(Mandatory=$true)][string]$InstallRoot, [int]$ProcessId = 0, [string]$Executable = '', [switch]$Cleanup)
$ErrorActionPreference = 'Stop'
if ($Cleanup) {
  $installPath = [IO.Path]::GetFullPath($InstallRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $temporaryPath = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $installPath.StartsWith($temporaryPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup requires an isolated temp installation' }
  $scriptArgument = '"' + (Join-Path $InstallRoot 'launch.vbs') + '"'
  function OwnedProcesses {
    @(Get-CimInstance Win32_Process | Where-Object {
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($installPath, [StringComparison]::OrdinalIgnoreCase)) -or
      (($_.Name -in @('wscript.exe', 'cscript.exe')) -and $_.CommandLine -and $_.CommandLine.Contains($scriptArgument))
    })
  }
  foreach ($entry in (OwnedProcesses)) {
    $current = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $entry.ProcessId)
    if (-not $current) { continue } # An earlier taskkill /T may already have removed this owned child.
    if ($current.CreationDate -ne $entry.CreationDate) { throw 'Cleanup process identity changed; refusing a reused PID' }
    $previousPreference = $ErrorActionPreference
    try {
      # Native stderr is not proof of a leftover: verify the process state after the attempted kill.
      $ErrorActionPreference = 'Continue'
      & "$env:SystemRoot/System32/taskkill.exe" /PID $entry.ProcessId /T /F 2>$null | Out-Null
    } finally { $ErrorActionPreference = $previousPreference }
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
      $remaining = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $entry.ProcessId)
      if (-not $remaining -or $remaining.CreationDate -ne $entry.CreationDate) { break }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($remaining -and $remaining.CreationDate -eq $entry.CreationDate) { throw "Isolated cleanup left process $($entry.ProcessId) running" }
    }
  $leftovers = @(OwnedProcesses)
  if ($leftovers.Count -gt 0) { throw ('Isolated cleanup left owned processes running: ' + (($leftovers | ForEach-Object { $_.ProcessId }) -join ',')) }
  exit 0
}
if ($ProcessId -gt 0) {
  $installPath = [IO.Path]::GetFullPath($InstallRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $temporaryPath = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $installPath.StartsWith($temporaryPath, [StringComparison]::OrdinalIgnoreCase) -or
      -not [IO.Path]::GetFullPath($Executable).StartsWith($installPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Stop requires an executable in an isolated temp installation' }
  $testProcess = [Diagnostics.Process]::GetProcessById($ProcessId)
  try {
    # Keep the OS handle: a PID disappearing cannot prove clean exit and must never count as success.
    $null = $testProcess.Handle
    if (-not [string]::Equals($testProcess.MainModule.FileName, $Executable, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing to stop a process outside this test installation'
    }
    if (-not $testProcess.HasExited -and -not $testProcess.CloseMainWindow()) {
      if (-not $testProcess.HasExited) { throw 'Could not request a clean close of the isolated app window' }
    }
    if (-not $testProcess.WaitForExit(30000)) { throw 'Isolated app did not exit cleanly within 30 seconds' }
    $code = $testProcess.ExitCode
    if ($code -ne 0) { throw "Isolated app exited with nonzero code $code" }
    ConvertTo-Json -InputObject ([pscustomobject]@{ pid = $ProcessId; exitCode = $code; executable = $Executable }) -Compress
  } finally { $testProcess.Dispose() }
  exit 0
  }
$linkShell = New-Object -ComObject WScript.Shell
$links = @('Desktop', 'Programs') | ForEach-Object {
  $link = $linkShell.CreateShortcut((Join-Path $InstallRoot "test-shortcuts/$_/second-brain.lnk"))
  [pscustomobject]@{ target = $link.TargetPath; args = $link.Arguments; cwd = $link.WorkingDirectory; icon = $link.IconLocation }
}
ConvertTo-Json -InputObject @($links) -Compress
