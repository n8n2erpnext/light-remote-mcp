param([Parameter(Mandatory=$true)][string]$StageDir,
      [Parameter(Mandatory=$true)][string]$ProvenDir,
      [Parameter(Mandatory=$true)][string]$ProofFile)
$ErrorActionPreference='Stop'
$stage=[IO.Path]::GetFullPath($StageDir)
$proven=[IO.Path]::GetFullPath($ProvenDir)
$allowed=[IO.Path]::GetFullPath((Join-Path $PWD 'dist/windows'))+[IO.Path]::DirectorySeparatorChar
if(-not $stage.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -or
   -not $proven.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -or $stage -eq $proven){
    throw 'Primary staging paths must be separate owned build directories'
}
$proof=Get-Content -LiteralPath $ProofFile -Raw|ConvertFrom-Json
if($proof.result -ne 'PASS' -or $proof.sourceCommit -ne $env:GITHUB_SHA){throw 'Primary native proof is missing or belongs to another source'}
if((Get-Content -LiteralPath (Join-Path $stage 'VERSION') -Raw).Trim() -ne
   (Get-Content -LiteralPath (Join-Path $proven 'VERSION') -Raw).Trim()){throw 'Proven component version mismatch'}
foreach($old in @('GptOperator.Client.exe','desktop-v4/LightRemote.Desktop.exe')){
    $file=[IO.Path]::GetFullPath((Join-Path $stage $old))
    if(-not $file.StartsWith($stage+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Obsolete core target escaped stage'}
    Remove-Item -LiteralPath $file -Force
}
Copy-Item -LiteralPath (Join-Path $proven 'LightRemote.exe') -Destination (Join-Path $stage 'LightRemote.exe') -Force
Copy-Item -LiteralPath (Join-Path $proven 'windows-host') -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $proven 'config/core-layout.json') -Destination (Join-Path $stage 'config/core-layout.json') -Force
& (Join-Path $PSScriptRoot 'assert-primary-layout.ps1') -InstallRoot $stage -EvidenceFile (Join-Path $stage 'config/primary-executable-inventory.json')
