param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$srcRoot = Join-Path $RepoRoot 'src'
$distRoot = Join-Path $RepoRoot 'dist'

$importRegex = [regex]@'
(?ms)^\s*import\s*\{(?<spec>.*?)\}\s*from\s*['"](?<path>[^'"]+)['"];\s*
'@
$exportPrefixRegex = [regex]@'
(?m)^\s*export\s+(?=(async\s+function|function|const)\s+)
'@
$exportNameRegex = [regex]@'
(?m)^\s*export\s+(?:async\s+function|function|const)\s+(?<name>[A-Za-z0-9_$]+)
'@

function Get-ModuleId([string]$fullPath) {
  return [IO.Path]::GetRelativePath($srcRoot, $fullPath).Replace('\', '/')
}

function Convert-SpecList([string]$specText) {
  $parts = $specText -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $converted = foreach ($part in $parts) {
    if ($part -match '^(?<orig>[A-Za-z0-9_$]+)\s+as\s+(?<alias>[A-Za-z0-9_$]+)$') {
      "$($Matches.orig): $($Matches.alias)"
    } else {
      $part
    }
  }

  return ($converted -join ', ')
}

function Add-Module {
  param(
    [string]$FilePath,
    [hashtable]$Visited,
    [System.Collections.Generic.List[object]]$Ordered
  )

  $fullPath = [IO.Path]::GetFullPath($FilePath)
  if ($Visited.ContainsKey($fullPath)) {
    return
  }

  $Visited[$fullPath] = $true
  $source = Get-Content -Raw -Path $fullPath
  $importDecls = New-Object System.Collections.Generic.List[string]

  foreach ($match in $importRegex.Matches($source)) {
    $importPath = $match.Groups['path'].Value
    if (-not $importPath.StartsWith('.')) {
      continue
    }

    $resolved = [IO.Path]::GetFullPath([IO.Path]::Combine((Split-Path $fullPath -Parent), $importPath))
    Add-Module -FilePath $resolved -Visited $Visited -Ordered $Ordered

    $moduleId = Get-ModuleId $resolved
    $spec = Convert-SpecList $match.Groups['spec'].Value
    $importDecls.Add("const { $spec } = __modules['$moduleId'];") | Out-Null
  }

  $exportNames = foreach ($match in $exportNameRegex.Matches($source)) {
    $match.Groups['name'].Value
  }

  $source = $importRegex.Replace($source, '')
  $source = $exportPrefixRegex.Replace($source, '')
  $moduleId = Get-ModuleId $fullPath

  $moduleParts = New-Object System.Collections.Generic.List[string]
  foreach ($decl in $importDecls) {
    $moduleParts.Add($decl) | Out-Null
  }

  $trimmedSource = $source.Trim()
  if ($trimmedSource) {
    $moduleParts.Add($trimmedSource) | Out-Null
  }

  if ($exportNames.Count -gt 0) {
    $moduleParts.Add("Object.assign(__exports, { $($exportNames -join ', ') });") | Out-Null
  }

  $wrapped = @"
(function(__exports, __modules) {
$($moduleParts -join "`n`n")
})(__modules['$moduleId'] = __modules['$moduleId'] || {}, __modules);
"@

  $Ordered.Add([pscustomobject]@{
    Id = $moduleId
    Code = $wrapped.TrimEnd()
  }) | Out-Null
}

function Build-Bundle {
  param(
    [string]$EntryRelativePath,
    [string]$OutputRelativePath
  )

  $visited = @{}
  $ordered = New-Object 'System.Collections.Generic.List[object]'
  $entryFullPath = Join-Path $srcRoot $EntryRelativePath

  Add-Module -FilePath $entryFullPath -Visited $visited -Ordered $ordered

  $bundle = @"
(() => {
  const __modules = {};

$($ordered.Code -join "`n`n")
})();
"@

  $outputPath = Join-Path $distRoot $OutputRelativePath
  New-Item -ItemType Directory -Force -Path (Split-Path $outputPath -Parent) | Out-Null
  Set-Content -Path $outputPath -Value $bundle -Encoding UTF8
}

if (Test-Path $distRoot) {
  Remove-Item $distRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $distRoot -Force | Out-Null

Build-Bundle -EntryRelativePath 'content\main.js' -OutputRelativePath 'content\main.js'
Build-Bundle -EntryRelativePath 'background\service-worker.js' -OutputRelativePath 'background\service-worker.js'
Build-Bundle -EntryRelativePath 'popup\popup.js' -OutputRelativePath 'popup\popup.js'

Copy-Item (Join-Path $srcRoot 'manifest.json') (Join-Path $distRoot 'manifest.json') -Force
New-Item -ItemType Directory -Path (Join-Path $distRoot 'popup') -Force | Out-Null
Copy-Item (Join-Path $srcRoot 'popup\popup.html') (Join-Path $distRoot 'popup\popup.html') -Force
Copy-Item (Join-Path $srcRoot 'popup\popup.css') (Join-Path $distRoot 'popup\popup.css') -Force
Copy-Item (Join-Path $srcRoot 'styles') (Join-Path $distRoot 'styles') -Recurse -Force
Copy-Item (Join-Path $srcRoot 'icons') (Join-Path $distRoot 'icons') -Recurse -Force

Write-Host 'Fallback build complete -> dist/'
