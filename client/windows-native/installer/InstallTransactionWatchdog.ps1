param(
  [switch]$Register,
  [int]$InstallerPid=0,
  [string]$CommitMarker,
  [string]$TaskXml,
  [string]$VersionFile,
  [string]$InstallRoot,
  [string]$LogPath,
  [string]$TaskName='LightRemoteDeviceAgent',
  [string]$WatchdogTask='LightRemoteInstallWatchdog'
)
$ErrorActionPreference='Stop'
function Log([string]$m){try{("["+(Get-Date -Format o)+"] "+$m)|Add-Content -LiteralPath $LogPath -Encoding UTF8}catch{}}
function WallOk(){try{return (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5491/' -TimeoutSec 2).StatusCode -eq 200}catch{return $false}}
function WaitWall([int]$seconds){
  $d=(Get-Date).AddSeconds($seconds);$stable=0
  while((Get-Date)-lt$d){if(WallOk){$stable++}else{$stable=0};if($stable-ge2){return $true};Start-Sleep -Milliseconds 300}
  return $false
}
if($Register){
  try{
    $exe="$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
    $q={param($v) '"'+($v -replace '"','""')+'"'}
    $a="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "+(& $q $PSCommandPath)+
       " -InstallerPid $InstallerPid -CommitMarker "+(& $q $CommitMarker)+
       " -TaskXml "+(& $q $TaskXml)+" -VersionFile "+(& $q $VersionFile)+
       " -InstallRoot "+(& $q $InstallRoot)+" -LogPath "+(& $q $LogPath)+
       " -TaskName "+(& $q $TaskName)+" -WatchdogTask "+(& $q $WatchdogTask)
    Unregister-ScheduledTask -TaskName $WatchdogTask -Confirm:$false -ErrorAction SilentlyContinue
    $act=New-ScheduledTaskAction -Execute $exe -Argument $a
    $trg=New-ScheduledTaskTrigger -Once -At ((Get-Date).AddDays(1))
    $who=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    $pri=New-ScheduledTaskPrincipal -UserId $who -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $WatchdogTask -Action $act -Trigger $trg -Principal $pri -Force|Out-Null
    Start-ScheduledTask -TaskName $WatchdogTask
    Log "watchdog_registered installerPid=$InstallerPid"
    exit 0
  }catch{Log ("watchdog_register_failed "+$_.Exception.Message);exit 31}
}
$exitCode=0
try{
  Log "watchdog_started installerPid=$InstallerPid"
  $deadline=(Get-Date).AddMinutes(5)
  while((Get-Date)-lt$deadline){
    if(Test-Path $CommitMarker){Log 'commit_observed';return}
    if($InstallerPid-le0 -or -not(Get-Process -Id $InstallerPid -ErrorAction SilentlyContinue)){break}
    Start-Sleep -Milliseconds 250
  }
  if(Test-Path $CommitMarker){Log 'commit_observed_after_exit';return}
  Log 'recovery_begin'
  $rawVersion=if(Test-Path $VersionFile){Get-Content $VersionFile -Raw}else{$null}
  $version=if($null -eq $rawVersion){''}else{([string]$rawVersion).Trim()}
  $root=Join-Path $env:LOCALAPPDATA 'Light Remote\Updater\rollback'
  $rb=Get-ChildItem $root -Filter ("Light-Remote-MCP-Setup-"+$version+"*-x64.exe") -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if($rb){
    Log ("rollback_begin "+$rb.FullName)
    & "$env:WINDIR\System32\schtasks.exe" /End /TN $TaskName 2>$null|Out-Null
    $p=Start-Process $rb.FullName -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-' -PassThru -Wait
    Log ("rollback_exit "+$p.ExitCode)
  }else{
    Log ("rollback_missing version="+$version)
  }
  if(Test-Path $TaskXml){
    & "$env:WINDIR\System32\schtasks.exe" /Create /TN $TaskName /XML $TaskXml /F|Out-Null
  }
  & "$env:WINDIR\System32\schtasks.exe" /Run /TN $TaskName 2>$null|Out-Null
  if(WaitWall 20){Log 'rollback_restore_wall_healthy';return}
  throw 'rollback_restore_wall_failed'
}catch{Log ("watchdog_failed "+$_.Exception.Message);$exitCode=32}
finally{Unregister-ScheduledTask -TaskName $WatchdogTask -Confirm:$false -ErrorAction SilentlyContinue}
exit $exitCode
