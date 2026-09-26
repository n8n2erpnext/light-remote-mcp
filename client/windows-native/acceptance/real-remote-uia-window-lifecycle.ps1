param([Parameter(Mandatory=$true)][string]$ClientExe,[int]$TimeoutSeconds=20)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $ClientExe)){throw "Client missing: $ClientExe"}
$ClientExe=(Resolve-Path -LiteralPath $ClientExe).Path
$fixture=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-uia-window-lifecycle-fixture.ps1')).Path
if(-not('LightRemoteLifecycleWindow' -as [type])){
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class LightRemoteLifecycleWindow{
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
function Wait-Window([string]$Title){$deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$h=[IntPtr]::Zero;while($h -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline){$h=[LightRemoteLifecycleWindow]::Find($Title);if($h -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}};if($h -eq [IntPtr]::Zero){throw "Window missing: $Title"};return $h}
function Start-Fixture([string]$Title,[string]$Button,[int]$X,[int]$Y){
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=(Get-Command pwsh).Source;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  foreach($arg in @('-NoProfile','-STA','-File',$fixture,'-Title',$Title,'-ButtonName',$Button,'-X',[string]$X,'-Y',[string]$Y)){$psi.ArgumentList.Add($arg)}
  $p=[Diagnostics.Process]::new();$p.StartInfo=$psi;if(-not $p.Start()){throw "Fixture start failed: $Title"};return $p
}
$rr=$null;$appA=$null;$appB=$null;$sem=$null;$detached=$false
function Invoke-Rr([string]$Id,[string]$Op,[hashtable]$RequestArgs=@{}){
  $script:rr.StandardInput.WriteLine((@{id=$Id;op=$Op;args=$RequestArgs}|ConvertTo-Json -Compress -Depth 12));$script:rr.StandardInput.Flush()
  $task=$script:rr.StandardOutput.ReadLineAsync()
  if(-not $task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))){throw "Helper timeout: $Op"}
  $line=$task.Result;if([string]::IsNullOrWhiteSpace($line)){throw "Empty helper response: $Op"}
  $r=$line|ConvertFrom-Json;if(-not $r.ok){throw "Helper error $Op : $($r.error)"};return $r.result
}
function Window-Row([string]$Title){
  $rows=Invoke-Rr ('window-list-'+[Guid]::NewGuid().ToString('N')) 'windows' @{limit=200}
  return @($rows.windows|Where-Object { [string]$_.title -eq $Title })|Select-Object -First 1
}
function Wait-Button([string]$SessionId,[string]$Name,[string]$Prefix){
  $deadline=[DateTime]::UtcNow.AddSeconds(5);$attempt=0
  do{
    $attempt++
    try{
      $snap=Invoke-Rr ($Prefix+'-'+$attempt) 'semantic-snapshot' @{semanticSessionId=$SessionId}
      $nodes=@($snap.nodes|Where-Object { $_.role -eq 'Button' -and $_.name -eq $Name })
      if($nodes.Count -eq 1 -and $null -ne $nodes[0].center){return [pscustomobject]@{snapshot=$snap;button=$nodes[0]}}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $deadline)
  throw "UIA button not found: $Name"
}
try{
  $titleA='Light Remote Window Lifecycle A';$buttonA='Light Remote Window A Action'
  $titleB='Light Remote Window Lifecycle B';$buttonB='Light Remote Window B Action'
  $appB=Start-Fixture $titleB $buttonB 90 90
  $hwndB=Wait-Window $titleB;Start-Sleep -Milliseconds 150
  $appA=Start-Fixture $titleA $buttonA 180 140
  $hwndA=Wait-Window $titleA
  Start-Sleep -Milliseconds 300

  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$ClientExe;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  $psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.ArgumentList.Add('--real-remote-helper')
  $rr=[Diagnostics.Process]::new();$rr.StartInfo=$psi;if(-not $rr.Start()){throw 'Helper start failed'}

  $foregroundDeadline=[DateTime]::UtcNow.AddSeconds(5);$foregroundAttempt=0;$preAttachStatus=$null
  do{
    $foregroundAttempt++
    [LightRemoteLifecycleWindow]::Focus($hwndA);Start-Sleep -Milliseconds 100
    $preAttachStatus=Invoke-Rr ("lifecycle-pre-attach-status-"+$foregroundAttempt) 'status'
    if([string]$preAttachStatus.foreground.title -eq $titleA){break}
  }while([DateTime]::UtcNow -lt $foregroundDeadline)
  if([string]$preAttachStatus.foreground.title -ne $titleA){throw "Window A did not become foreground before attach: $($preAttachStatus.foreground.title)"}
  Write-Host "windows-real-remote-uia-window-pre-attach-foreground=PASS hwndA=$hwndA attempts=$foregroundAttempt"

  $attach=Invoke-Rr 'lifecycle-attach' 'semantic-attach' @{provider='windows-uia';scope='foreground';maxDepth=7;maxNodes=600}
  $sem=[string]$attach.semanticSessionId
  if($attach.provider -ne 'windows-uia' -or [string]::IsNullOrWhiteSpace($sem)){throw 'UIA window lifecycle attach failed'}
  $aReady=Wait-Button $sem $buttonA 'lifecycle-a-ready'
  $aRootHwnd=[string]$aReady.snapshot.nodes[0].hwnd;$aPid=[int]$aReady.snapshot.nodes[0].processId
  if($aPid -ne $appA.Id){throw "Window A PID mismatch actual=$aPid expected=$($appA.Id)"}
  $initial=Window-Row $titleA
  if($null -eq $initial){throw 'Window A missing from windows inventory'}
  $initialWidth=[int]$initial.bounds.width;$initialHeight=[int]$initial.bounds.height

  $maxBefore=[long]$aReady.snapshot.stateSeq
  [LightRemoteLifecycleWindow]::Focus($hwndA);Start-Sleep -Milliseconds 100
  $maxAck=Invoke-Rr 'lifecycle-maximize' 'input' @{events=@(@{type='key';key='UP';modifiers=@('WIN')});semanticSessionId=$sem;afterSeq=$maxBefore;settleMs=250}
  if([int]$maxAck.appliedEvents -ne 1 -or [int]$maxAck.sentInputs -lt 4){throw 'WIN+UP SendInput proof missing'}
  $maxDeadline=[DateTime]::UtcNow.AddSeconds(5);$maxRow=$null
  do{
    $maxRow=Window-Row $titleA
    if($null -ne $maxRow -and [int]$maxRow.bounds.width -ge ($initialWidth+80) -and [int]$maxRow.bounds.height -ge ($initialHeight+80)){break}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $maxDeadline)
  if($null -eq $maxRow -or [int]$maxRow.bounds.width -lt ($initialWidth+80) -or [int]$maxRow.bounds.height -lt ($initialHeight+80)){
    throw "WIN+UP did not maximize window initial=$($initialWidth)x$($initialHeight) actual=$($maxRow.bounds.width)x$($maxRow.bounds.height)"
  }
  $maxSnapshot=Invoke-Rr 'lifecycle-max-snapshot' 'semantic-snapshot' @{semanticSessionId=$sem}
  if([string]$maxSnapshot.semanticSessionId -ne $sem -or [string]$maxSnapshot.nodes[0].hwnd -ne $aRootHwnd){throw 'Maximize changed semantic session/root'}
  Write-Host "windows-real-remote-uia-window-maximize=PASS sentInputs=$($maxAck.sentInputs) initial=$($initialWidth)x$($initialHeight) max=$($maxRow.bounds.width)x$($maxRow.bounds.height) semanticSessionId=$sem"

  $restoreBefore=[long]$maxSnapshot.stateSeq
  $restoreAck=Invoke-Rr 'lifecycle-restore' 'input' @{events=@(@{type='key';key='DOWN';modifiers=@('WIN')});semanticSessionId=$sem;afterSeq=$restoreBefore;settleMs=250}
  if([int]$restoreAck.appliedEvents -ne 1 -or [int]$restoreAck.sentInputs -lt 4){throw 'WIN+DOWN SendInput proof missing'}
  $restoreDeadline=[DateTime]::UtcNow.AddSeconds(5);$restoreRow=$null
  do{
    $restoreRow=Window-Row $titleA
    if($null -ne $restoreRow -and [int]$restoreRow.bounds.width -le ($initialWidth+80) -and [int]$restoreRow.bounds.height -le ($initialHeight+80)){break}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $restoreDeadline)
  if($null -eq $restoreRow -or [int]$restoreRow.bounds.width -gt ($initialWidth+80) -or [int]$restoreRow.bounds.height -gt ($initialHeight+80)){
    throw "WIN+DOWN did not restore window expected~$($initialWidth)x$($initialHeight) actual=$($restoreRow.bounds.width)x$($restoreRow.bounds.height)"
  }
  $restoreReady=Wait-Button $sem $buttonA 'lifecycle-a-restored'
  if([string]$restoreReady.snapshot.nodes[0].hwnd -ne $aRootHwnd){throw 'Restore changed UIA root HWND'}
  Write-Host "windows-real-remote-uia-window-restore=PASS sentInputs=$($restoreAck.sentInputs) restored=$($restoreRow.bounds.width)x$($restoreRow.bounds.height)"

  $ax=[int][Math]::Round([double]$restoreReady.button.center.x);$ay=[int][Math]::Round([double]$restoreReady.button.center.y)
  $actionAck=Invoke-Rr 'lifecycle-a-action' 'input' @{events=@(@{type='move';x=$ax;y=$ay},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=[long]$restoreReady.snapshot.stateSeq;settleMs=150}
  if([int]$actionAck.appliedEvents -ne 2 -or [int]$actionAck.sentInputs -lt 2){throw 'Window A continued input proof missing'}
  $aAccepted=Wait-Button $sem "$buttonA Accepted" 'lifecycle-a-accepted'
  Write-Host "windows-real-remote-uia-window-resize-continued-input=PASS inputSeq=$($actionAck.inputSeq) seq=$($aAccepted.snapshot.stateSeq)"

  $closeBefore=[long]$aAccepted.snapshot.stateSeq
  [LightRemoteLifecycleWindow]::Focus($hwndA);Start-Sleep -Milliseconds 100
  $closeAck=Invoke-Rr 'lifecycle-close-a' 'input' @{events=@(@{type='key';key='F4';modifiers=@('ALT')});semanticSessionId=$sem;afterSeq=$closeBefore;settleMs=300}
  if([int]$closeAck.appliedEvents -ne 1 -or [int]$closeAck.sentInputs -lt 4){throw 'ALT+F4 SendInput proof missing'}

  $exitDeadline=[DateTime]::UtcNow.AddSeconds(5)
  while(-not $appA.HasExited -and [DateTime]::UtcNow -lt $exitDeadline){Start-Sleep -Milliseconds 100}
  if(-not $appA.HasExited){throw 'Window A process did not exit after ALT+F4'}

  $foregroundDeadline=[DateTime]::UtcNow.AddSeconds(5);$bStatus=$null
  do{
    $bStatus=Invoke-Rr 'lifecycle-status-b' 'status'
    if([string]$bStatus.foreground.title -eq $titleB){break}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $foregroundDeadline)
  if([string]$bStatus.foreground.title -ne $titleB){throw "Window B did not become foreground after A close: $($bStatus.foreground.title)"}

  $handoffAck=$closeAck
  if(-not $handoffAck.resyncRecommended -or [string]$handoffAck.foreground.title -ne $titleB){
    $cx=[int]$bStatus.cursor.x;$cy=[int]$bStatus.cursor.y
    $handoffAck=Invoke-Rr 'lifecycle-close-handoff-probe' 'input' @{events=@(@{type='move';x=$cx;y=$cy});semanticSessionId=$sem;afterSeq=[long]$closeAck.stateSeq;settleMs=50}
  }
  if(-not $handoffAck.resyncRecommended){throw 'Window close handoff must recommend UIA resync'}
  if([string]$handoffAck.foreground.title -ne $titleB){throw "Window close handoff foreground mismatch: $($handoffAck.foreground.title)"}
  if([string]$handoffAck.semanticSessionId -ne $sem){throw 'Semantic session changed across top-level window close'}

  $bReady=Wait-Button $sem $buttonB 'lifecycle-b-ready'
  $bRootHwnd=[string]$bReady.snapshot.nodes[0].hwnd;$bPid=[int]$bReady.snapshot.nodes[0].processId
  if($bPid -ne $appB.Id){throw "Window B PID mismatch actual=$bPid expected=$($appB.Id)"}
  if($bRootHwnd -eq $aRootHwnd){throw 'UIA root HWND did not change after top-level close'}

  $closeEvents=Invoke-Rr 'lifecycle-close-events' 'semantic-events' @{semanticSessionId=$sem;afterSeq=$closeBefore;limit=100}
  $handoffs=@($closeEvents.events|Where-Object { $_.kind -eq 'scope' -and $_.change -like 'foreground_handoff:*' -and $_.resyncRecommended })
  if($handoffs.Count -lt 1){throw 'Top-level close root-handoff journal event missing'}
  if($null -ne (Window-Row $titleA)){throw 'Closed Window A still present in windows inventory'}
  Write-Host "windows-real-remote-uia-window-close-handoff=PASS closedHwnd=$aRootHwnd nextHwnd=$bRootHwnd events=$($handoffs.Count) semanticSessionId=$sem"

  $bx=[int][Math]::Round([double]$bReady.button.center.x);$by=[int][Math]::Round([double]$bReady.button.center.y)
  $bAck=Invoke-Rr 'lifecycle-b-action' 'input' @{events=@(@{type='move';x=$bx;y=$by},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=[long]$bReady.snapshot.stateSeq;settleMs=150}
  if([int]$bAck.appliedEvents -ne 2 -or [int]$bAck.sentInputs -lt 2){throw 'Window B post-close input proof missing'}
  $bAccepted=Wait-Button $sem "$buttonB Accepted" 'lifecycle-b-accepted'
  if([string]$bAccepted.snapshot.semanticSessionId -ne $sem -or [string]$bAccepted.snapshot.nodes[0].hwnd -ne $bRootHwnd){throw 'Post-close continued input changed semantic session/root'}
  Write-Host "windows-real-remote-uia-window-close-continued-input=PASS sentInputs=$($bAck.sentInputs) inputSeq=$($bAck.inputSeq) seq=$($bAccepted.snapshot.stateSeq)"
  Write-Host 'windows-real-remote-uia-window-lifecycle-closed-loop=PASS'

  $d=Invoke-Rr 'lifecycle-detach' 'semantic-detach' @{semanticSessionId=$sem}
  if(-not $d.detached -or $d.provider -ne 'windows-uia'){throw 'UIA window lifecycle detach failed'};$detached=$true
}finally{
  if($rr){
    if($sem -and -not $detached -and -not $rr.HasExited){try{$null=Invoke-Rr 'lifecycle-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};try{$rr.Dispose()}catch{}
  }
  foreach($p in @($appA,$appB)){if($p){try{if(-not $p.HasExited){$p.Kill($true);$null=$p.WaitForExit(3000)}}catch{};try{$p.Dispose()}catch{}}}
}
