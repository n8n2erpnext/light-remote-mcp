param([Parameter(Mandatory=$true)][string]$ClientExe,[int]$TimeoutSeconds=20)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $ClientExe)){throw "Client missing: $ClientExe"}
$ClientExe=(Resolve-Path -LiteralPath $ClientExe).Path
$fixture=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-uia-modal-fixture.ps1')).Path
if(-not('LightRemoteModalWindow' -as [type])){
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class LightRemoteModalWindow{
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
function Wait-Window([string]$Title){$deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$h=[IntPtr]::Zero;while($h -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline){$h=[LightRemoteModalWindow]::Find($Title);if($h -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}};if($h -eq [IntPtr]::Zero){throw "Window missing: $Title"};return $h}
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
    $attempt++;$snap=Invoke-Rr ($Prefix+'-'+$attempt) 'semantic-snapshot' @{semanticSessionId=$SessionId}
    $buttons=@($snap.nodes|Where-Object { $_.role -eq 'Button' -and $_.name -eq $Name })
    if($buttons.Count -eq 1 -and $null -ne $buttons[0].center){return [pscustomobject]@{snapshot=$snap;button=$buttons[0]}}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $deadline)
  throw "UIA button not found: $Name"
}
try{
  $fixtureProcess=Start-Process -FilePath (Get-Command pwsh).Source -ArgumentList @('-NoProfile','-STA','-File',$fixture) -PassThru
  $parentTitle='Light Remote UIA Modal Parent';$dialogTitle='Light Remote UIA Modal Dialog'
  $parentHwnd=Wait-Window $parentTitle
  [LightRemoteModalWindow]::Focus($parentHwnd);Start-Sleep -Milliseconds 250
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$ClientExe;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  $psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.ArgumentList.Add('--real-remote-helper')
  $rr=[Diagnostics.Process]::new();$rr.StartInfo=$psi;if(-not $rr.Start()){throw 'Helper start failed'}
  $attach=Invoke-Rr 'modal-attach' 'semantic-attach' @{provider='windows-uia';scope='foreground';maxDepth=7;maxNodes=400}
  $sem=[string]$attach.semanticSessionId
  if($attach.provider -ne 'windows-uia' -or [string]::IsNullOrWhiteSpace($sem)){throw 'UIA modal attach failed'}
  $parent=Wait-Button $sem 'Light Remote Open Modal' 'modal-parent-ready'
  $parentPid=[int]$parent.snapshot.nodes[0].processId;$parentRootHwnd=[string]$parent.snapshot.nodes[0].hwnd
  if($parentPid -ne $fixtureProcess.Id){throw "Parent UIA process mismatch actual=$parentPid expected=$($fixtureProcess.Id)"}
  $px=[int][Math]::Round([double]$parent.button.center.x);$py=[int][Math]::Round([double]$parent.button.center.y);$openBefore=[long]$parent.snapshot.stateSeq
  $openAck=Invoke-Rr 'modal-open' 'input' @{events=@(@{type='move';x=$px;y=$py},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$openBefore;settleMs=250}
  if([int]$openAck.appliedEvents -ne 2 -or [int]$openAck.sentInputs -lt 2){throw 'Modal open SendInput proof missing'}
  if([string]$openAck.foreground.title -ne $dialogTitle){throw "Modal foreground mismatch: $($openAck.foreground.title)"}
  if(-not $openAck.resyncRecommended){throw 'Modal open must recommend UIA resync'}

  $modal=Wait-Button $sem 'Light Remote Modal Action' 'modal-dialog-ready'
  $modalPid=[int]$modal.snapshot.nodes[0].processId;$modalRootHwnd=[string]$modal.snapshot.nodes[0].hwnd
  if($modalPid -ne $parentPid){throw "Modal PID changed parent=$parentPid modal=$modalPid"}
  if($modalRootHwnd -eq $parentRootHwnd){throw "Modal HWND did not change: $modalRootHwnd"}
  if([string]$modal.snapshot.semanticSessionId -ne $sem){throw 'Semantic session changed during modal handoff'}
  if([string]$modal.snapshot.foreground.title -ne $dialogTitle){throw "Modal snapshot foreground mismatch: $($modal.snapshot.foreground.title)"}
  $openEvents=Invoke-Rr 'modal-open-events' 'semantic-events' @{semanticSessionId=$sem;afterSeq=$openBefore;limit=100}
  $handoffEvents=@($openEvents.events|Where-Object { $_.kind -eq 'scope' -and $_.change -like 'foreground_handoff:*' -and $_.resyncRecommended })
  if($handoffEvents.Count -lt 1){throw 'Modal root-handoff journal event missing'}
  Write-Host "windows-real-remote-uia-modal-open-handoff=PASS pid=$parentPid parentHwnd=$parentRootHwnd modalHwnd=$modalRootHwnd events=$($handoffEvents.Count) semanticSessionId=$sem"

  $mx=[int][Math]::Round([double]$modal.button.center.x);$my=[int][Math]::Round([double]$modal.button.center.y);$modalBefore=[long]$modal.snapshot.stateSeq
  $modalAck=Invoke-Rr 'modal-action' 'input' @{events=@(@{type='move';x=$mx;y=$my},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$modalBefore;settleMs=120}
  if([int]$modalAck.appliedEvents -ne 2 -or [int]$modalAck.sentInputs -lt 2){throw 'Modal action SendInput proof missing'}
  $modalDone=Wait-Button $sem 'Light Remote Modal Accepted' 'modal-action-accepted'
  if([int]$modalDone.snapshot.nodes[0].processId -ne $parentPid -or [string]$modalDone.snapshot.nodes[0].hwnd -ne $modalRootHwnd){throw 'Modal identity changed during action'}
  Write-Host "windows-real-remote-uia-modal-action=PASS inputSeq=$($modalAck.inputSeq) seq=$($modalDone.snapshot.stateSeq)"
  $close=Wait-Button $sem 'Light Remote Close Modal' 'modal-close-ready'
  $cx=[int][Math]::Round([double]$close.button.center.x);$cy=[int][Math]::Round([double]$close.button.center.y);$closeBefore=[long]$close.snapshot.stateSeq
  $closeAck=Invoke-Rr 'modal-close' 'input' @{events=@(@{type='move';x=$cx;y=$cy},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$closeBefore;settleMs=250}
  if([int]$closeAck.appliedEvents -ne 2 -or [int]$closeAck.sentInputs -lt 2){throw 'Modal close SendInput proof missing'}
  if([string]$closeAck.foreground.title -ne $parentTitle){throw "Parent foreground mismatch after modal close: $($closeAck.foreground.title)"}
  if(-not $closeAck.resyncRecommended){throw 'Modal close must recommend parent resync'}

  $parentReturn=Wait-Button $sem 'Light Remote Open Modal' 'modal-parent-return'
  $returnPid=[int]$parentReturn.snapshot.nodes[0].processId;$returnRootHwnd=[string]$parentReturn.snapshot.nodes[0].hwnd
  if($returnPid -ne $parentPid){throw "Parent PID changed after modal close: $returnPid"}
  if($returnRootHwnd -ne $parentRootHwnd){throw "Parent HWND did not recover actual=$returnRootHwnd expected=$parentRootHwnd"}
  if([string]$parentReturn.snapshot.semanticSessionId -ne $sem){throw 'Semantic session changed after modal close'}
  $closedStatus=@($parentReturn.snapshot.nodes|Where-Object { $_.name -eq 'Light Remote Modal Closed' })
  if($closedStatus.Count -lt 1){
    Start-Sleep -Milliseconds 100
    $parentAfter=Invoke-Rr 'modal-parent-after-close' 'semantic-snapshot' @{semanticSessionId=$sem}
    $closedStatus=@($parentAfter.nodes|Where-Object { $_.name -eq 'Light Remote Modal Closed' })
    if($closedStatus.Count -lt 1){throw 'Parent modal-closed state missing after dialog close'}
  }
  $closeEvents=Invoke-Rr 'modal-close-events' 'semantic-events' @{semanticSessionId=$sem;afterSeq=$closeBefore;limit=100}
  $returnHandoffs=@($closeEvents.events|Where-Object { $_.kind -eq 'scope' -and $_.change -like 'foreground_handoff:*' -and $_.resyncRecommended })
  if($returnHandoffs.Count -lt 1){throw 'Modal close root-handoff journal event missing'}
  Write-Host "windows-real-remote-uia-modal-close-handoff=PASS pid=$parentPid modalHwnd=$modalRootHwnd parentHwnd=$parentRootHwnd events=$($returnHandoffs.Count) semanticSessionId=$sem"
  Write-Host 'windows-real-remote-uia-modal-closed-loop=PASS'

  $d=Invoke-Rr 'modal-detach' 'semantic-detach' @{semanticSessionId=$sem}
  if(-not $d.detached -or $d.provider -ne 'windows-uia'){throw 'UIA modal detach failed'};$detached=$true
}finally{
  if($rr){
    if($sem -and -not $detached -and -not $rr.HasExited){try{$null=Invoke-Rr 'modal-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};try{$rr.Dispose()}catch{}
  }
  if($fixtureProcess){try{if(-not $fixtureProcess.HasExited){$fixtureProcess.Kill($true);$null=$fixtureProcess.WaitForExit(3000)}}catch{};try{$fixtureProcess.Dispose()}catch{}}
}
