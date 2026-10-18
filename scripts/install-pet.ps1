param([switch]$Enable)
$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$sourcePath = Join-Path $workspacePath 'dist\pet-v2'
foreach ($name in @('pet.json','spritesheet.webp')) { if (!(Test-Path -LiteralPath (Join-Path $sourcePath $name))) { throw "Missing accepted pet file: $name" } }
$acceptancePath = Join-Path $sourcePath 'acceptance.json'
if (!(Test-Path -LiteralPath $acceptancePath)) { throw 'Final pet acceptance report is missing. Do not install a draft.' }
$acceptance = Get-Content -LiteralPath $acceptancePath -Raw -Encoding utf8 | ConvertFrom-Json
$atlasHash = (Get-FileHash -LiteralPath (Join-Path $sourcePath 'spritesheet.webp') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($acceptance.atlasValidationOk -ne $true -or $acceptance.petQualityOk -ne $true -or $acceptance.blindDirectionsOk -ne $true -or $acceptance.atlasSha256 -ne $atlasHash) { throw 'Final pet gates or atlas hash do not match. Installation cancelled.' }
$codexBase = if ($env:CODEX_HOME) { [IO.Path]::GetFullPath($env:CODEX_HOME) } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
$petsBase = [IO.Path]::GetFullPath((Join-Path $codexBase 'pets'))
$targetPath = [IO.Path]::GetFullPath((Join-Path $petsBase 'clawd'))
if ((Split-Path -Parent $targetPath) -ne $petsBase) { throw 'Install target is outside the Pets directory.' }
New-Item -ItemType Directory -Path $petsBase -Force | Out-Null
$backupPath = $null
$stagePath = [IO.Path]::GetFullPath((Join-Path $petsBase ('clawd-staging-' + [guid]::NewGuid().ToString('N'))))
if ((Split-Path -Parent $stagePath) -ne $petsBase) { throw 'Staging target is outside the Pets directory.' }
try {
  New-Item -ItemType Directory -Path $stagePath | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourcePath 'pet.json'),(Join-Path $sourcePath 'spritesheet.webp') -Destination $stagePath
  foreach ($name in @('pet.json','spritesheet.webp')) {
    if ((Get-FileHash -LiteralPath (Join-Path $stagePath $name) -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $sourcePath $name) -Algorithm SHA256).Hash) { throw "Staged copy hash mismatch: $name" }
  }
  if (Test-Path -LiteralPath $targetPath) {
    $backupPath = [IO.Path]::GetFullPath((Join-Path $petsBase ('clawd-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))))
    if ((Split-Path -Parent $backupPath) -ne $petsBase) { throw 'Backup target is outside the Pets directory.' }
    Move-Item -LiteralPath $targetPath -Destination $backupPath
  }
  Move-Item -LiteralPath $stagePath -Destination $targetPath
} catch {
  # stagePath was resolved and checked to be a direct child of petsBase above.
  if (Test-Path -LiteralPath $stagePath) { Remove-Item -LiteralPath $stagePath -Recurse -Force }
  if ($backupPath -and !(Test-Path -LiteralPath $targetPath)) {
    Move-Item -LiteralPath $backupPath -Destination $targetPath
  }
  throw
}
$record = @{ target = $targetPath; backup = $backupPath; installedAt = (Get-Date).ToString('o') }
$recordPath = Join-Path $workspacePath 'qa\pet-install.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $recordPath) -Force | Out-Null
$record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8
Write-Output "Pet installed at: $targetPath"
if ($backupPath) { Write-Output "Previous files preserved at: $backupPath" }
Write-Output 'Choose Clawd in the current Codex Pets settings to activate it. No existing pet was selected or disabled.'
if ($Enable) { Write-Output 'This script only installs local files; selection must use the supported app UI.' }
