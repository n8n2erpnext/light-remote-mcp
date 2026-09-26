param(
  [Parameter(Mandatory=$true)][string]$StageDir,
  [Parameter(Mandatory=$true)][string]$OutputDir,
  [Parameter(Mandatory=$true)][string]$AppVersion,
  [Parameter(Mandatory=$true)][string]$Iscc
)
$ErrorActionPreference='Stop'
$NodeVersion='22.23.2'
$NodeZip="node-v$NodeVersion-win-x64.zip"
$NodeFolder="node-v$NodeVersion-win-x64"
$NodeUrl="https://nodejs.org/dist/v$NodeVersion/$NodeZip"
$NodeZipSha='1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97'
$CompactStage=Join-Path (Split-Path $StageDir -Parent) 'stage-compact'
if(Test-Path $CompactStage){Remove-Item $CompactStage -Recurse -Force}
New-Item -ItemType Directory -Force -Path $CompactStage | Out-Null
Copy-Item (Join-Path $StageDir '*') $CompactStage -Recurse -Force
$BundledNode=Join-Path $CompactStage 'runtime\node.exe'
if(-not(Test-Path $BundledNode)){throw 'full stage Node runtime missing'}
$FullStageBytes=(Get-ChildItem $StageDir -File -Recurse|Measure-Object Length -Sum).Sum
$NodeBytes=(Get-Item $BundledNode).Length
Remove-Item $BundledNode -Force
$CompactStageBytes=(Get-ChildItem $CompactStage -File -Recurse|Measure-Object Length -Sum).Sum
if(Test-Path $BundledNode){throw 'compact stage still contains bundled Node runtime'}New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$Iss=Join-Path $PSScriptRoot 'GptOperator.iss'
$Args=@(
  "/DStageDir=$CompactStage",
  "/DOutputDir=$OutputDir",
  "/DAppVersion=$AppVersion",
  '/DOutputBaseName=Light-Remote-Compact-Setup-x64',
  '/DCompactNodeBootstrap=1',
  "/DNodeZipName=$NodeZip",
  "/DNodeFolder=$NodeFolder",
  "/DNodeUrl=$NodeUrl",
  "/DNodeZipSha=$NodeZipSha",
  $Iss
)
& $Iscc @Args
if($LASTEXITCODE -ne 0){throw 'Compact Inno Setup build failed'}
$Installer=Join-Path $OutputDir 'Light-Remote-Compact-Setup-x64.exe'
if(-not(Test-Path $Installer)){throw "compact installer missing: $Installer"}
$InstallerBytes=(Get-Item $Installer).Length
Write-Host "windows-compact-stage-bytes=$CompactStageBytes full-stage-bytes=$FullStageBytes removed-node-bytes=$NodeBytes"
Write-Host "windows-size-compact-installer-bytes=$InstallerBytes"
Write-Output $Installer