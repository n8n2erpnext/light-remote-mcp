param([Parameter(Mandatory=$true)][string]$ClientExe,[int]$TimeoutSeconds=20)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $ClientExe)){throw "Client missing: $ClientExe"}
$ClientExe=(Resolve-Path -LiteralPath $ClientExe).Path
$fixture=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-uia-drag-drop-fixture.ps1')).Path
if(-not('LightRemoteDragWindow' -as [type])){
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class LightRemoteDragWindow{
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
function Wait-Window([string]$Title){$deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$h=[IntPtr]::Zero;while($h -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline){$h=[LightRemoteDragWindow]::Find($Title);if($h -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}};if($h -eq [IntPtr]::Zero){throw "Window missing: $Title"};return $h}
$rr=$null;$fixtureProcess=$null;$sem=$null;$detached=$false
function Invoke-Rr([string]$Id,[string]$Op,[hashtable]$RequestArgs=@{}){
  $script:rr.StandardInput.WriteLine((@{id=$Id;op=$Op;args=$RequestArgs}|ConvertTo-Json -Compress -Depth 12));$script:rr.StandardInput.Flush()
  $task=$script:rr.StandardOutput.ReadLineAsync()
  if(-not $task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))){throw "Helper timeout: $Op"}
  $line=$task.Result;if([string]::IsNullOrWhiteSpace($line)){throw "Empty helper response: $Op"}
  $r=$line|ConvertFrom-Json;if(-not $r.ok){throw "Helper error $Op : $($r.error)"};return $r.result
}
function Wait-Node([string]$SessionId,[string]$Role,[string]$Name,[string]$Prefix){
  $deadline=[DateTime]::UtcNow.AddSeconds(5);$attempt=0
  do{
    $attempt++
    try{
      $snap=Invoke-Rr ($Prefix+'-'+$attempt) 'semantic-snapshot' @{semanticSessionId=$SessionId}
      $nodes=@($snap.nodes|Where-Object { $_.role -eq $Role -and $_.name -eq $Name })
      if($nodes.Count -eq 1 -and $null -ne $nodes[0].center){return [pscustomobject]@{snapshot=$snap;node=$nodes[0]}}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $deadline)
  throw "UIA node not found: $Role / $Name"
}
try{
  $title='Light Remote UIA Drag Drop'
  $fixtureProcess=Start-Process -FilePath (Get-Command pwsh).Source -ArgumentList @('-NoProfile','-STA','-File',$fixture) -PassThru
  $hwnd=Wait-Window $title
  [LightRemoteDragWindow]::Focus($hwnd);Start-Sleep -Milliseconds 250

  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$ClientExe;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  $psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.ArgumentList.Add('--real-remote-helper')
  $rr=[Diagnostics.Process]::new();$rr.StartInfo=$psi;if(-not $rr.Start()){throw 'Helper start failed'}
  $attach=Invoke-Rr 'drag-attach' 'semantic-attach' @{provider='windows-uia';scope='foreground';maxDepth=7;maxNodes=500}
  $sem=[string]$attach.semanticSessionId
  if($attach.provider -ne 'windows-uia' -or [string]::IsNullOrWhiteSpace($sem)){throw 'UIA drag attach failed'}

  $source=Wait-Node $sem 'Button' 'Light Remote Drag Source' 'drag-source-ready'
  $targets=@($source.snapshot.nodes|Where-Object { $_.role -eq 'Button' -and $_.name -eq 'Light Remote Drop Target' })
  if($targets.Count -ne 1 -or $null -eq $targets[0].center){throw "Drop target semantic center missing count=$($targets.Count)"}
  $rootHwnd=[string]$source.snapshot.nodes[0].hwnd;$rootPid=[int]$source.snapshot.nodes[0].processId
  if($rootPid -ne $fixtureProcess.Id){throw "Drag fixture PID mismatch actual=$rootPid expected=$($fixtureProcess.Id)"}

  $sx=[int][Math]::Round([double]$source.node.center.x);$sy=[int][Math]::Round([double]$source.node.center.y)
  $tx=[int][Math]::Round([double]$targets[0].center.x);$ty=[int][Math]::Round([double]$targets[0].center.y)
  $beforeSeq=[long]$source.snapshot.stateSeq
  $dragAck=Invoke-Rr 'drag-drop-input' 'input' @{events=@(@{type='drag';x=$sx;y=$sy;toX=$tx;toY=$ty;button='left';steps=12;durationMs=360});semanticSessionId=$sem;afterSeq=$beforeSeq;settleMs=180}
  if([int]$dragAck.appliedEvents -ne 1 -or [int]$dragAck.sentInputs -ne 2){throw "Drag SendInput proof missing applied=$($dragAck.appliedEvents) sent=$($dragAck.sentInputs)"}
  if($null -eq $dragAck.cursor -or [int]$dragAck.cursor.x -ne $tx -or [int]$dragAck.cursor.y -ne $ty){throw "Drag cursor end mismatch actual=$($dragAck.cursor.x),$($dragAck.cursor.y) expected=$tx,$ty"}
  if([string]$dragAck.semanticSessionId -ne $sem){throw 'Drag changed semantic session'}

  $accepted=Wait-Node $sem 'Button' 'Light Remote Drag Accepted' 'drag-accepted'
  $dropAccepted=@($accepted.snapshot.nodes|Where-Object { $_.role -eq 'Button' -and $_.name -eq 'Light Remote Drop Accepted' })
  $statusAccepted=@($accepted.snapshot.nodes|Where-Object { $_.name -eq 'Light Remote Drag Drop Accepted' })
  if($dropAccepted.Count -ne 1 -or $statusAccepted.Count -lt 1){throw 'Drag/drop semantic accepted state missing'}
  if([string]$accepted.snapshot.semanticSessionId -ne $sem -or [string]$accepted.snapshot.nodes[0].hwnd -ne $rootHwnd){throw 'Drag/drop changed semantic session/root'}
  Write-Host "windows-real-remote-uia-drag-drop=PASS sentInputs=$($dragAck.sentInputs) inputSeq=$($dragAck.inputSeq) from=$sx,$sy to=$tx,$ty seq=$($accepted.snapshot.stateSeq)"
  Write-Host 'windows-real-remote-uia-drag-drop-closed-loop=PASS'

  $d=Invoke-Rr 'drag-detach' 'semantic-detach' @{semanticSessionId=$sem}
  if(-not $d.detached -or $d.provider -ne 'windows-uia'){throw 'UIA drag detach failed'};$detached=$true
}finally{
  if($rr){
    if($sem -and -not $detached -and -not $rr.HasExited){try{$null=Invoke-Rr 'drag-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};try{$rr.Dispose()}catch{}
  }
  if($fixtureProcess){try{if(-not $fixtureProcess.HasExited){$fixtureProcess.Kill($true);$null=$fixtureProcess.WaitForExit(3000)}}catch{};try{$fixtureProcess.Dispose()}catch{}}
}
