// Windows ZIP acquisition boundary. Native ZipArchive parses the archive; every name/type/size is preflighted before
// CreateNew extraction into a new private cache. No executable/archive contents run and no process policy changes.
import { execFile } from 'node:child_process';
import path from 'node:path';

// Constant script: archive/destination are environment data, never interpolated command text. No Expand-Archive,
// shell path resolution, profiles, global configuration or ExecutionPolicy bypass is used.
const EXTRACT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($env:SB_UPDATE_DESTINATION)
$archive = $null
try {
  if (([IO.File]::GetAttributes($root) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'linked root' }
  if ([IO.Directory]::GetFileSystemEntries($root).Length -ne 0) { throw 'nonempty root' }
  $archive = [IO.Compression.ZipFile]::OpenRead($env:SB_UPDATE_ARCHIVE)
  if ($archive.Entries.Count -eq 0 -or $archive.Entries.Count -gt 25000) { throw 'entry count' }
  $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $files = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $plan = New-Object Collections.Generic.List[object]
  [long]$total = 0
  foreach ($entry in $archive.Entries) {
    # Windows PowerShell Compress-Archive emits backslashes. Canonicalize BEFORE all safety/type/collision checks.
    $raw = $entry.FullName.Replace('\', '/')
    $directory = $raw.EndsWith('/')
    $name = $raw
    if ($directory) { $name = $raw.Substring(0, $raw.Length - 1) }
    if ($name.Length -eq 0 -or $name.Length -gt 500 -or $name.StartsWith('/')) { throw 'invalid path' }
    foreach ($segment in $name.Split('/')) {
      if ($segment -notmatch '^[A-Za-z0-9._+ -]+$' -or $segment -eq '.' -or $segment -eq '..' -or $segment -match '[. ]$' -or $segment -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { throw 'unsafe path' }
    }
    if (!$seen.Add($name)) { throw 'case collision' }
    $kind = ($entry.ExternalAttributes -shr 16) -band 61440
    if (($kind -ne 0 -and $kind -ne 32768 -and $kind -ne 16384) -or (($entry.ExternalAttributes -band 1024) -ne 0)) { throw 'link or special file' }
    if (($kind -eq 16384 -and !$directory) -or ($kind -eq 32768 -and $directory)) { throw 'entry type mismatch' }
    if ($entry.Length -lt 0 -or $entry.Length -gt 536870912 -or $total -gt (2147483648 - $entry.Length)) { throw 'expanded size' }
    if ($directory -and $entry.Length -ne 0) { throw 'directory data' }
    $total += $entry.Length
    if (!$directory) { [void]$files.Add($name) }
    $plan.Add([pscustomobject]@{ Name = $name; Entry = $entry; Directory = $directory })
  }
  foreach ($item in $plan) {
    $parts = $item.Name.Split('/')
    for ($i = 1; $i -lt $parts.Length; $i++) {
      if ($files.Contains(($parts[0..($i - 1)] -join '/'))) { throw 'file parent collision' }
    }
  }
  foreach ($item in $plan) {
    $destination = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $item.Name.Replace('/', '\')))
    if (!$destination.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'escape' }
    $parent = [IO.Path]::GetDirectoryName($destination)
    [void][IO.Directory]::CreateDirectory($parent)
    $check = $parent
    while ($check.Length -ge $root.Length) {
      if (([IO.File]::GetAttributes($check) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'linked parent' }
      if ($check -eq $root) { break }
      $check = [IO.Path]::GetDirectoryName($check)
    }
    if ($item.Directory) { [void][IO.Directory]::CreateDirectory($destination); continue }
    $inputStream = $null
    $outputStream = $null
    try {
      $inputStream = $item.Entry.Open()
      $outputStream = New-Object IO.FileStream($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      $buffer = New-Object byte[] 65536
      [long]$written = 0
      while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        if ($written -gt ($item.Entry.Length - $count)) { throw 'expanded size mismatch' }
        $outputStream.Write($buffer, 0, $count)
        $written += $count
      }
      if ($written -ne $item.Entry.Length) { throw 'truncated entry' }
    } finally {
      if ($null -ne $outputStream) { $outputStream.Dispose() }
      if ($null -ne $inputStream) { $inputStream.Dispose() }
    }
  }
} finally { if ($null -ne $archive) { $archive.Dispose() } }
`;

export async function extractUpdateZip(archive: string, destination: string, signal?: AbortSignal): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Update acquisition currently supports Windows only.');
  const exe = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await new Promise<void>((resolve, reject) => execFile(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', EXTRACT], {
    env: { ...process.env, SB_UPDATE_ARCHIVE: archive, SB_UPDATE_DESTINATION: destination },
    shell: false, windowsHide: true, timeout: 120000, signal, maxBuffer: 1024 * 1024,
  }, error => error ? reject(new Error('Update archive is invalid, unsafe, cancelled or could not be extracted.', { cause: error })) : resolve()));
}
