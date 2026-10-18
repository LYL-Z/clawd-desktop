param([Parameter(Mandatory=$true)][string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
$codexBase = if ($env:CODEX_HOME) { [IO.Path]::GetFullPath($env:CODEX_HOME) } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
$petsBase = [IO.Path]::GetFullPath((Join-Path $codexBase 'pets'))
$backupPath = [IO.Path]::GetFullPath($BackupDirectory)
$targetPath = [IO.Path]::GetFullPath((Join-Path $petsBase 'clawd'))
if ((Split-Path -Parent $backupPath) -ne $petsBase -or (Split-Path -Leaf $backupPath) -notlike 'clawd-backup-*') { throw 'Backup must be a clawd-backup-* folder directly under the configured Pets directory.' }
if (!(Test-Path -LiteralPath (Join-Path $backupPath 'pet.json'))) { throw 'The specified backup does not contain pet.json.' }
if (Test-Path -LiteralPath $targetPath) {
  $preservedPath = Join-Path $petsBase ('clawd-before-restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
  Move-Item -LiteralPath $targetPath -Destination $preservedPath
  Write-Output "Current files preserved at: $preservedPath"
}
Copy-Item -LiteralPath $backupPath -Destination $targetPath -Recurse
Write-Output "Restored local pet files to: $targetPath"
