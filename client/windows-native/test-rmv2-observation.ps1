param([Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true'){throw 'observation_test_actions_only'}
$fixture=Start-Process -FilePath $Exe -ArgumentList @('--observation-fixture-output',$Output) -PassThru -WindowStyle Hidden
if(-not $fixture.WaitForExit(60000)){$fixture.Kill();throw 'observation_fixture_timeout'}
if($fixture.ExitCode -ne 0){if(Test-Path $Output){Get-Content $Output -Raw|Write-Host};throw 'observation_fixture_failed'}
$receipt=Get-Content $Output -Raw|ConvertFrom-Json
if($receipt.result -ne 'PASS' -or -not $receipt.precisionPixelParity -or -not $receipt.backgroundCapture -or -not $receipt.backgroundDoesNotRenewLease -or -not $receipt.gpuResourcesDisposed -or $receipt.frames.Count -ne 3){throw 'observation_fixture_incomplete'}
node plugin-server/test-native-observation-image.mjs $Output
if($LASTEXITCODE -ne 0){throw 'observation_mcp_native_image_failed'}
Write-Host 'Agent GPU observation synthetic precision and MCP image delivery PASS; physical GPU/Agent host UAT still required.'
