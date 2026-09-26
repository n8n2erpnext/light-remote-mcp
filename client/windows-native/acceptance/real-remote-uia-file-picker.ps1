param([Parameter(Mandatory=$true)][string]$ClientExe,[int]$TimeoutSeconds=20)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $ClientExe)){throw "Client missing: $ClientExe"}
$ClientExe=(Resolve-Path -LiteralPath $ClientExe).Path
$fixture=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-uia-file-picker-fixture.ps1')).Path
if(-not('LightRemoteFilePickerWindow' -as [type])){
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class LightRemoteFilePickerWindow{
 delegate bool P(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]static extern bool EnumWindows(P p,IntPtr x);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 public static IntPtr Find(string n){IntPtr f=IntPtr.Zero;EnumWindows((h,_)=>{if(!IsWindowVisible(h))return true;var s=new StringBuilder(1024);GetWindowText(h,s,s.Capacity);if(string.Equals(s.ToString(),n,StringComparison.Ordinal)){f=h;return false;}return true;},IntPtr.Zero);return f;}
 public static void Focus(IntPtr h){if(h!=IntPtr.Zero){ShowWindow(h,5);SetForegroundWindow(h);}}
}
'@
}
function Wait-Window([string]$Title){
  $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$h=[IntPtr]::Zero
  while($h -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline){$h=[LightRemoteFilePickerWindow]::Find($Title);if($h -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}}
  if($h -eq [IntPtr]::Zero){throw "Window missing: $Title"};return $h
}
$rr=$null;$fixtureProcess=$null;$sem=$null;$detached=$false
function Invoke-Rr([string]$Id,[string]$Op,[hashtable]$RequestArgs=@{}){
  $script:rr.StandardInput.WriteLine((@{id=$Id;op=$Op;args=$RequestArgs}|ConvertTo-Json -Compress -Depth 12));$script:rr.StandardInput.Flush()
  $task=$script:rr.StandardOutput.ReadLineAsync()
  if(-not $task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))){throw "Helper timeout: $Op"}
  $line=$task.Result;if([string]::IsNullOrWhiteSpace($line)){throw "Empty helper response: $Op"}
  $r=$line|ConvertFrom-Json;if(-not $r.ok){throw "Helper error $Op : $($r.error)"};return $r.result
}
function Wait-Button([string]$SessionId,[string]$Name,[string]$Prefix){
  $deadline=[DateTime]::UtcNow.AddSeconds(5);$attempt=0
  do{
    $attempt++
    try{
      $snap=Invoke-Rr ($Prefix+'-'+$attempt) 'semantic-snapshot' @{semanticSessionId=$SessionId}
      $buttons=@($snap.nodes|Where-Object { $_.role -eq 'Button' -and $_.name -eq $Name })
      if($buttons.Count -eq 1 -and $null -ne $buttons[0].center){return [pscustomobject]@{snapshot=$snap;button=$buttons[0]}}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $deadline)
  throw "UIA button not found: $Name"
}
function Wait-Root([string]$SessionId,[string]$Title,[IntPtr]$Hwnd,[string]$Prefix){
  $expected=('0x{0:X}' -f $Hwnd.ToInt64());$deadline=[DateTime]::UtcNow.AddSeconds(5);$attempt=0
  do{
    $attempt++
    try{
      $snap=Invoke-Rr ($Prefix+'-'+$attempt) 'semantic-snapshot' @{semanticSessionId=$SessionId}
      $roots=@($snap.nodes|Where-Object { [int]$_.depth -eq 0 })
      if([string]$snap.foreground.title -eq $Title -and $roots.Count -eq 1 -and [string]$roots[0].hwnd -eq $expected){return [pscustomobject]@{snapshot=$snap;root=$roots[0]}}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $deadline)
  throw "UIA root did not follow window: $Title $expected"
}
try{
  $fixtureProcess=Start-Process -FilePath (Get-Command pwsh).Source -ArgumentList @('-NoProfile','-STA','-File',$fixture) -PassThru
  $parentTitle='Light Remote UIA File Picker Parent';$dialogTitle='Light Remote Native File Picker'
  $parentHwnd=Wait-Window $parentTitle
  [LightRemoteFilePickerWindow]::Focus($parentHwnd);Start-Sleep -Milliseconds 250
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$ClientExe;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  $psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.ArgumentList.Add('--real-remote-helper')
  $rr=[Diagnostics.Process]::new();$rr.StartInfo=$psi;if(-not $rr.Start()){throw 'Helper start failed'}
  $attach=Invoke-Rr 'picker-attach' 'semantic-attach' @{provider='windows-uia';scope='foreground';maxDepth=8;maxNodes=800}
  $sem=[string]$attach.semanticSessionId
  if($attach.provider -ne 'windows-uia' -or [string]::IsNullOrWhiteSpace($sem)){throw 'UIA file-picker attach failed'}
  $parent=Wait-Button $sem 'Light Remote Open File Picker' 'picker-parent-ready'
  $parentPid=[int]$parent.snapshot.nodes[0].processId;$parentRootHwnd=[string]$parent.snapshot.nodes[0].hwnd
  if($parentPid -ne $fixtureProcess.Id){throw "File-picker parent PID mismatch actual=$parentPid expected=$($fixtureProcess.Id)"}
  $px=[int][Math]::Round([double]$parent.button.center.x);$py=[int][Math]::Round([double]$parent.button.center.y);$openBefore=[long]$parent.snapshot.stateSeq
  $openAck=Invoke-Rr 'picker-open' 'input' @{events=@(@{type='move';x=$px;y=$py},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$openBefore;settleMs=250}
  if([int]$openAck.appliedEvents -ne 2 -or [int]$openAck.sentInputs -lt 2){throw 'File-picker open SendInput proof missing'}
  $dialogHwnd=Wait-Window $dialogTitle
  if($dialogHwnd -eq $parentHwnd){throw 'Native file picker did not create a distinct HWND'}
  $dialogForegroundDeadline=[DateTime]::UtcNow.AddSeconds(5);$dialogStatus=$null
  do{
    $dialogStatus=Invoke-Rr 'picker-dialog-status' 'status'
    if([string]$dialogStatus.foreground.title -eq $dialogTitle){break}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $dialogForegroundDeadline)
  if([string]$dialogStatus.foreground.title -ne $dialogTitle){throw "Native file-picker did not become foreground: $($dialogStatus.foreground.title)"}

  $handoffAck=$openAck
  if(-not $handoffAck.resyncRecommended -or [string]$handoffAck.foreground.title -ne $dialogTitle){
    $probeX=[int]$openAck.cursor.x;$probeY=[int]$openAck.cursor.y
    $handoffAck=Invoke-Rr 'picker-open-handoff-probe' 'input' @{events=@(@{type='move';x=$probeX;y=$probeY});semanticSessionId=$sem;afterSeq=[long]$openAck.stateSeq;settleMs=50}
  }
  if(-not $handoffAck.resyncRecommended){throw 'Native file-picker open must recommend UIA resync'}
  if([string]$handoffAck.foreground.title -ne $dialogTitle){throw "Native file-picker foreground mismatch after handoff probe: $($handoffAck.foreground.title)"}

  $dialog=Wait-Root $sem $dialogTitle $dialogHwnd 'picker-dialog-root'
  $dialogRootHwnd=[string]$dialog.root.hwnd;$dialogPid=[int]$dialog.root.processId
  if($dialogRootHwnd -eq $parentRootHwnd){throw "Native file-picker root HWND did not change: $dialogRootHwnd"}
  if([string]$dialog.snapshot.semanticSessionId -ne $sem){throw 'Semantic session changed during native file-picker handoff'}
  $interactive=@($dialog.snapshot.nodes|Where-Object { $_.role -in @('Button','Edit','ComboBox','List','Tree','DataGrid','ListItem','TreeItem') })
  if($interactive.Count -lt 1){throw "Native file-picker semantic controls missing nodeCount=$($dialog.snapshot.nodeCount)"}
  $openEvents=Invoke-Rr 'picker-open-events' 'semantic-events' @{semanticSessionId=$sem;afterSeq=$openBefore;limit=100}
  $openHandoffs=@($openEvents.events|Where-Object { $_.kind -eq 'scope' -and $_.change -like 'foreground_handoff:*' -and $_.resyncRecommended })
  if($openHandoffs.Count -lt 1){throw 'Native file-picker root-handoff journal event missing'}
  Write-Host "windows-real-remote-uia-file-picker-open-handoff=PASS parentHwnd=$parentRootHwnd dialogHwnd=$dialogRootHwnd parentPid=$parentPid dialogPid=$dialogPid events=$($openHandoffs.Count) semanticSessionId=$sem"
  Write-Host "windows-real-remote-uia-file-picker-semantic=PASS nodeCount=$($dialog.snapshot.nodeCount) interactiveNodes=$($interactive.Count)"
  $dialogBefore=[long]$dialog.snapshot.stateSeq
  $closeAck=Invoke-Rr 'picker-close-esc' 'input' @{events=@(@{type='key';key='ESC';modifiers=@()});semanticSessionId=$sem;afterSeq=$dialogBefore;settleMs=250}
  if([int]$closeAck.appliedEvents -ne 1 -or [int]$closeAck.sentInputs -lt 2){throw 'File-picker ESC SendInput proof missing'}
  $parentForegroundDeadline=[DateTime]::UtcNow.AddSeconds(5);$parentForeground=$null
  do{
    $parentForeground=Invoke-Rr 'picker-parent-status' 'status'
    if([string]$parentForeground.foreground.title -eq $parentTitle){break}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $parentForegroundDeadline)
  if([string]$parentForeground.foreground.title -ne $parentTitle){throw "Parent did not regain foreground after ESC: $($parentForeground.foreground.title)"}

  $returnAck=$closeAck
  if(-not $returnAck.resyncRecommended){
    $probeX=[int]$closeAck.cursor.x;$probeY=[int]$closeAck.cursor.y
    $returnAck=Invoke-Rr 'picker-close-handoff-probe' 'input' @{events=@(@{type='move';x=$probeX;y=$probeY});semanticSessionId=$sem;afterSeq=[long]$closeAck.stateSeq;settleMs=50}
  }
  if(-not $returnAck.resyncRecommended){throw 'Native file-picker close must recommend parent UIA resync'}
  if([string]$returnAck.foreground.title -ne $parentTitle){throw "Parent foreground mismatch after file-picker close: $($returnAck.foreground.title)"}

  $parentReturn=Wait-Button $sem 'Light Remote Open File Picker' 'picker-parent-return'
  $returnRootHwnd=[string]$parentReturn.snapshot.nodes[0].hwnd;$returnPid=[int]$parentReturn.snapshot.nodes[0].processId
  if($returnRootHwnd -ne $parentRootHwnd){throw "File-picker parent HWND did not recover actual=$returnRootHwnd expected=$parentRootHwnd"}
  if($returnPid -ne $parentPid){throw "File-picker parent PID changed actual=$returnPid expected=$parentPid"}
  if([string]$parentReturn.snapshot.semanticSessionId -ne $sem){throw 'Semantic session changed after native file-picker close'}
  $closedStatus=@($parentReturn.snapshot.nodes|Where-Object { $_.name -eq 'Light Remote File Picker Closed' })
  if($closedStatus.Count -lt 1){
    Start-Sleep -Milliseconds 100
    $parentAfter=Invoke-Rr 'picker-parent-after-close' 'semantic-snapshot' @{semanticSessionId=$sem}
    $closedStatus=@($parentAfter.nodes|Where-Object { $_.name -eq 'Light Remote File Picker Closed' })
    if($closedStatus.Count -lt 1){throw 'Parent file-picker-closed state missing after ESC'}
  }
  $closeEvents=Invoke-Rr 'picker-close-events' 'semantic-events' @{semanticSessionId=$sem;afterSeq=$dialogBefore;limit=100}
  $closeHandoffs=@($closeEvents.events|Where-Object { $_.kind -eq 'scope' -and $_.change -like 'foreground_handoff:*' -and $_.resyncRecommended })
  if($closeHandoffs.Count -lt 1){throw 'Native file-picker close root-handoff journal event missing'}
  Write-Host "windows-real-remote-uia-file-picker-close-handoff=PASS dialogHwnd=$dialogRootHwnd parentHwnd=$parentRootHwnd events=$($closeHandoffs.Count) semanticSessionId=$sem"
  Write-Host 'windows-real-remote-uia-file-picker-closed-loop=PASS'

  $d=Invoke-Rr 'picker-detach' 'semantic-detach' @{semanticSessionId=$sem}
  if(-not $d.detached -or $d.provider -ne 'windows-uia'){throw 'UIA file-picker detach failed'};$detached=$true
}finally{
  if($rr){
    if($sem -and -not $detached -and -not $rr.HasExited){try{$null=Invoke-Rr 'picker-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};try{$rr.Dispose()}catch{}
  }
  if($fixtureProcess){try{if(-not $fixtureProcess.HasExited){$fixtureProcess.Kill($true);$null=$fixtureProcess.WaitForExit(3000)}}catch{};try{$fixtureProcess.Dispose()}catch{}}
}
