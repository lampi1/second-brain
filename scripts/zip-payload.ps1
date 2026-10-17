# Build the update archive from an explicit asset allowlist. No live state, launch-result, profile or builder paths.
param([Parameter(Mandatory=$true)][string]$PayloadRoot, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$payloadPath = (Resolve-Path -LiteralPath $PayloadRoot).Path
$assets = @('releases', 'electron', 'engines', 'release.mjs', 'update.mjs', 'icon.ico', 'LICENSE', 'payload.json')
$paths = $assets | ForEach-Object { Join-Path $payloadPath $_ }
Compress-Archive -LiteralPath $paths -DestinationPath $Output -CompressionLevel Fastest -Force
