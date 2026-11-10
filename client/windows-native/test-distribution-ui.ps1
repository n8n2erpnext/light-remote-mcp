param([Parameter(Mandatory=$true)][ValidateSet('Install','Uninstall')][string]$Mode,
      [Parameter(Mandatory=$true)][string]$Installer,
      [Parameter(Mandatory=$true)][string]$InstallRoot,
      [Parameter(Mandatory=$true)][string]$EvidenceDir,
      [string]$SetupLog)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true'){throw 'Interactive distribution proof runs only on an isolated GitHub Windows runner'}
$root=[IO.Path]::GetFullPath($InstallRoot)
$temp=[IO.Path]::GetFullPath($env:RUNNER_TEMP)+[IO.Path]::DirectorySeparatorChar
if(-not $root.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)){throw 'UI fixture install root escaped RUNNER_TEMP'}
$evidence=[IO.Path]::GetFullPath($EvidenceDir)
New-Item -ItemType Directory -Force -Path $evidence|Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public static class LRSetupUi {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p,IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h,EnumProc p,IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 public static IntPtr[] Windows(){var a=new List<IntPtr>();EnumWindows((h,p)=>{if(IsWindowVisible(h))a.Add(h);return true;},IntPtr.Zero);return a.ToArray();}
 public static IntPtr[] Children(IntPtr root){var a=new List<IntPtr>();EnumChildWindows(root,(h,p)=>{if(IsWindowVisible(h))a.Add(h);return true;},IntPtr.Zero);return a.ToArray();}
 public static string Text(IntPtr h){var s=new StringBuilder(4096);GetWindowText(h,s,s.Capacity);return s.ToString();}
 public static string Class(IntPtr h){var s=new StringBuilder(256);GetClassName(h,s,s.Capacity);return s.ToString();}
}
'@
$script:owned=[Collections.Generic.HashSet[uint32]]::new()
function Start-Setup([string]$File,[string[]]$Arguments){
    $p=Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    [void]$script:owned.Add([uint32]$p.Id)
    # Inno bootstrap owns a temporary setup/uninstall child. Keep only this
    # process tree; never match or terminate another installed application.
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    do{
        foreach($row in @(Get-CimInstance Win32_Process)){
            if($script:owned.Contains([uint32]$row.ParentProcessId)){[void]$script:owned.Add([uint32]$row.ProcessId)}
        }
        if($script:owned.Count -gt 1){break}
        Start-Sleep -Milliseconds 100
    }while([DateTime]::UtcNow -lt $deadline)
    return $p
}
function Wait-View([string]$Prefix,[int]$Seconds=120){
    $deadline=[DateTime]::UtcNow.AddSeconds($Seconds)
    $discover=[DateTime]::MinValue
    do{
        if([DateTime]::UtcNow -gt $discover){
            foreach($row in @(Get-CimInstance Win32_Process)){
                if($script:owned.Contains([uint32]$row.ParentProcessId)){[void]$script:owned.Add([uint32]$row.ProcessId)}
            }
            $discover=[DateTime]::UtcNow.AddSeconds(1)
        }
        foreach($h in [LRSetupUi]::Windows()){
            [uint32]$id=0;[void][LRSetupUi]::GetWindowThreadProcessId($h,[ref]$id)
            if(-not $script:owned.Contains($id)){continue}
            foreach($child in [LRSetupUi]::Children($h)){
                if([LRSetupUi]::Text($child).StartsWith($Prefix,[StringComparison]::Ordinal)){
                    return [pscustomobject]@{window=$h;title=$child;text=[LRSetupUi]::Text($child)}
                }
            }
        }
        Start-Sleep -Milliseconds 50
    }while([DateTime]::UtcNow -lt $deadline)
    throw "Native distribution view did not appear: $Prefix"
}
function Find-Control($View,[string]$Caption){
    $matches=@([LRSetupUi]::Children($View.window)|Where-Object{[LRSetupUi]::Text($_) -eq $Caption -and [LRSetupUi]::Class($_) -match 'Button|CheckBox'})
    if($matches.Count -ne 1){throw "Expected exactly one visible native control: $Caption ($($matches.Count))"}
    return $matches[0]
}
function Invoke-Button($View,[string]$Caption){
    $h=Find-Control $View $Caption
    if(-not [LRSetupUi]::PostMessage($h,0xF5,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Native button message failed'} # BM_CLICK, native handler
}
function Capture-View($View,[string]$Name){
    # In-process GetTextFace uses the title's actual TFont. Cross-process
    # HFONT selection is invalid on Windows and only observes a default DC.
    $fontLine=Get-Content -LiteralPath $script:nativeLog|Where-Object{$_ -match 'light-remote-title-font='}|Select-Object -Last 1
    $face=if($fontLine -match 'light-remote-title-font=([^;]+);width=([1-9][0-9]*)'){$Matches[1]}else{'unresolved'}
    $rect=[LRSetupUi+RECT]::new();[void][LRSetupUi]::GetWindowRect($View.window,[ref]$rect)
    $secondText=@{'01-welcome'='on this PC.';'02-installing'="what's next.";'03-ready'='you are.';
        '04-uninstall-confirm'='Keep your work.';'05-removing'='in good order.';'06-removed'='is uninstalled.'}[$Name]
    $second=@([LRSetupUi]::Children($View.window)|Where-Object{[LRSetupUi]::Text($_) -eq $secondText})
    if($second.Count -ne 1){throw "Second title line must be visible: $secondText"}
    $secondRect=[LRSetupUi+RECT]::new();[void][LRSetupUi]::GetWindowRect($second[0],[ref]$secondRect)
    if($rect.Right-$rect.Left -lt 500 -or $rect.Bottom-$rect.Top -lt 350){throw 'Distribution window unexpectedly small'}
    $b=[Drawing.Bitmap]::new($rect.Right-$rect.Left,$rect.Bottom-$rect.Top)
    try{
        $g=[Drawing.Graphics]::FromImage($b);$dc=$g.GetHdc()
        try{if(-not [LRSetupUi]::PrintWindow($View.window,$dc,0)){throw 'Native wizard could not render'}}finally{$g.ReleaseHdc($dc);$g.Dispose()}
        $gold=0;$card=0;$secondInk=0;$lastSecondInk=-1
        for($y=0;$y -lt $b.Height;$y+=3){for($x=0;$x -lt $b.Width;$x+=3){
            $c=$b.GetPixel($x,$y)
            if($c.R -gt 170 -and $c.G -gt 130 -and $c.B -lt 70){$gold++}
            if([Math]::Abs([int]$c.R-246) -le 1 -and [Math]::Abs([int]$c.G-247) -le 1 -and [Math]::Abs([int]$c.B-249) -le 1){$card++}
            if($x -ge $secondRect.Left-$rect.Left -and $x -lt $secondRect.Right-$rect.Left -and
               $y -ge $secondRect.Top-$rect.Top -and $y -lt $secondRect.Bottom-$rect.Top -and
               $c.R -lt 100 -and $c.G -lt 110 -and $c.B -lt 130){$secondInk++;$lastSecondInk=$y}
        }}
        $b.Save((Join-Path $evidence ($Name+'.png')),[Drawing.Imaging.ImageFormat]::Png)
        if($face -notlike '*Google Sans*'){throw "Native title font is not packaged Google Sans: $face"}
        if($gold -lt 100){throw 'Canonical gold logo/brand art missing from actual native wizard'}
        if($card -lt 100){throw 'Native information card background is missing'}
        if($secondInk -lt 25){throw 'Second title line is clipped or not painted'}
        $secondBottomMargin=$secondRect.Bottom-$rect.Top-1-$lastSecondInk
        if($secondBottomMargin -lt 3){throw 'Second title descenders touch the clipping boundary'}
        return [ordered]@{view=$Name;title=$View.text;secondTitle=$secondText;secondTitleInkPixels=$secondInk;secondTitleBottomMargin=$secondBottomMargin;cardPixels=$card;font=$face;dpi=[LRSetupUi]::GetDpiForWindow($View.window);width=$b.Width;height=$b.Height;brandPixels=$gold;rendered=$true}
    }finally{$b.Dispose()}
}
$proof=[Collections.Generic.List[object]]::new()
$process=$null
try{
    if($Mode -eq 'Install'){
        $script:nativeLog=$SetupLog
        $arguments=@('/NORESTART',('/DIR="'+$root+'"'),('/LOG="'+$SetupLog+'"'))
        $process=Start-Setup $Installer $arguments
        $welcome=Wait-View 'Your AI workspace,'
        $proof.Add((Capture-View $welcome '01-welcome'))
        $shortcut=Find-Control $welcome 'Create a desktop shortcut'
        if([LRSetupUi]::SendMessage($shortcut,0xF0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt64() -ne 1){throw 'Desktop shortcut is not selected by default'}
        # Exercise the real checkbox twice, preserving the default behavior.
        [void][LRSetupUi]::SendMessage($shortcut,0xF5,[IntPtr]::Zero,[IntPtr]::Zero)
        if([LRSetupUi]::SendMessage($shortcut,0xF0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt64() -ne 0){throw 'Desktop shortcut control did not toggle'}
        [void][LRSetupUi]::SendMessage($shortcut,0xF5,[IntPtr]::Zero,[IntPtr]::Zero)
        Invoke-Button $welcome 'Install'
        $installing=Wait-View 'Making room for'
        $proof.Add((Capture-View $installing '02-installing'))
        $progress=@([LRSetupUi]::Children($installing.window)|Where-Object{[LRSetupUi]::Class($_) -match 'Progress'})
        if(-not $progress){throw 'Real native installation progress control missing'}
        $ready=Wait-View 'Ready when' 150
        $proof.Add((Capture-View $ready '03-ready'))
        Invoke-Button $ready 'Finish'
        if(-not $process.WaitForExit(30000) -or $process.ExitCode -ne 0){throw 'Interactive installer did not finish successfully'}
        if(-not(Test-Path -LiteralPath (Join-Path $root 'LightRemote.exe'))){throw 'Interactive installation did not install its primary EXE'}
        if(Test-Path -LiteralPath (Join-Path $root 'desktop-v4')){throw 'Fresh primary install contains obsolete desktop-v4 directory'}
        # Finish uses Inno's real [Run] default. The separately scheduled Agent
        # stays running; remove only the CI GUI this proof just launched.
        $deadline=[DateTime]::UtcNow.AddSeconds(15)
        do{
            $gui=@(Get-CimInstance Win32_Process -Filter "Name='LightRemote.exe'"|Where-Object{$_.ExecutablePath -eq (Join-Path $root 'LightRemote.exe') -and $_.CommandLine -notmatch '--agent-host|--managed-worker|--background'})
            if($gui){break};Start-Sleep -Milliseconds 150
        }while([DateTime]::UtcNow -lt $deadline)
        if(-not $gui){throw 'Default Finish action did not open Light Remote'}
        foreach($row in $gui){Stop-Process -Id $row.ProcessId -Force -ErrorAction SilentlyContinue}
    }else{
        $key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{A8D073F5-9792-4FA6-96A6-13C565F255F3}_is1'
        $command=(Get-ItemProperty -LiteralPath $key).UninstallString
        $expected='"'+$Installer+'" /SILENT /NORESTART /LIGHTREMOTEINTERACTIVE'
        if($command -ne $expected){throw 'Windows Apps does not use the new same-uninstaller interactive flow'}
        $script:nativeLog=Join-Path $env:RUNNER_TEMP 'light-remote-ui-uninstall.log'
        $arguments=@('/SILENT','/NORESTART','/LIGHTREMOTEINTERACTIVE',('/LOG="'+$script:nativeLog+'"'))
        $process=Start-Setup $Installer $arguments
        $confirm=Wait-View 'Remove the app.'
        $proof.Add((Capture-View $confirm '04-uninstall-confirm'))
        Invoke-Button $confirm 'Keep app'
        if(-not $process.WaitForExit(15000)){throw 'Keep app did not cancel uninstall'}
        if(-not(Test-Path -LiteralPath (Join-Path $root 'LightRemote.exe'))){throw 'Keep app removed the installation'}
        $canary=Join-Path $root 'desktop-v4/ci-preserve-user-data.txt'
        New-Item -ItemType Directory -Path (Split-Path $canary) -Force|Out-Null
        Set-Content -LiteralPath $canary -Value 'preserve unrelated user data' -Encoding utf8NoBOM
        $process.Dispose();$process=Start-Setup $Installer $arguments
        $confirm=Wait-View 'Remove the app.'
        Invoke-Button $confirm 'Uninstall'
        $removing=Wait-View 'Leaving things' 30
        $proof.Add((Capture-View $removing '05-removing'))
        if(-not @([LRSetupUi]::Children($removing.window)|Where-Object{[LRSetupUi]::Class($_) -match 'Progress'})){throw 'Real native uninstall progress control missing'}
        # The header also says Light Remote; wait for the unique finished
        # multiline title for the full deadline, not an earlier wordmark.
        $done=Wait-View 'is uninstalled.' 90
        $proof.Add((Capture-View $done '06-removed'))
        Invoke-Button $done 'Close'
        if(-not $process.WaitForExit(20000) -or $process.ExitCode -ne 0){throw 'Interactive uninstaller did not finish successfully'}
        if(Test-Path -LiteralPath (Join-Path $root 'LightRemote.exe')){throw 'Primary EXE remains after uninstall'}
        if((Get-Content -LiteralPath $canary -Raw).Trim() -ne 'preserve unrelated user data'){throw 'Uninstall removed unrelated legacy-folder user data'}
    }
    [ordered]@{result='PASS';sourceCommit=$env:GITHUB_SHA;mode=$Mode;views=$proof;physicalOwnerAcceptance=$false;publicRelease=$false}|
        ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $evidence ($Mode.ToLowerInvariant()+'-summary.json')) -Encoding utf8NoBOM
    Write-Host "WINDOWS_DISTRIBUTION_NATIVE_UI=PASS mode=$Mode views=$($proof.Count)"
}catch{
    [ordered]@{result='FAIL';sourceCommit=$env:GITHUB_SHA;mode=$Mode;error=$_.Exception.Message;
        nativeFontDiagnostics=@(if($script:nativeLog -and (Test-Path -LiteralPath $script:nativeLog)){
            Get-Content -LiteralPath $script:nativeLog|Where-Object{$_ -match 'light-remote-title-font=|light-remote-wizard-private-font-unavailable'}
        })}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $evidence ($Mode.ToLowerInvariant()+'-failure.json')) -Encoding utf8NoBOM
    throw
}finally{
    if($process){if(-not $process.HasExited){foreach($ownedId in $script:owned){Stop-Process -Id $ownedId -Force -ErrorAction SilentlyContinue}};$process.Dispose()}
}
