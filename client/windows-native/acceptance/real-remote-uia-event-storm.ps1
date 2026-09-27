param([Parameter(Mandatory=$true)][string]$ClientExe,[int]$TimeoutSeconds=25)
$ErrorActionPreference='Stop'
$ClientExe=(Resolve-Path -LiteralPath $ClientExe).Path
$fixture=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-uia-event-storm-fixture.ps1')).Path
if(-not('LightRemoteEventStormWindow' -as [type])){
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class LightRemoteEventStormWindow{
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
$title='Light Remote UIA Event Storm';$p=$null;$rr=$null;$sem=$null
function Invoke-Rr([string]$Id,[string]$Op,[hashtable]$RequestArgs=@{}){
  $script:rr.StandardInput.WriteLine((@{id=$Id;op=$Op;args=$RequestArgs}|ConvertTo-Json -Compress -Depth 12));$script:rr.StandardInput.Flush()
  $task=$script:rr.StandardOutput.ReadLineAsync();if(-not $task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))){throw "Helper timeout: $Op"}
  $line=$task.Result;if([string]::IsNullOrWhiteSpace($line)){throw "Empty helper response: $Op"}
  $r=$line|ConvertFrom-Json;if(-not $r.ok){throw "Helper error $Op : $($r.error)"};return $r.result
}
try{
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=(Get-Command pwsh).Source;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  foreach($arg in @('-NoProfile','-STA','-WindowStyle','Hidden','-File',$fixture,'-Title',$title)){$psi.ArgumentList.Add($arg)}
  $p=[Diagnostics.Process]::new();$p.StartInfo=$psi;if(-not $p.Start()){throw 'Fixture start failed'}
  $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds);$h=[IntPtr]::Zero
  while($h -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline){$h=[LightRemoteEventStormWindow]::FindExact($title);if($h -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}}
  if($h -eq [IntPtr]::Zero){throw 'Fixture window missing'};[LightRemoteEventStormWindow]::Focus($h);Start-Sleep -Milliseconds 250

  $rrPsi=[Diagnostics.ProcessStartInfo]::new();$rrPsi.FileName=$ClientExe;$rrPsi.UseShellExecute=$false;$rrPsi.CreateNoWindow=$true;$rrPsi.RedirectStandardInput=$true;$rrPsi.RedirectStandardOutput=$true;$rrPsi.RedirectStandardError=$true;$rrPsi.ArgumentList.Add('--real-remote-helper')
  $rr=[Diagnostics.Process]::new();$rr.StartInfo=$rrPsi;if(-not $rr.Start()){throw 'Helper start failed'}
  $obs=Invoke-Rr 'storm-open' 'observe' @{provider='windows-uia';scope='foreground';maxDepth=7;maxNodes=500}
  $sem=[string]$obs.semanticSessionId;if([string]::IsNullOrWhiteSpace($sem)){throw 'Semantic session missing'}
  $button=@($obs.nodes|Where-Object{$_.role -eq 'Button' -and $_.name -eq 'Burst Structure Events'})
  if($button.Count -ne 1 -or -not(@($button[0].actions)-contains 'invoke')){throw 'Burst button missing or not invokable'}
  $before=[long]$obs.stateSeq
  $act=Invoke-Rr 'storm-act' 'act' @{semanticSessionId=$sem;nodeId=[string]$button[0].id;action='invoke';afterSeq=$before;settleMs=250}
  if($act.method -ne 'uia.invoke'){throw 'Burst invoke failed'}
  $events=Invoke-Rr 'storm-events' 'observe' @{semanticSessionId=$sem;afterSeq=$before;limit=200}
  $structure=@($events.events|Where-Object{$_.kind -eq 'structure'})
  if($structure.Count -lt 1){throw 'No structure evidence captured'}
  if($structure.Count -ge 40){throw "Structure burst not compacted: $($structure.Count)"}
  if(@($structure|Where-Object{$null -ne $_.element}).Count -gt 0){throw 'Structure events must remain lightweight'}
  if(@($structure|Where-Object{$_.change -ne 'subtree-changed'}).Count -gt 0){throw 'Structure change normalization failed'}
  $maxCoal=($structure|Measure-Object -Property coalesced -Maximum).Maximum
  if([int]$maxCoal -lt 2){throw 'Structure burst did not coalesce'}
  if(-not $events.resyncRecommended -or [string]$events.nextObservation.mode -ne 'snapshot'){throw 'Structure burst must request snapshot resync'}
  if(@($events.events|Where-Object{$_.property -match 'BoundingRectangle|IsOffscreen'}).Count -gt 0){throw 'Layout-only property noise leaked into journal'}
  Write-Host "windows-real-remote-uia-event-storm=PASS structures=$($structure.Count) maxCoalesced=$maxCoal total=$(@($events.events).Count) stateSeq=$($events.stateSeq)"
  $null=Invoke-Rr 'storm-detach' 'semantic-detach' @{semanticSessionId=$sem};$sem=$null
}finally{
  if($sem -and $rr -and -not $rr.HasExited){try{$null=Invoke-Rr 'storm-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
  if($rr){try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};try{$rr.Dispose()}catch{}}
  if($p){try{if(-not $p.HasExited){$p.Kill($true);$null=$p.WaitForExit(3000)}}catch{};try{$p.Dispose()}catch{}}
}
