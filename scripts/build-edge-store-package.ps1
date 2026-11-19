param(
  [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root "manifest.json"
$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
$version = $manifest.version
$outputRoot = Join-Path $root $OutputDirectory
$staging = Join-Path $outputRoot "edge-store-$version"
$zipPath = Join-Path $outputRoot "video-tracker-$version-edge-store.zip"

New-Item -ItemType Directory -Force $outputRoot | Out-Null
if (Test-Path -LiteralPath $staging) {
  $resolvedOutput = (Resolve-Path $outputRoot).Path
  $resolvedStaging = (Resolve-Path $staging).Path
  if (-not $resolvedStaging.StartsWith(
    $resolvedOutput + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Refusing to remove a staging directory outside dist."
  }
  Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
}

New-Item -ItemType Directory -Force $staging | Out-Null

$files = @(
  "background.js",
  "core.js",
  "device-profile.js",
  "i18n.js",
  "icons.js",
  "library.css",
  "library.html",
  "library.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "privacy.html",
  "THIRD_PARTY_NOTICES.md"
)

foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination $staging
}

foreach ($directory in @("assets", "_locales")) {
  Copy-Item -LiteralPath (Join-Path $root $directory) `
    -Destination (Join-Path $staging $directory) -Recurse
}

# Store packages use the extension ID assigned by Partner Center.
$manifest.PSObject.Properties.Remove("key")
$storeManifest = $manifest | ConvertTo-Json -Depth 10
Set-Content -LiteralPath (Join-Path $staging "manifest.json") `
  -Value $storeManifest -Encoding utf8

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open(
  $zipPath,
  [System.IO.Compression.ZipArchiveMode]::Create
)
try {
  $stagingPrefix = $staging.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar
  ) + [System.IO.Path]::DirectorySeparatorChar
  foreach ($file in Get-ChildItem -LiteralPath $staging -Recurse -File) {
    $entryName = $file.FullName.Substring($stagingPrefix.Length).Replace(
      [System.IO.Path]::DirectorySeparatorChar,
      "/"
    )
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $file.FullName,
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
}
finally {
  $archive.Dispose()
}

Write-Output $zipPath
