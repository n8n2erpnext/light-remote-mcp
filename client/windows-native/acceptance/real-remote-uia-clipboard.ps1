param([Parameter(Mandatory=$true)][string]$ClientExe,[int]$TimeoutSeconds=20)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $ClientExe)){throw "Client missing: $ClientExe"}
$ClientExe=(Resolve-Path -LiteralPath $ClientExe).Path
$fixture=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-uia-clipboard-fixture.ps1')).Path
if(-not('LightRemoteClipboardWindow' -as [type])){
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class LightRemoteClipboardWindow{
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
function Wait-Window([string]$Title){$deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$h=[IntPtr]::Zero;while($h -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline){$h=[LightRemoteClipboardWindow]::Find($Title);if($h -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}};if($h -eq [IntPtr]::Zero){throw "Window missing: $Title"};return $h}
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
  $title='Light Remote UIA Clipboard'
  $fixtureProcess=Start-Process -FilePath (Get-Command pwsh).Source -ArgumentList @('-NoProfile','-STA','-File',$fixture) -PassThru
  $hwnd=Wait-Window $title
  [LightRemoteClipboardWindow]::Focus($hwnd);Start-Sleep -Milliseconds 250
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$ClientExe;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  $psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.ArgumentList.Add('--real-remote-helper')
  $rr=[Diagnostics.Process]::new();$rr.StartInfo=$psi;if(-not $rr.Start()){throw 'Helper start failed'}
  $attach=Invoke-Rr 'clipboard-attach' 'semantic-attach' @{provider='windows-uia';scope='foreground';maxDepth=7;maxNodes=500}
  $sem=[string]$attach.semanticSessionId
  if($attach.provider -ne 'windows-uia' -or [string]::IsNullOrWhiteSpace($sem)){throw 'UIA clipboard attach failed'}
  $source=Wait-Node $sem 'Edit' 'Light Remote Clipboard Source' 'clipboard-source-ready'
  $rootHwnd=[string]$source.snapshot.nodes[0].hwnd;$rootPid=[int]$source.snapshot.nodes[0].processId
  if($rootPid -ne $fixtureProcess.Id){throw "Clipboard fixture PID mismatch actual=$rootPid expected=$($fixtureProcess.Id)"}
  $clipboardText='Light Remote Clipboard OK'
  $sx=[int][Math]::Round([double]$source.node.center.x);$sy=[int][Math]::Round([double]$source.node.center.y);$typeBefore=[long]$source.snapshot.stateSeq
  $typeAck=Invoke-Rr 'clipboard-type-source' 'input' @{events=@(@{type='move';x=$sx;y=$sy},@{type='click';button='left';count=1},@{type='text';text=$clipboardText});semanticSessionId=$sem;afterSeq=$typeBefore;settleMs=150}
  if([int]$typeAck.appliedEvents -ne 3 -or [int]$typeAck.sentInputs -lt (2+($clipboardText.Length*2))){throw 'Clipboard source SendInput proof missing'}
  $sourceDone=Wait-Node $sem 'Edit' 'Light Remote Clipboard Source Filled' 'clipboard-source-filled'
  if([string]$sourceDone.snapshot.semanticSessionId -ne $sem -or [string]$sourceDone.snapshot.nodes[0].hwnd -ne $rootHwnd){throw 'Clipboard source changed semantic session/root'}

  $destinations=@($sourceDone.snapshot.nodes|Where-Object { $_.role -eq 'Edit' -and $_.name -eq 'Light Remote Clipboard Destination' })
  if($destinations.Count -ne 1 -or $null -eq $destinations[0].center){throw "Clipboard destination semantic center missing count=$($destinations.Count)"}
  $dx=[int][Math]::Round([double]$destinations[0].center.x);$dy=[int][Math]::Round([double]$destinations[0].center.y)
  $copyBefore=[long]$sourceDone.snapshot.stateSeq
  $copyAck=Invoke-Rr 'clipboard-copy' 'input' @{events=@(@{type='key';key='A';modifiers=@('CTRL')},@{type='key';key='C';modifiers=@('CTRL')});semanticSessionId=$sem;afterSeq=$copyBefore;settleMs=150}
  if([int]$copyAck.appliedEvents -ne 2 -or [int]$copyAck.sentInputs -lt 8){throw "Clipboard copy SendInput proof missing applied=$($copyAck.appliedEvents) sent=$($copyAck.sentInputs)"}
  Write-Host "windows-real-remote-uia-clipboard-copy=PASS sentInputs=$($copyAck.sentInputs) inputSeq=$($copyAck.inputSeq) semanticSessionId=$sem"

  $pasteAck=Invoke-Rr 'clipboard-paste' 'input' @{events=@(@{type='move';x=$dx;y=$dy},@{type='click';button='left';count=1},@{type='key';key='V';modifiers=@('CTRL')});semanticSessionId=$sem;afterSeq=[long]$copyAck.stateSeq;settleMs=180}
  if([int]$pasteAck.appliedEvents -ne 3 -or [int]$pasteAck.sentInputs -lt 6){throw "Clipboard paste SendInput proof missing applied=$($pasteAck.appliedEvents) sent=$($pasteAck.sentInputs)"}
  $pasteDone=Wait-Node $sem 'Edit' 'Light Remote Clipboard Paste Accepted' 'clipboard-paste-accepted'
  if([string]$pasteDone.snapshot.semanticSessionId -ne $sem -or [string]$pasteDone.snapshot.nodes[0].hwnd -ne $rootHwnd){throw 'Clipboard paste changed semantic session/root'}
  $acceptedStatus=@($pasteDone.snapshot.nodes|Where-Object { $_.name -eq 'Light Remote Clipboard Accepted' })
  if($acceptedStatus.Count -lt 1){throw 'Clipboard accepted status missing'}
  Write-Host "windows-real-remote-uia-clipboard-paste=PASS sentInputs=$($pasteAck.sentInputs) inputSeq=$($pasteAck.inputSeq) seq=$($pasteDone.snapshot.stateSeq)"
  Write-Host 'windows-real-remote-uia-clipboard-closed-loop=PASS'
  $d=Invoke-Rr 'clipboard-detach' 'semantic-detach' @{semanticSessionId=$sem}
  if(-not $d.detached -or $d.provider -ne 'windows-uia'){throw 'UIA clipboard detach failed'};$detached=$true
}finally{
  if($rr){
    if($sem -and -not $detached -and -not $rr.HasExited){try{$null=Invoke-Rr 'clipboard-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};try{$rr.Dispose()}catch{}
  }
  if($fixtureProcess){try{if(-not $fixtureProcess.HasExited){$fixtureProcess.Kill($true);$null=$fixtureProcess.WaitForExit(3000)}}catch{};try{$fixtureProcess.Dispose()}catch{}}
}
