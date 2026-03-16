param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId,

  [string]$HostName = 'com.gfdl.folderops'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$hostSource = Join-Path $repoRoot 'native-host'
$generatedDir = Join-Path $hostSource 'generated'
$manifestPath = Join-Path $generatedDir "$HostName.json"
$launcherPath = Join-Path $generatedDir "$HostName.cmd"

New-Item -ItemType Directory -Force -Path $generatedDir | Out-Null

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = 'C:\Program Files\nodejs\node.exe'
}

if (-not (Test-Path $node)) {
  throw "node.exe not found. Install Node.js or update the script."
}

$hostScript = Join-Path $hostSource 'host.js'
if (-not (Test-Path $hostScript)) {
  throw "Native host script not found: $hostScript"
}

$launcherContent = @"
@echo off
"$node" "$hostScript"
"@
Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII

$manifest = @{
  name = $HostName
  description = 'GitHub Folder Downloader native host'
  path = $launcherPath
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 3

Set-Content -Path $manifestPath -Value $manifest -Encoding ASCII

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath

Write-Host "Installed native host '$HostName' for extension $ExtensionId"
Write-Host "Manifest: $manifestPath"
Write-Host "Launcher: $launcherPath"
