param([Parameter(Mandatory=$true)][string]$ClientExe,[int]$TimeoutSeconds=20)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $ClientExe)){throw "Client missing: $ClientExe"}
$ClientExe=(Resolve-Path -LiteralPath $ClientExe).Path
$fixture=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-uia-fixture.ps1')).Path
if(-not('LightRemoteSemanticActWindow' -as [type])){
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class LightRemoteSemanticActWindow{
 delegate bool P(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]static extern bool EnumWindows(P p,IntPtr x);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 public static IntPtr FindExact(string n){IntPtr f=IntPtr.Zero;EnumWindows((h,_)=>{if(!IsWindowVisible(h))return true;var s=new StringBuilder(1024);GetWindowText(h,s,s.Capacity);if(string.Equals(s.ToString(),n,StringComparison.Ordinal)){f=h;return false;}return true;},IntPtr.Zero);return f;}
 public static void Focus(IntPtr h){if(h!=IntPtr.Zero){ShowWindow(h,5);SetForegroundWindow(h);}}
}
'@
}
function Start-Fixture([string]$Title,[string]$Button){
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=(Get-Command pwsh).Source;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  foreach($arg in @('-NoProfile','-STA','-WindowStyle','Hidden','-File',$fixture,'-Title',$Title,'-ButtonName',$Button,'-X','180','-Y','120')){$psi.ArgumentList.Add($arg)}
  $p=[Diagnostics.Process]::new();$p.StartInfo=$psi;if(-not $p.Start()){throw "Fixture start failed: $Title"};return $p
}
function Wait-Window([string]$Title){
  $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$h=[IntPtr]::Zero
  while($h -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline){$h=[LightRemoteSemanticActWindow]::FindExact($Title);if($h -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}}
  if($h -eq [IntPtr]::Zero){throw "Fixture window missing: $Title"};[LightRemoteSemanticActWindow]::Focus($h);Start-Sleep -Milliseconds 250;return $h
}
$rr=$null
function Invoke-Rr([string]$Id,[string]$Op,[hashtable]$RequestArgs=@{}){
  $script:rr.StandardInput.WriteLine((@{id=$Id;op=$Op;args=$RequestArgs}|ConvertTo-Json -Compress -Depth 12));$script:rr.StandardInput.Flush()
  $task=$script:rr.StandardOutput.ReadLineAsync()
  if(-not $task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))){throw "Helper timeout: $Op"}
  $line=$task.Result;if([string]::IsNullOrWhiteSpace($line)){throw "Empty helper response: $Op"}
  $r=$line|ConvertFrom-Json;if(-not $r.ok){throw "Helper error $Op : $($r.error)"};return $r.result
}
function Wait-Node([string]$Sem,[string]$Name,[string]$Prefix){
  $deadline=[DateTime]::UtcNow.AddSeconds(5);$i=0
  do{$i++;$snap=Invoke-Rr ($Prefix+'-'+$i) 'observe' @{semanticSessionId=$Sem};$nodes=@($snap.nodes|Where-Object{$_.role -eq 'Button' -and $_.name -eq $Name});if($nodes.Count -eq 1){return [pscustomobject]@{snapshot=$snap;node=$nodes[0]}};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $deadline)
  throw "UIA node not found: $Name"
}
function Wait-Diff([string]$Sem,[long]$After,[string]$Prefix){
  $deadline=[DateTime]::UtcNow.AddSeconds(3);$i=0
  do{$i++;$d=Invoke-Rr ($Prefix+'-'+$i) 'observe' @{semanticSessionId=$Sem;afterSeq=$After;limit=100};if(@($d.events).Count -gt 0){return $d};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $deadline)
  throw "Semantic diff missing after seq $After"
}
function Run-Case([string]$Case,[string]$Action,[string]$ExpectedMethod,[int]$ExpectedSent){
  $title="Light Remote Semantic $Case";$button="Semantic $Case";$p=$null;$sem=$null
  try{
    $p=Start-Fixture $title $button;$null=Wait-Window $title
    $obs=Invoke-Rr ("$Case-observe-open") 'observe' @{provider='windows-uia';scope='foreground';maxDepth=7;maxNodes=400}
    $sem=[string]$obs.semanticSessionId
    if($obs.provider -ne 'windows-uia' -or [string]::IsNullOrWhiteSpace($sem)){throw "$Case observe attach failed"}
    if([string]$obs.nextObservation.mode -ne 'events' -or [long]$obs.nextObservation.afterSeq -ne [long]$obs.stateSeq){throw "$Case observe nextObservation mismatch"}
    $found=Wait-Node $sem $button "$Case-ready";$n=$found.node
    if([string]::IsNullOrWhiteSpace([string]$n.id)-or [string]$n.label -ne $button){throw "$Case node identity missing"}
    if(-not(@($n.actions) -contains $Action)){throw "$Case action not advertised: $Action"}
    $before=[long]$found.snapshot.stateSeq
    $act=Invoke-Rr ("$Case-act") 'act' @{semanticSessionId=$sem;nodeId=[string]$n.id;action=$Action;afterSeq=$before;settleMs=150}
    if($act.method -ne $ExpectedMethod -or $act.action -ne $Action -or [int]$act.ack.appliedEvents -ne 1 -or [int]$act.ack.sentInputs -ne $ExpectedSent){throw "$Case action ACK mismatch"}
    if([long]$act.ack.startedAt -le 0 -or [long]$act.ack.ackAt -lt [long]$act.ack.startedAt -or [long]$act.ack.elapsedMs -ne ([long]$act.ack.ackAt-[long]$act.ack.startedAt)){throw "$Case action local timing mismatch"}
    if($act.ack.resyncRecommended -or $act.ack.hasMore -or [string]$act.ack.nextObservation.mode -ne 'events' -or [long]$act.ack.nextObservation.afterSeq -ne [long]$act.ack.stateSeq){throw "$Case action nextObservation mismatch"}
    if([string]$act.ack.observation -ne 'local-diff+journal' -or $null -eq $act.ack.patch -or -not $act.ack.patch.changed){throw "$Case action patch missing"}
    $patchNodes=@($act.ack.patch.added)+@($act.ack.patch.updated)
    $patchAccepted=@($patchNodes | Where-Object {[string]$_.label -eq ($button+' Accepted')})
    if($patchAccepted.Count -lt 1){throw "$Case accepted node missing from action patch"}
    if(@($act.ack.events).Count -gt 24){throw "$Case action event evidence exceeded compact bound"}
    if([int]$act.ack.eventCount -gt @($act.ack.events).Count -and -not $act.ack.eventsCompacted){throw "$Case action event compaction flag mismatch"}
    $diff=$act.ack
    $late=Invoke-Rr ("$Case-late") 'observe' @{semanticSessionId=$sem;afterSeq=[long]$act.ack.nextObservation.afterSeq;limit=100}
    if($late.resyncRecommended -or [string]$late.nextObservation.mode -ne 'events'){throw "$Case late event continuation mismatch"}
    $done=Wait-Node $sem ($button+' Accepted') "$Case-accepted"
    if([string]$done.snapshot.semanticSessionId -ne $sem){throw "$Case semantic session changed"}
    Write-Host "windows-real-remote-semantic-$($Action)=PASS method=$($act.method) patch=$($act.ack.patch.addedCount)/$($act.ack.patch.updatedCount)/$($act.ack.patch.removedCount) events=$(@($diff.events).Count)/$($act.ack.eventCount) localMs=$($act.ack.elapsedMs) next=$($act.ack.nextObservation.mode):$($act.ack.nextObservation.afterSeq) seq=$($done.snapshot.stateSeq)"
    $d=Invoke-Rr ("$Case-detach") 'semantic-detach' @{semanticSessionId=$sem};if(-not $d.detached){throw "$Case detach failed"};$sem=$null
  }finally{
    if($sem -and $rr -and -not $rr.HasExited){try{$null=Invoke-Rr ("$Case-detach-finally") 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    if($p){try{if(-not $p.HasExited){$p.Kill($true);$null=$p.WaitForExit(3000)}}catch{};try{$p.Dispose()}catch{}}
  }
}
try{
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$ClientExe;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.ArgumentList.Add('--real-remote-helper')
  $rr=[Diagnostics.Process]::new();$rr.StartInfo=$psi;if(-not $rr.Start()){throw 'Helper start failed'}
  $status=Invoke-Rr 'semantic-act-status' 'status';if(-not $status.interactive -or $status.platform -ne 'win32'){throw 'Interactive Windows desktop required'}
  Run-Case 'Invoke' 'invoke' 'uia.invoke' 0
  Run-Case 'Click' 'click' 'sendinput.click' 2
  Write-Host 'windows-real-remote-semantic-observe-act=PASS'
}finally{
  if($rr){try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};try{$rr.Dispose()}catch{}}
}
