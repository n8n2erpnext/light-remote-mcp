param([Parameter(Mandatory=$true)][string]$ClientExe,[int]$TimeoutSeconds=20)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $ClientExe)){throw "Client missing: $ClientExe"}
$ClientExe=(Resolve-Path -LiteralPath $ClientExe).Path
$fixture=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-uia-mouse-buttons-fixture.ps1')).Path
if(-not('LightRemoteMouseButtonsWindow' -as [type])){
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class LightRemoteMouseButtonsWindow{
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
function Wait-Window([string]$Title){$deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$h=[IntPtr]::Zero;while($h -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline){$h=[LightRemoteMouseButtonsWindow]::Find($Title);if($h -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}};if($h -eq [IntPtr]::Zero){throw "Window missing: $Title"};return $h}
$rr=$null;$fixtureProcess=$null;$sem=$null;$detached=$false
function Invoke-Rr([string]$Id,[string]$Op,[hashtable]$RequestArgs=@{}){
  $script:rr.StandardInput.WriteLine((@{id=$Id;op=$Op;args=$RequestArgs}|ConvertTo-Json -Compress -Depth 12));$script:rr.StandardInput.Flush()
  $task=$script:rr.StandardOutput.ReadLineAsync()
  if(-not $task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))){throw "Helper timeout: $Op"}
  $line=$task.Result;if([string]::IsNullOrWhiteSpace($line)){throw "Empty helper response: $Op"}
  $r=$line|ConvertFrom-Json;if(-not $r.ok){throw "Helper error $Op : $($r.error)"};return $r.result
}
function Wait-Node([string]$SessionId,[string]$Name,[string]$Prefix,[bool]$RequireCenter=$false){
  $deadline=[DateTime]::UtcNow.AddSeconds(5);$attempt=0
  do{
    $attempt++
    try{
      $snap=Invoke-Rr ($Prefix+'-'+$attempt) 'semantic-snapshot' @{semanticSessionId=$SessionId}
      $nodes=@($snap.nodes|Where-Object { $_.name -eq $Name })
      if($nodes.Count -eq 1 -and (-not $RequireCenter -or $null -ne $nodes[0].center)){return [pscustomobject]@{snapshot=$snap;node=$nodes[0]}}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $deadline)
  throw "UIA node not found: $Name"
}
try{
  $title='Light Remote UIA Mouse Buttons'
  $fixtureProcess=Start-Process -FilePath (Get-Command pwsh).Source -ArgumentList @('-NoProfile','-STA','-File',$fixture) -PassThru
  $hwnd=Wait-Window $title
  [LightRemoteMouseButtonsWindow]::Focus($hwnd);Start-Sleep -Milliseconds 250
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$ClientExe;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  $psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.ArgumentList.Add('--real-remote-helper')
  $rr=[Diagnostics.Process]::new();$rr.StartInfo=$psi;if(-not $rr.Start()){throw 'Helper start failed'}
  $attach=Invoke-Rr 'mouse-buttons-attach' 'semantic-attach' @{provider='windows-uia';scope='foreground';maxDepth=7;maxNodes=500}
  $sem=[string]$attach.semanticSessionId
  if($attach.provider -ne 'windows-uia' -or [string]::IsNullOrWhiteSpace($sem)){throw 'UIA mouse-buttons attach failed'}
  $target=Wait-Node $sem 'Light Remote Context Target' 'mouse-target-ready' $true
  $rootHwnd=[string]$target.snapshot.nodes[0].hwnd;$rootPid=[int]$target.snapshot.nodes[0].processId
  if($rootPid -ne $fixtureProcess.Id){throw "Mouse fixture PID mismatch actual=$rootPid expected=$($fixtureProcess.Id)"}
  $x=[int][Math]::Round([double]$target.node.center.x);$y=[int][Math]::Round([double]$target.node.center.y)
  $rightAck=Invoke-Rr 'mouse-right-click' 'input' @{events=@(@{type='click';button='right';count=1;x=$x;y=$y});semanticSessionId=$sem;afterSeq=[long]$target.snapshot.stateSeq;settleMs=180}
  if([int]$rightAck.appliedEvents -ne 1 -or [int]$rightAck.sentInputs -lt 2){throw "Right-click SendInput proof missing applied=$($rightAck.appliedEvents) sent=$($rightAck.sentInputs)"}
  $contextOpen=Wait-Node $sem 'Light Remote Context Open' 'context-open'
  if([string]$contextOpen.snapshot.semanticSessionId -ne $sem){throw 'Semantic session changed after right-click'}
  Write-Host "windows-real-remote-uia-right-click-context-open=PASS sentInputs=$($rightAck.sentInputs) inputSeq=$($rightAck.inputSeq) semanticSessionId=$sem"

  $menuAck=Invoke-Rr 'mouse-context-select' 'input' @{events=@(@{type='key';key='DOWN';modifiers=@()},@{type='key';key='ENTER';modifiers=@()});semanticSessionId=$sem;afterSeq=[long]$contextOpen.snapshot.stateSeq;settleMs=180}
  if([int]$menuAck.appliedEvents -ne 2 -or [int]$menuAck.sentInputs -lt 4){throw "Context keyboard selection proof missing applied=$($menuAck.appliedEvents) sent=$($menuAck.sentInputs)"}
  $contextAccepted=Wait-Node $sem 'Light Remote Context Accepted' 'context-accepted' $true
  if([string]$contextAccepted.snapshot.nodes[0].hwnd -ne $rootHwnd){throw 'Context menu selection changed parent UIA root'}
  Write-Host "windows-real-remote-uia-context-menu-select=PASS sentInputs=$($menuAck.sentInputs) inputSeq=$($menuAck.inputSeq) seq=$($contextAccepted.snapshot.stateSeq)"

  $mx=[int][Math]::Round([double]$contextAccepted.node.center.x);$my=[int][Math]::Round([double]$contextAccepted.node.center.y)
  $middleAck=Invoke-Rr 'mouse-middle-click' 'input' @{events=@(@{type='click';button='middle';count=1;x=$mx;y=$my});semanticSessionId=$sem;afterSeq=[long]$contextAccepted.snapshot.stateSeq;settleMs=150}
  if([int]$middleAck.appliedEvents -ne 1 -or [int]$middleAck.sentInputs -lt 2){throw "Middle-click SendInput proof missing applied=$($middleAck.appliedEvents) sent=$($middleAck.sentInputs)"}
  $middleAccepted=Wait-Node $sem 'Light Remote Middle Accepted' 'middle-accepted' $true
  if([string]$middleAccepted.snapshot.semanticSessionId -ne $sem -or [string]$middleAccepted.snapshot.nodes[0].hwnd -ne $rootHwnd){throw 'Middle click changed semantic session/root'}
  Write-Host "windows-real-remote-uia-middle-click=PASS sentInputs=$($middleAck.sentInputs) inputSeq=$($middleAck.inputSeq) seq=$($middleAccepted.snapshot.stateSeq)"
  Write-Host 'windows-real-remote-uia-mouse-buttons-closed-loop=PASS'

  $d=Invoke-Rr 'mouse-buttons-detach' 'semantic-detach' @{semanticSessionId=$sem}
  if(-not $d.detached -or $d.provider -ne 'windows-uia'){throw 'UIA mouse-buttons detach failed'};$detached=$true
}finally{
  if($rr){
    if($sem -and -not $detached -and -not $rr.HasExited){try{$null=Invoke-Rr 'mouse-buttons-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};try{$rr.Dispose()}catch{}
  }
  if($fixtureProcess){try{if(-not $fixtureProcess.HasExited){$fixtureProcess.Kill($true);$null=$fixtureProcess.WaitForExit(3000)}}catch{};try{$fixtureProcess.Dispose()}catch{}}
}
