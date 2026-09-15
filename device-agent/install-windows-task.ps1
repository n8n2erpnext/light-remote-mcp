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
$startDeadline=(Get-Date).AddSeconds(10)
do {
  Start-Sleep -Milliseconds 250
  $task=Get-ScheduledTask -TaskName $AgentTask -ErrorAction Stop
  if($task.State -eq 'Running'){break}
} while((Get-Date)-lt $startDeadline)
if($task.State -ne 'Running'){
  $taskInfo=Get-ScheduledTaskInfo -TaskName $AgentTask -ErrorAction SilentlyContinue
  throw "Light Remote background task failed to stay running: state=$($task.State) result=$($taskInfo.LastTaskResult)"
}
Write-Host "Light Remote background task installed: $($task.State) user=$account"
Write-Host "Independent updater task installed: $Updater"
Write-Host 'Tray may exit independently; this background task remains running while the user is signed in.'
