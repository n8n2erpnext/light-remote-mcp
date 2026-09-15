[CmdletBinding()]
param([string]$InstallRoot)
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'This installer must run on Windows.'}
if([string]::IsNullOrWhiteSpace($InstallRoot)){$InstallRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path}
$Node=Join-Path $InstallRoot 'runtime\node.exe';$Agent=Join-Path $InstallRoot 'agent\device-agent\operator-agent.mjs';$Tray=Join-Path $InstallRoot 'GptOperator.Client.exe'
$UpdaterRoot=Join-Path $env:LOCALAPPDATA 'Light Remote\Updater';$Updater=Join-Path $UpdaterRoot 'LightRemote.Updater.exe';$UpdaterKey=Join-Path $UpdaterRoot 'config\client-update-public.pem'
$AgentTask='LightRemoteDeviceAgent';$UpdateTask='LightRemoteUpdater';$Legacy='GPTOperatorDeviceAgent';$account=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$HelperCandidate=Join-Path $InstallRoot 'helper-candidate'
if(-not(Test-Path $Updater)){
  $CandidateUpdater=Join-Path $HelperCandidate 'LightRemote.Updater.exe';$CandidateKey=Join-Path $HelperCandidate 'config\client-update-public.pem'
  foreach($f in @($CandidateUpdater,$CandidateKey)){if(-not(Test-Path $f)){throw "Required updater bootstrap file missing: $f"}}
  New-Item -ItemType Directory -Force -Path $UpdaterRoot|Out-Null;Copy-Item (Join-Path $HelperCandidate '*') $UpdaterRoot -Recurse -Force
}
foreach($f in @($Node,$Agent,$Tray,$Updater,$UpdaterKey)){if(-not(Test-Path $f)){throw "Required Light Remote file missing: $f"}}
foreach($taskName in @($Legacy,$AgentTask,$UpdateTask)){
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
}
$nodeFull=[IO.Path]::GetFullPath($Node)
$staleNodes=@(Get-Process -Name node -ErrorAction SilentlyContinue|Where-Object{try{[IO.Path]::GetFullPath($_.Path) -eq $nodeFull}catch{$false}})
if($staleNodes){
  $staleNodes|Stop-Process -Force -ErrorAction SilentlyContinue
  foreach($staleId in @($staleNodes.Id)){Wait-Process -Id $staleId -Timeout 10 -ErrorAction SilentlyContinue}
}
$remainingNodes=@(Get-Process -Name node -ErrorAction SilentlyContinue|Where-Object{try{[IO.Path]::GetFullPath($_.Path) -eq $nodeFull}catch{$false}})
if($remainingNodes){throw "Stale Light Remote Node runtime survived task cleanup: $nodeFull"}
$agentAction=New-ScheduledTaskAction -Execute $Tray -Argument '--agent-host' -WorkingDirectory $InstallRoot
$agentTrigger=New-ScheduledTaskTrigger -AtLogOn -User $account
$principal=New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $AgentTask -Action $agentAction -Trigger $agentTrigger -Principal $principal -Settings $settings -Description 'Light Remote always-alive per-user background agent and Local Wall.' -Force|Out-Null
$updaterArgs='--scheduled-update --install-dir "'+$InstallRoot+'"'
$updaterAction=New-ScheduledTaskAction -Execute $Updater -Argument $updaterArgs -WorkingDirectory $UpdaterRoot
$first=(Get-Date).AddMinutes(5);$updaterTrigger=New-ScheduledTaskTrigger -Once -At $first -RepetitionInterval (New-TimeSpan -Hours 6)
Register-ScheduledTask -TaskName $UpdateTask -Action $updaterAction -Trigger $updaterTrigger -Principal $principal -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew) -Description 'Light Remote independent signed recovery updater.' -Force|Out-Null
Start-ScheduledTask -TaskName $AgentTask
$startDeadline=(Get-Date).AddSeconds(10);$stableSince=$null
while((Get-Date)-lt $startDeadline){
  Start-Sleep -Milliseconds 250
  $task=Get-ScheduledTask -TaskName $AgentTask -ErrorAction Stop
  if($task.State -eq 'Running'){
    if($null -eq $stableSince){$stableSince=Get-Date}
    if(((Get-Date)-$stableSince).TotalSeconds -ge 2){break}
  } else {$stableSince=$null}
}
if($task.State -ne 'Running' -or $null -eq $stableSince -or ((Get-Date)-$stableSince).TotalSeconds -lt 2){
  $taskInfo=Get-ScheduledTaskInfo -TaskName $AgentTask -ErrorAction SilentlyContinue
  throw "Light Remote background task failed stable-start gate: state=$($task.State) result=$($taskInfo.LastTaskResult)"
}
function Compare-LightRemoteVersion([string]$A,[string]$B){
  $re='^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$';$ma=[regex]::Match($A,$re);$mb=[regex]::Match($B,$re);if(-not $ma.Success -or -not $mb.Success){return $null}
  foreach($i in 1..3){$av=[int]$ma.Groups[$i].Value;$bv=[int]$mb.Groups[$i].Value;if($av -gt $bv){return 1};if($av -lt $bv){return -1}}
  $ap=$ma.Groups[4].Value;$bp=$mb.Groups[4].Value;if(-not $ap -and -not $bp){return 0};if(-not $ap){return 1};if(-not $bp){return -1}
  $aa=$ap.Split('.');$ba=$bp.Split('.');$n=[Math]::Max($aa.Length,$ba.Length);for($i=0;$i -lt $n;$i++){if($i -ge $aa.Length){return -1};if($i -ge $ba.Length){return 1};$an=0;$bn=0;$ai=[int]::TryParse($aa[$i],[ref]$an);$bi=[int]::TryParse($ba[$i],[ref]$bn);if($ai -and $bi){if($an -gt $bn){return 1};if($an -lt $bn){return -1}}elseif($ai -ne $bi){if($ai){return -1}else{return 1}}elseif($aa[$i] -ne $ba[$i]){return [Math]::Sign([string]::CompareOrdinal($aa[$i],$ba[$i]))}}
  return 0
}
$TransactionFile=Join-Path $UpdaterRoot 'state\transaction.json'
$CandidateUpdater=Join-Path $HelperCandidate 'LightRemote.Updater.exe';$CandidateVersionFile=Join-Path $HelperCandidate 'VERSION';$HelperVersionFile=Join-Path $UpdaterRoot 'VERSION'
if((Test-Path $CandidateUpdater)-and(Test-Path $CandidateVersionFile)-and(-not(Test-Path $TransactionFile))){
  $candidateVersion=(Get-Content $CandidateVersionFile -Raw).Trim();$helperVersion=if(Test-Path $HelperVersionFile){(Get-Content $HelperVersionFile -Raw).Trim()}else{''};$versionCmp=if($helperVersion){Compare-LightRemoteVersion $helperVersion $candidateVersion}else{$null}
  $candidateHash=(Get-FileHash $CandidateUpdater -Algorithm SHA256).Hash;$helperHash=if(Test-Path $Updater){(Get-FileHash $Updater -Algorithm SHA256).Hash}else{''}
  $helperNewer=($null -ne $versionCmp -and $versionCmp -gt 0)
  if(-not $helperNewer -and (($candidateVersion -ne $helperVersion)-or($candidateHash -ne $helperHash))){
    $stage=Join-Path $UpdaterRoot ('cache\helper-manual-'+[guid]::NewGuid().ToString('N'));$health=Join-Path $UpdaterRoot ('cache\helper-health-'+[guid]::NewGuid().ToString('N')+'.json')
    New-Item -ItemType Directory -Force -Path $stage|Out-Null;Copy-Item (Join-Path $HelperCandidate '*') $stage -Recurse -Force
    $stageUpdater=Join-Path $stage 'LightRemote.Updater.exe';& $stageUpdater --self-test-output $health $InstallRoot
    if($LASTEXITCODE -ne 0 -or -not(Test-Path $health)){Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue;throw 'Independent updater candidate self-test failed after Core health gate.'}
    $healthState=Get-Content $health -Raw|ConvertFrom-Json;if(-not $healthState.ok){Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue;Remove-Item $health -Force -ErrorAction SilentlyContinue;throw 'Independent updater candidate health result rejected.'}
    Stop-ScheduledTask -TaskName $UpdateTask -ErrorAction SilentlyContinue;Copy-Item (Join-Path $stage '*') $UpdaterRoot -Recurse -Force
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue;Remove-Item $health -Force -ErrorAction SilentlyContinue
    $helperVersion=$candidateVersion;Write-Host "Independent updater reconciled after Core health: $helperVersion -> $candidateVersion"
  }
  $actualHelperVersion=if(Test-Path $HelperVersionFile){(Get-Content $HelperVersionFile -Raw).Trim()}else{$helperVersion};$currentVersion=(Get-Content (Join-Path $InstallRoot 'VERSION') -Raw).Trim();$statusDir=Join-Path $UpdaterRoot 'state';New-Item -ItemType Directory -Force -Path $statusDir|Out-Null
  [ordered]@{state='idle';currentVersion=$currentVersion;targetVersion=$null;helperVersion=$actualHelperVersion;code=$null;updatedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}|ConvertTo-Json -Compress|Set-Content (Join-Path $statusDir 'status.json') -Encoding UTF8
}
Write-Host "Light Remote background task installed: $($task.State) user=$account"
Write-Host "Independent updater task installed: $Updater"
Write-Host 'Tray may exit independently; this background task remains running while the user is signed in.'
