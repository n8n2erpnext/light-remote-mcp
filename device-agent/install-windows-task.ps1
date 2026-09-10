[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This installer must run on Windows.' }
$RootDir = Split-Path -Parent $PSScriptRoot
$StateFile = Join-Path $env:USERPROFILE '.config\gpt-operator-agent\device.json'
if (-not (Test-Path $StateFile)) { throw 'Device is not enrolled yet. Run operator-agent login first.' }
$BundledNode = Join-Path $RootDir 'runtime\node.exe'
if (-not (Test-Path $BundledNode)) { throw "Bundled Node runtime missing: $BundledNode" }
$AppDir = Join-Path $env:LOCALAPPDATA 'GPTOperatorAgent'
$AgentDir = Join-Path $AppDir 'device-agent'
$AdapterDir = Join-Path $AgentDir 'platform-adapters'
$LibDir = Join-Path $AppDir 'lib'
$RuntimeDir = Join-Path $AppDir 'runtime'
$NodeBin = Join-Path $RuntimeDir 'node.exe'
$AgentBin = Join-Path $AgentDir 'operator-agent.mjs'
$TaskName = 'GPTOperatorDeviceAgent'
$LegacyServiceName = 'GPTOperatorDeviceAgent'
$legacy = Get-Service -Name $LegacyServiceName -ErrorAction SilentlyContinue
if ($legacy) {
  if ($legacy.Status -ne 'Stopped') { Stop-Service -Name $LegacyServiceName -Force -ErrorAction SilentlyContinue }
  & sc.exe delete $LegacyServiceName | Out-Null
  Start-Sleep -Milliseconds 500
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $AgentDir,$AdapterDir,$LibDir,$RuntimeDir | Out-Null
Copy-Item (Join-Path $RootDir 'device-agent\operator-agent.mjs') $AgentBin -Force
Copy-Item (Join-Path $RootDir 'device-agent\platform-adapters\*.mjs') $AdapterDir -Force
Copy-Item (Join-Path $RootDir 'lib\device-proof.mjs') (Join-Path $LibDir 'device-proof.mjs') -Force
Copy-Item $BundledNode $NodeBin -Force
$StateDir = Split-Path -Parent $StateFile
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $StateDir /inheritance:r /grant:r "*$($userSid):(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict device-state ACL.' }
$LogDir = Join-Path $AppDir 'logs'
$Runner = Join-Path $AppDir 'run-device-agent.ps1'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
@'
$ErrorActionPreference = 'Continue'
$app = Join-Path $env:LOCALAPPDATA 'GPTOperatorAgent'
$node = Join-Path $app 'runtime\node.exe'
$agent = Join-Path $app 'device-agent\operator-agent.mjs'
$log = Join-Path $app 'logs\agent.log'
& $node $agent daemon *>> $log
exit $LASTEXITCODE
'@ | Set-Content -LiteralPath $Runner -Encoding UTF8
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Runner`"" -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Outbound GPT operator leaf agent for the signed-in user.' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2
$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
if ($task.State -ne 'Running') {
  $logTail = @()
  $logFile = Join-Path $LogDir 'agent.log'
  if (Test-Path $logFile) { $logTail = Get-Content $logFile -Tail 40 -ErrorAction SilentlyContinue }
  throw "Scheduled Task did not stay running. state=$($task.State) lastResult=$($info.LastTaskResult) log=$($logTail -join ' | ')"
}
Write-Host "Installed $TaskName as per-user Scheduled Task; state=$($task.State) user=$account" -ForegroundColor Green
Write-Host 'No Windows account password or PIN is required. The agent is online while this user is signed in.' -ForegroundColor Cyan
