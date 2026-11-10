param([Parameter(Mandatory=$true)][string]$InstallRoot,
      [Parameter(Mandatory=$true)][string]$UpdaterExe,
      [Parameter(Mandatory=$true)][string]$EvidenceDir)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($InstallRoot)
$exe=Join-Path $root 'LightRemote.exe'
$node=Join-Path $root 'runtime/node.exe'
New-Item -ItemType Directory -Force -Path $EvidenceDir|Out-Null
& (Join-Path $PSScriptRoot 'assert-primary-layout.ps1') -InstallRoot $root -EvidenceFile (Join-Path $EvidenceDir 'installed-inventory.json')
$task=Get-ScheduledTask -TaskName 'LightRemoteDeviceAgent' -ErrorAction Stop
$action=@($task.Actions)
if($action.Count -ne 1 -or [IO.Path]::GetFullPath($action[0].Execute) -ne $exe -or $action[0].Arguments -ne '--agent-host'){
    throw 'Primary scheduled task contract changed'
}
$run=Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Light Remote MCP'
if($run -ne ('"'+$exe+'" --background')){throw 'Primary autostart must use the same native executable in background mode'}
$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'Light Remote MCP/Light Remote.lnk'
$shell=New-Object -ComObject WScript.Shell
$link=$shell.CreateShortcut($shortcut)
if([IO.Path]::GetFullPath($link.TargetPath) -ne $exe){throw 'Start Menu shortcut targets another primary executable'}
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class LRPrimaryWindow {
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int command);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr wParam,IntPtr lParam,uint flags,uint timeout,out IntPtr result);
}
'@
function Start-Core([string[]]$Arguments){
    $psi=[Diagnostics.ProcessStartInfo]::new($exe);$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    $psi.Environment['DOTNET_ROOT']='Z:\not-a-runtime'
    $psi.Environment['DOTNET_ROOT_X64']='Z:\not-a-runtime'
    foreach($arg in $Arguments){$psi.ArgumentList.Add($arg)}
    return [Diagnostics.Process]::Start($psi)
}
$gui=Start-Core @()
try{
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    do{$gui.Refresh();if($gui.HasExited){throw 'Primary GUI exited unexpectedly'};if($gui.MainWindowHandle -ne 0){break};Start-Sleep -Milliseconds 150}while([DateTime]::UtcNow -lt $deadline)
    $window=$gui.MainWindowHandle
    if($window -eq 0){throw 'Primary native GUI window did not appear'}
    $runtime=[IO.Path]::GetFullPath((Join-Path $root 'windows-host/runtime'))+[IO.Path]::DirectorySeparatorChar
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    do{
        $gui.Refresh()
        $privateClr=@($gui.Modules|Where-Object{$_.ModuleName -eq 'coreclr.dll' -and $_.FileName.StartsWith($runtime,[StringComparison]::OrdinalIgnoreCase)})
        if($privateClr){break}
        Start-Sleep -Milliseconds 150
    }while([DateTime]::UtcNow -lt $deadline)
    if(-not $privateClr){throw 'Installed GUI did not host its packaged CLR in-process'}
    [void][LRPrimaryWindow]::ShowWindow($window,0)
    $background=Start-Core @('--background')
    try{
        if(-not $background.WaitForExit(10000) -or $background.ExitCode -ne 0){throw 'Background singleton relaunch did not return'}
        if([LRPrimaryWindow]::IsWindowVisible($window)){throw 'Background restart raised a hidden GUI'}
    }finally{if(-not $background.HasExited){$background.Kill($true)};$background.Dispose()}
    $before=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'"|Where-Object{$_.ExecutablePath -eq $node -and $_.CommandLine -match 'operator-agent\.mjs.*daemon'}|ForEach-Object{[int]$_.ProcessId})
    if(-not $before){throw 'Installed primary Agent daemon is missing'}
    $psi=[Diagnostics.ProcessStartInfo]::new($UpdaterExe);$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    foreach($arg in @('--restart-agent-only','--install-dir',$root)){$psi.ArgumentList.Add($arg)}
    $restart=[Diagnostics.Process]::Start($psi)
    try{
        if(-not $restart.WaitForExit(70000)){ $restart.Kill($true);throw 'Primary Agent restart transaction timed out' }
        if($restart.ExitCode -ne 0){throw "Primary Agent restart failed: $($restart.ExitCode)"}
    }finally{$restart.Dispose()}
    $gui.Refresh()
    if($gui.HasExited -or [LRPrimaryWindow]::IsWindowVisible($window)){throw 'Agent restart closed or raised the hidden native GUI'}
    if((Get-ScheduledTask 'LightRemoteDeviceAgent').State -ne 'Running'){throw 'Agent task did not recover after primary restart'}
    foreach($id in $before){if(Get-Process -Id $id -ErrorAction SilentlyContinue){throw 'Old daemon survived Agent restart'}}
    if((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5491/' -TimeoutSec 5).StatusCode -ne 200){throw 'Wall did not recover after primary restart'}
    $currentDaemon=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'"|Where-Object{$_.ExecutablePath -eq $node -and $_.CommandLine -match 'operator-agent\.mjs.*daemon'}|ForEach-Object{[int]$_.ProcessId})
    $startPsi=[Diagnostics.ProcessStartInfo]::new($exe);$startPsi.UseShellExecute=$false;$startPsi.CreateNoWindow=$true;$startPsi.RedirectStandardOutput=$true
    $startPsi.ArgumentList.Add('--desktop-bridge');$startPsi.ArgumentList.Add('service-start')
    $explicitStart=[Diagnostics.Process]::Start($startPsi)
    try{
        if(-not $explicitStart.WaitForExit(20000)){throw 'Explicit Start request timed out'}
        $startResult=$explicitStart.StandardOutput.ReadToEnd()|ConvertFrom-Json
        if($explicitStart.ExitCode -ne 0 -or $startResult.ok -ne $true -or $startResult.state -ne 'already_running'){throw 'Explicit Start must retain an already running Agent'}
    }finally{if(-not $explicitStart.HasExited){$explicitStart.Kill($true)};$explicitStart.Dispose()}
    foreach($daemonId in $currentDaemon){if(-not (Get-Process -Id $daemonId -ErrorAction SilentlyContinue)){throw 'Explicit Start stopped or replaced the running Agent'}}
    $open=Start-Core @()
    try{if(-not $open.WaitForExit(10000)){throw 'Shortcut relaunch singleton did not return'}}finally{if(-not $open.HasExited){$open.Kill($true)};$open.Dispose()}
    if(-not [LRPrimaryWindow]::IsWindowVisible($window)){throw 'Shortcut relaunch did not restore the existing native window'}
    # Exercise the actual close event repeatedly while native status/Owner
    # restore polling is active. It must hide the window, retain the same GUI
    # PID and never stop the background Agent/session lifetime.
    $closeEvidence=[Collections.Generic.List[object]]::new()
    $closeCycle=0
    foreach($closeDelay in @(0,600,1200)){
        Start-Sleep -Milliseconds $closeDelay
        if(-not [LRPrimaryWindow]::PostMessage($window,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Could not post native Close'}
        $closeDeadline=[DateTime]::UtcNow.AddSeconds(3)
        while([LRPrimaryWindow]::IsWindowVisible($window) -and [DateTime]::UtcNow -lt $closeDeadline){Start-Sleep -Milliseconds 50}
        $gui.Refresh()
        $isVisible=[LRPrimaryWindow]::IsWindowVisible($window)
        $pong=[IntPtr]::Zero
        $responsive= -not $gui.HasExited -and [LRPrimaryWindow]::SendMessageTimeout($window,0,[IntPtr]::Zero,[IntPtr]::Zero,2,500,[ref]$pong) -ne [IntPtr]::Zero
        $closeEvidence.Add([ordered]@{cycle=$closeCycle;guiExited=$gui.HasExited;windowVisible=$isVisible;uiResponsive=$responsive;deadlineMs=3000})
        [ordered]@{sourceCommit=$env:GITHUB_SHA;cycles=@($closeEvidence.ToArray());physicalOwnerAcceptance=$false}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $EvidenceDir 'native-close.json') -Encoding utf8NoBOM
        Write-Host ('WINDOWS_NATIVE_CLOSE_CYCLE='+($closeEvidence[$closeCycle]|ConvertTo-Json -Compress))
        if($gui.HasExited -or $isVisible -or -not $responsive){throw 'Native X failed to hide responsive Desktop'}
        $closeCycle++
        foreach($daemonId in $currentDaemon){if(-not (Get-Process -Id $daemonId -ErrorAction SilentlyContinue)){throw 'Closing Desktop stopped its background Agent'}}
        $again=Start-Core @()
        try{if(-not $again.WaitForExit(10000) -or $again.ExitCode -ne 0){throw 'Close/reopen singleton failed'}}finally{if(-not $again.HasExited){$again.Kill($true)};$again.Dispose()}
        if(-not [LRPrimaryWindow]::IsWindowVisible($window)){throw 'Close/reopen failed to restore the same window'}
    }
    $conptyProof=Join-Path $PSScriptRoot '../../deploy/scripts/selftest-wall-conpty-roundtrip.mjs'
    & $node $conptyProof --install-root $root --evidence (Join-Path $EvidenceDir 'real-conpty-wall.json')
    if($LASTEXITCODE -ne 0){throw 'Real packaged ConPTY to Local Wall output proof failed'}
    [ordered]@{result='PASS';sourceCommit=$env:GITHUB_SHA;ciRunId=$env:GITHUB_RUN_ID
        checks=@('one-primary-layout','same-native-exe-task','same-native-exe-autostart-shortcut','private-clr-loaded-in-gui-with-global-dotnet-disabled',
        'background-preserves-hidden-window','agent-only-restart-preserves-gui-and-hidden-state',
        'old-daemon-exit-new-wall-health','explicit-start-is-idempotent-preserves-running-agent','shortcut-restores-existing-window','native-close-reopen-three-cycles-retains-agent','real-conpty-local-wall-output')
        physicalOwnerAcceptance=$false}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $EvidenceDir 'installed-lifecycle.json') -Encoding utf8NoBOM
    Write-Host 'WINDOWS_PRIMARY_INSTALLED_GUI_AGENT_RESTART=PASS'
}finally{
    if(-not $gui.HasExited){$gui.Kill($false);$gui.WaitForExit(5000)|Out-Null};$gui.Dispose()
}
