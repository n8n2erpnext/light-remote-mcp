param([Parameter(Mandatory=$true)][string]$ClientExe,[int]$TimeoutSeconds=20)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $ClientExe)){throw "Client missing: $ClientExe"}
$ClientExe=(Resolve-Path -LiteralPath $ClientExe).Path
$fixture=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-uia-fixture.ps1')).Path
if(-not('LightRemoteUiaAcceptanceWindow' -as [type])){
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class LightRemoteUiaAcceptanceWindow{
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
function Start-Fixture([string]$Title,[string]$Button,[int]$X,[int]$Y){
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=(Get-Command pwsh).Source;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  foreach($arg in @('-NoProfile','-STA','-WindowStyle','Hidden','-File',$fixture,'-Title',$Title,'-ButtonName',$Button,'-X',[string]$X,'-Y',[string]$Y)){$psi.ArgumentList.Add($arg)}
  $p=[Diagnostics.Process]::new();$p.StartInfo=$psi;if(-not $p.Start()){throw "Fixture start failed: $Title"};return $p
}
function Wait-Window([string]$Title){
  $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$h=[IntPtr]::Zero
  while($h -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline){$h=[LightRemoteUiaAcceptanceWindow]::FindExact($Title);if($h -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}}
  if($h -eq [IntPtr]::Zero){throw "Fixture window missing: $Title"};return $h
}
$rr=$null;$appA=$null;$appB=$null;$sem=$null;$detached=$false
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
  $appATitle='Light Remote UIA App A';$appBTitle='Light Remote UIA App B'
  $appAButton='Light Remote App A Action';$appBButton='Light Remote App B Action'
  $appA=Start-Fixture $appATitle $appAButton 120 100
  $appB=Start-Fixture $appBTitle $appBButton 680 160
  $hwndA=Wait-Window $appATitle;$hwndB=Wait-Window $appBTitle
  [LightRemoteUiaAcceptanceWindow]::Focus($hwndB);Start-Sleep -Milliseconds 150
  [LightRemoteUiaAcceptanceWindow]::Focus($hwndA);Start-Sleep -Milliseconds 250
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$ClientExe;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  $psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.ArgumentList.Add('--real-remote-helper')
  $rr=[Diagnostics.Process]::new();$rr.StartInfo=$psi;if(-not $rr.Start()){throw 'Helper start failed'}
  $status=Invoke-Rr 'uia-status' 'status'
  if(-not $status.interactive -or $status.platform -ne 'win32'){throw 'Interactive Windows desktop required'}
  if([string]$status.foreground.title -ne $appATitle){throw "App A is not foreground before attach: $($status.foreground.title)"}
  $attach=Invoke-Rr 'uia-attach' 'semantic-attach' @{provider='windows-uia';scope='foreground';maxDepth=7;maxNodes=400}
  $sem=[string]$attach.semanticSessionId
  if($attach.provider -ne 'windows-uia' -or [string]::IsNullOrWhiteSpace($sem)){throw 'Windows UIA foreground attach failed'}
  $a=Wait-Button $sem $appAButton 'uia-a-ready'
  $ax=[int][Math]::Round([double]$a.button.center.x);$ay=[int][Math]::Round([double]$a.button.center.y);$aBefore=[long]$a.snapshot.stateSeq
  $aAck=Invoke-Rr 'uia-a-click' 'input' @{events=@(@{type='move';x=$ax;y=$ay},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$aBefore;settleMs=120}
  if([int]$aAck.appliedEvents -ne 2 -or [int]$aAck.sentInputs -lt 2){throw 'App A SendInput proof missing'}
  $aDone=Wait-Button $sem ($appAButton+' Accepted') 'uia-a-accepted'
  Write-Host "windows-real-remote-uia-app-a-input=PASS semanticSessionId=$sem inputSeq=$($aAck.inputSeq) seq=$($aDone.snapshot.stateSeq)"

  $switchBefore=[long]$aDone.snapshot.stateSeq
  $switchAck=Invoke-Rr 'uia-alt-tab-a-b' 'input' @{events=@(@{type='key';key='TAB';modifiers=@('ALT')});semanticSessionId=$sem;afterSeq=$switchBefore;settleMs=250}
  if([int]$switchAck.appliedEvents -ne 1 -or [int]$switchAck.sentInputs -lt 4){throw 'ALT+TAB SendInput proof missing'}
  if([string]$switchAck.foreground.title -ne $appBTitle){throw "ALT+TAB foreground mismatch: $($switchAck.foreground.title)"}
  if(-not $switchAck.resyncRecommended){throw 'ALT+TAB must recommend semantic resync'}
  $switchEvents=Invoke-Rr 'uia-alt-tab-events' 'semantic-events' @{semanticSessionId=$sem;afterSeq=$switchBefore;limit=100}
  $scopeEvents=@($switchEvents.events|Where-Object { $_.kind -eq 'scope' -and $_.resyncRecommended })
  if($scopeEvents.Count -lt 1){throw 'ALT+TAB scope-change event missing'}

  $b=Wait-Button $sem $appBButton 'uia-b-ready'
  if([string]$b.snapshot.semanticSessionId -ne $sem){throw 'Semantic session changed during ALT+TAB handoff'}
  if([string]$b.snapshot.foreground.title -ne $appBTitle){throw "UIA snapshot did not follow App B foreground: $($b.snapshot.foreground.title)"}
  Write-Host "windows-real-remote-uia-alt-tab-handoff=PASS hwndA=$hwndA hwndB=$hwndB events=$($scopeEvents.Count) semanticSessionId=$sem"
  $bx=[int][Math]::Round([double]$b.button.center.x);$by=[int][Math]::Round([double]$b.button.center.y);$bBefore=[long]$b.snapshot.stateSeq
  $bAck=Invoke-Rr 'uia-b-click' 'input' @{events=@(@{type='move';x=$bx;y=$by},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$bBefore;settleMs=120}
  if([int]$bAck.appliedEvents -ne 2 -or [int]$bAck.sentInputs -lt 2){throw 'App B SendInput proof missing'}
  $bDone=Wait-Button $sem ($appBButton+' Accepted') 'uia-b-accepted'
  Write-Host "windows-real-remote-uia-app-b-input=PASS inputSeq=$($bAck.inputSeq) seq=$($bDone.snapshot.stateSeq)"

  $returnBefore=[long]$bDone.snapshot.stateSeq
  $returnAck=Invoke-Rr 'uia-alt-tab-b-a' 'input' @{events=@(@{type='key';key='TAB';modifiers=@('ALT')});semanticSessionId=$sem;afterSeq=$returnBefore;settleMs=250}
  if([int]$returnAck.appliedEvents -ne 1 -or [int]$returnAck.sentInputs -lt 4){throw 'ALT+TAB return SendInput proof missing'}
  if([string]$returnAck.foreground.title -ne $appATitle){throw "ALT+TAB return foreground mismatch: $($returnAck.foreground.title)"}
  $aReturn=Wait-Button $sem ($appAButton+' Accepted') 'uia-a-return'
  if([string]$aReturn.snapshot.semanticSessionId -ne $sem -or [string]$aReturn.snapshot.foreground.title -ne $appATitle){throw 'UIA semantic session did not return to App A'}
  Write-Host "windows-real-remote-uia-alt-tab-return=PASS inputSeq=$($returnAck.inputSeq) seq=$($aReturn.snapshot.stateSeq)"
  Write-Host 'windows-real-remote-uia-app-switch-closed-loop=PASS'

  $d=Invoke-Rr 'uia-detach' 'semantic-detach' @{semanticSessionId=$sem}
  if(-not $d.detached -or $d.provider -ne 'windows-uia'){throw 'UIA detach failed'};$detached=$true
}finally{
  if($rr){
    if($sem -and -not $detached -and -not $rr.HasExited){try{$null=Invoke-Rr 'uia-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};try{$rr.Dispose()}catch{}
  }
  foreach($p in @($appA,$appB)){
    if($p){try{if(-not $p.HasExited){$p.Kill($true);$null=$p.WaitForExit(3000)}}catch{};try{$p.Dispose()}catch{}}
  }
}
