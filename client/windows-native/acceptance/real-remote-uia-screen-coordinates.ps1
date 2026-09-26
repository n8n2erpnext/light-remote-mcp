param([Parameter(Mandatory=$true)][string]$ClientExe,[int]$TimeoutSeconds=20)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $ClientExe)){throw "Client missing: $ClientExe"}
$ClientExe=(Resolve-Path -LiteralPath $ClientExe).Path
$fixture=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-uia-fixture.ps1')).Path
if(-not('LightRemoteScreenWindow' -as [type])){
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class LightRemoteScreenWindow{
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
function Wait-Window([string]$Title){$d=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$h=[IntPtr]::Zero;while($h -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $d){$h=[LightRemoteScreenWindow]::Find($Title);if($h -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}};if($h -eq [IntPtr]::Zero){throw "Window missing: $Title"};return $h}
$rr=$null;$app=$null;$sem=$null;$detached=$false
function Invoke-RrRaw([string]$Id,[string]$Op,[hashtable]$RequestArgs=@{}){
  $script:rr.StandardInput.WriteLine((@{id=$Id;op=$Op;args=$RequestArgs}|ConvertTo-Json -Compress -Depth 12));$script:rr.StandardInput.Flush()
  $task=$script:rr.StandardOutput.ReadLineAsync();if(-not $task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))){throw "Helper timeout: $Op"}
  $line=$task.Result;if([string]::IsNullOrWhiteSpace($line)){throw "Empty helper response: $Op"};return ($line|ConvertFrom-Json)
}
function Invoke-Rr([string]$Id,[string]$Op,[hashtable]$RequestArgs=@{}){$r=Invoke-RrRaw $Id $Op $RequestArgs;if(-not $r.ok){throw "Helper error $Op : $($r.error)"};return $r.result}
function Wait-Node([string]$Name,[string]$Prefix){
  $d=[DateTime]::UtcNow.AddSeconds(5);$i=0
  do{$i++;$snap=Invoke-Rr ($Prefix+'-'+$i) 'semantic-snapshot' @{semanticSessionId=$sem};$n=@($snap.nodes|Where-Object{$_.name -eq $Name});if($n.Count -eq 1 -and $null -ne $n[0].center){return [pscustomobject]@{snapshot=$snap;node=$n[0]}};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $d)
  throw "UIA node not found: $Name"
}
try{
  $title='Light Remote UIA Screen Coordinates';$button='Light Remote Screen Target'
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=(Get-Command pwsh).Source;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  foreach($a in @('-NoProfile','-STA','-File',$fixture,'-Title',$title,'-ButtonName',$button,'-X','160','-Y','120')){$psi.ArgumentList.Add($a)}
  $app=[Diagnostics.Process]::new();$app.StartInfo=$psi;if(-not $app.Start()){throw 'Fixture start failed'}
  $hwnd=Wait-Window $title;[LightRemoteScreenWindow]::Focus($hwnd);Start-Sleep -Milliseconds 250
  $rpsi=[Diagnostics.ProcessStartInfo]::new();$rpsi.FileName=$ClientExe;$rpsi.UseShellExecute=$false;$rpsi.CreateNoWindow=$true
  $rpsi.RedirectStandardInput=$true;$rpsi.RedirectStandardOutput=$true;$rpsi.RedirectStandardError=$true;$rpsi.ArgumentList.Add('--real-remote-helper')
  $rr=[Diagnostics.Process]::new();$rr.StartInfo=$rpsi;if(-not $rr.Start()){throw 'Helper start failed'}
  $status=Invoke-Rr 'screen-status' 'status'
  $topology=[string]$status.displayTopologyId
  if($topology -notmatch '^[a-f0-9]{64}$'){throw "Invalid display topology id: $topology"}
  if([string]$status.dpiAwareness -ne 'PerMonitorV2'){throw "Unexpected DPI awareness: $($status.dpiAwareness)"}
  $attach=Invoke-Rr 'screen-attach' 'semantic-attach' @{provider='windows-uia';scope='foreground';maxDepth=7;maxNodes=500}
  $sem=[string]$attach.semanticSessionId;if([string]::IsNullOrWhiteSpace($sem)){throw 'Screen coordinate semantic attach failed'}
  $ready=Wait-Node $button 'screen-ready'
  $gx=[int][Math]::Round([double]$ready.node.center.x);$gy=[int][Math]::Round([double]$ready.node.center.y)
  $screens=@($status.screens);if($screens.Count -lt 1){throw 'No screens in helper status'}
  $screen=@($screens|Where-Object{$b=$_.bounds;$gx -ge [int]$b.x -and $gx -lt ([int]$b.x+[int]$b.width) -and $gy -ge [int]$b.y -and $gy -lt ([int]$b.y+[int]$b.height)})|Select-Object -First 1
  if($null -eq $screen){throw "Target center not contained by any screen: $gx,$gy"}
  $screenIndex=[int]$screen.index;$bounds=$screen.bounds
  if($screenIndex -lt 0){throw 'Screen index missing from status'}
  if([int]$screen.dpi.x -lt 1 -or [int]$screen.dpi.y -lt 1){throw 'Screen DPI missing from status'}
  $lx=$gx-[int]$bounds.x;$ly=$gy-[int]$bounds.y
  $frame=Invoke-Rr 'screen-frame' 'frame' @{screen=$screenIndex;maxWidth=480;maxHeight=320;quality=35}
  if([string]$frame.displayTopologyId -ne $topology){throw 'Frame/status display topology mismatch'}
  if([int]$frame.screen.index -ne $screenIndex){throw "Frame screen index mismatch: $($frame.screen.index)"}
  if([int]$frame.screen.bounds.x -ne [int]$bounds.x -or [int]$frame.screen.bounds.y -ne [int]$bounds.y){throw 'Frame/status screen bounds mismatch'}
  if([int]$frame.screen.dpi.x -ne [int]$screen.dpi.x -or [int]$frame.screen.dpi.y -ne [int]$screen.dpi.y){throw 'Frame/status screen DPI mismatch'}
  $map=$frame.inputMapping
  if([string]$map.coordinateSpace -ne 'screen-local' -or [int]$map.screen -ne $screenIndex -or [string]$map.displayTopologyId -ne $topology){throw 'Frame input mapping identity mismatch'}
  if([int]$map.frameWidth -ne [int]$frame.width -or [int]$map.frameHeight -ne [int]$frame.height -or [int]$map.screenWidth -ne [int]$bounds.width -or [int]$map.screenHeight -ne [int]$bounds.height){throw 'Frame input mapping dimensions mismatch'}
  if([string]$map.rounding -ne 'nearest' -or [double]$map.xScale -le 0 -or [double]$map.yScale -le 0){throw 'Frame input mapping scale invalid'}
  $frameX=[int][Math]::Round($lx/[double]$map.xScale);$frameY=[int][Math]::Round($ly/[double]$map.yScale)
  $frameX=[Math]::Max(0,[Math]::Min($frameX,[int]$frame.width-1));$frameY=[Math]::Max(0,[Math]::Min($frameY,[int]$frame.height-1))
  $mappedX=[int][Math]::Round($frameX*[double]$map.xScale);$mappedY=[int][Math]::Round($frameY*[double]$map.yScale)
  if([Math]::Abs($mappedX-$lx) -gt 2 -or [Math]::Abs($mappedY-$ly) -gt 2){throw "Frame input mapping quantization too large source=$lx,$ly mapped=$mappedX,$mappedY"}
  Write-Host "windows-real-remote-screen-topology=PASS index=$screenIndex bounds=$($bounds.x),$($bounds.y),$($bounds.width),$($bounds.height) dpi=$($screen.dpi.x)x$($screen.dpi.y)"
  Write-Host "windows-real-remote-frame-input-map=PASS frame=$frameX,$frameY local=$mappedX,$mappedY source=$lx,$ly scale=$($map.xScale),$($map.yScale)"

  $ack=Invoke-Rr 'screen-local-click' 'input' @{displayTopologyId=$topology;events=@(
    @{type='move';screen=$screenIndex;x=$mappedX;y=$mappedY},
    @{type='click';screen=$screenIndex;x=$mappedX;y=$mappedY;button='left';count=1}
  );semanticSessionId=$sem;afterSeq=[long]$ready.snapshot.stateSeq;settleMs=160}
  if([int]$ack.appliedEvents -ne 2 -or [int]$ack.sentInputs -lt 2){throw 'Screen-local click SendInput proof missing'}
  if([string]$ack.displayTopologyId -ne $topology){throw 'Input ACK display topology mismatch'}
  $expectedMappedGlobalX=[int]$bounds.x+$mappedX;$expectedMappedGlobalY=[int]$bounds.y+$mappedY
  if([int]$ack.cursor.x -ne $expectedMappedGlobalX -or [int]$ack.cursor.y -ne $expectedMappedGlobalY){throw "Frame-mapped cursor translation mismatch actual=$($ack.cursor.x),$($ack.cursor.y) expected=$expectedMappedGlobalX,$expectedMappedGlobalY"}
  $accepted=Wait-Node "$button Accepted" 'screen-accepted'
  if([string]$accepted.snapshot.semanticSessionId -ne $sem){throw 'Screen-local click changed semantic session'}
  Write-Host "windows-real-remote-screen-local-click=PASS screen=$screenIndex local=$mappedX,$mappedY global=$expectedMappedGlobalX,$expectedMappedGlobalY inputSeq=$($ack.inputSeq)"

  $dragToLx=[Math]::Min($lx+4,[int]$bounds.width-1);$dragToLy=[Math]::Min($ly+4,[int]$bounds.height-1)
  $dragAck=Invoke-Rr 'screen-local-drag' 'input' @{displayTopologyId=$topology;events=@(
    @{type='drag';screen=$screenIndex;x=$lx;y=$ly;toScreen=$screenIndex;toX=$dragToLx;toY=$dragToLy;button='left';steps=3;durationMs=60}
  );semanticSessionId=$sem;afterSeq=[long]$accepted.snapshot.stateSeq;settleMs=80}
  $expectedDragX=[int]$bounds.x+$dragToLx;$expectedDragY=[int]$bounds.y+$dragToLy
  if([int]$dragAck.sentInputs -lt 2 -or [int]$dragAck.cursor.x -ne $expectedDragX -or [int]$dragAck.cursor.y -ne $expectedDragY){throw 'Screen-local drag translation mismatch'}
  if([string]$dragAck.displayTopologyId -ne $topology){throw 'Drag ACK display topology mismatch'}
  Write-Host "windows-real-remote-screen-local-drag=PASS screen=$screenIndex local=$lx,$ly->$dragToLx,$dragToLy global=$gx,$gy->$expectedDragX,$expectedDragY"

  $staleTopology=('0'*64)
  if($staleTopology -eq $topology){$staleTopology=('f'*64)}
  $stale=Invoke-RrRaw 'screen-stale-topology' 'input' @{displayTopologyId=$staleTopology;events=@(@{type='move';screen=$screenIndex;x=$lx;y=$ly})}
  if($stale.ok -or [string]$stale.error -ne 'desktop_input_stale_topology'){throw "Stale display topology was not rejected: $($stale.error)"}
  Write-Host "windows-real-remote-screen-topology-pin=PASS topology=$topology"

  $badScreen=Invoke-RrRaw 'screen-invalid-index' 'input' @{events=@(@{type='move';screen=$screens.Count;x=0;y=0})}
  if($badScreen.ok -or [string]$badScreen.error -ne 'desktop_input_screen_out_of_range'){throw "Invalid screen index was not rejected: $($badScreen.error)"}
  $badBounds=Invoke-RrRaw 'screen-invalid-bounds' 'input' @{events=@(@{type='move';screen=$screenIndex;x=[int]$bounds.width;y=0})}
  if($badBounds.ok -or [string]$badBounds.error -ne 'desktop_input_invalid_screen_coordinates'){throw "Out-of-bounds screen coordinate was not rejected: $($badBounds.error)"}
  Write-Host 'windows-real-remote-screen-local-negative=PASS'
  Write-Host 'windows-real-remote-screen-local-closed-loop=PASS'

  $d=Invoke-Rr 'screen-detach' 'semantic-detach' @{semanticSessionId=$sem};if(-not $d.detached -or $d.provider -ne 'windows-uia'){throw 'Screen coordinate detach failed'};$detached=$true
}finally{
  if($rr){
    if($sem -and -not $detached -and -not $rr.HasExited){try{$null=Invoke-Rr 'screen-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};try{$rr.Dispose()}catch{}
  }
  if($app){try{if(-not $app.HasExited){$app.Kill($true);$null=$app.WaitForExit(3000)}}catch{};try{$app.Dispose()}catch{}}
}
