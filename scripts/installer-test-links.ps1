# Read only the isolated installer's links and stop only its verified test process. Used by test/installer.
param([Parameter(Mandatory=$true)][string]$InstallRoot, [int]$ProcessId = 0, [string]$Executable = '', [switch]$Cleanup)
$ErrorActionPreference = 'Stop'
if ($Cleanup) {
  $installPath = [IO.Path]::GetFullPath($InstallRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $temporaryPath = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $installPath.StartsWith($temporaryPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup requires an isolated temp installation' }
  $scriptArgument = '"' + (Join-Path $InstallRoot 'launch.vbs') + '"'
  Get-CimInstance Win32_Process | ForEach-Object {
    $owned = $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installPath, [StringComparison]::OrdinalIgnoreCase)
    $launcher = ($_.Name -in @('wscript.exe', 'cscript.exe')) -and $_.CommandLine -and $_.CommandLine.Contains($scriptArgument)
    if ($owned -or $launcher) {
      & "$env:SystemRoot/System32/taskkill.exe" /PID $_.ProcessId /T /F 2>$null | Out-Null
    }
  }
  exit 0
}
if ($ProcessId -gt 0) {
  $testProcess = [Diagnostics.Process]::GetProcessById($ProcessId)
  if (-not [string]::Equals($testProcess.MainModule.FileName, $Executable, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to stop a process outside this test installation'
  }
  & "$env:SystemRoot/System32/taskkill.exe" /PID $ProcessId /T /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not stop isolated installer process' }
  exit 0
}
$linkShell = New-Object -ComObject WScript.Shell
$links = @('Desktop', 'Programs') | ForEach-Object {
  $link = $linkShell.CreateShortcut((Join-Path $InstallRoot "test-shortcuts/$_/second-brain.lnk"))
  [pscustomobject]@{ target = $link.TargetPath; args = $link.Arguments; cwd = $link.WorkingDirectory; icon = $link.IconLocation }
}
ConvertTo-Json -InputObject @($links) -Compress
