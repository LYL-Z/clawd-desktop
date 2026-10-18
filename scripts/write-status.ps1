param([ValidateSet('idle','thinking','working','waiting','done','failed')][string]$State='working',[string]$Detail='',[string]$StatusPath=(Join-Path $env:APPDATA 'Clawd\status.json'))
$ErrorActionPreference='Stop'
$statusFile=[IO.Path]::GetFullPath($StatusPath)
New-Item -ItemType Directory -Path (Split-Path -Parent $statusFile) -Force | Out-Null
$record=@{schemaVersion=1;eventId=[guid]::NewGuid().ToString();state=$State;updatedAt=(Get-Date).ToString('o');ttlMs=30000;detail=$Detail}
$record | ConvertTo-Json -Compress | Set-Content -LiteralPath ($statusFile+'.tmp') -Encoding utf8
Move-Item -LiteralPath ($statusFile+'.tmp') -Destination $statusFile -Force
Write-Output "State written: $statusFile"
