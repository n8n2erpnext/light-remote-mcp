param(
  [Parameter(Mandatory=$true)][string]$ClientExe,
  [string]$BrowserExe='',
  [int]$TimeoutSeconds=30
)
$ErrorActionPreference='Stop'

function Find-Browser([string]$Explicit){
  if($Explicit){if(-not(Test-Path -LiteralPath $Explicit)){throw "Browser not found: $Explicit"};return(Resolve-Path -LiteralPath $Explicit).Path}
  $roots=@($env:ProgramFiles,[Environment]::GetFolderPath('ProgramFilesX86'),$env:LOCALAPPDATA)|Where-Object{$_}
  foreach($root in $roots){foreach($rel in @('Google\Chrome\Application\chrome.exe','Microsoft\Edge\Application\msedge.exe')){$p=Join-Path $root $rel;if(Test-Path -LiteralPath $p){return(Resolve-Path -LiteralPath $p).Path}}}
  throw 'Chromium browser missing'
}
if(-not(Test-Path -LiteralPath $ClientExe)){throw "Client missing: $ClientExe"}
$ClientExe=(Resolve-Path -LiteralPath $ClientExe).Path
$BrowserExe=Find-Browser $BrowserExe
$fixture=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-browser-os-input.html')).Path
$fixtureUrl=([Uri]::new($fixture)).AbsoluteUri
$profile=Join-Path $env:TEMP ('light-remote-real-windows-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $profile|Out-Null

if(-not('LightRemoteAcceptanceWindow' -as [type])){
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class LightRemoteAcceptanceWindow{
 delegate bool P(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]static extern bool EnumWindows(P p,IntPtr x);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 public static IntPtr Find(string n){IntPtr f=IntPtr.Zero;EnumWindows((h,_)=>{if(!IsWindowVisible(h))return true;var s=new StringBuilder(1024);GetWindowText(h,s,s.Capacity);if(s.ToString().IndexOf(n,StringComparison.OrdinalIgnoreCase)>=0){f=h;return false;}return true;},IntPtr.Zero);return f;}
 public static void Focus(IntPtr h){if(h!=IntPtr.Zero){ShowWindow(h,3);SetForegroundWindow(h);}}
}
'@
}

$browser=$null;$rr=$null;$sem=$null;$detached=$false
function Invoke-Rr([string]$Id,[string]$Op,[hashtable]$Args=@{}){
  $script:rr.StandardInput.WriteLine((@{id=$Id;op=$Op;args=$Args}|ConvertTo-Json -Compress -Depth 12));$script:rr.StandardInput.Flush()
  $task=$script:rr.StandardOutput.ReadLineAsync()
  if(-not $task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))){throw "Helper timeout: $Op"}
  $line=$task.Result;if([string]::IsNullOrWhiteSpace($line)){throw "Empty helper response: $Op"}
  $r=$line|ConvertFrom-Json;if(-not $r.ok){throw "Helper error $Op : $($r.error)"};return$r.result
}

try{
  $args=@('--remote-debugging-port=0','--remote-allow-origins=*','--disable-background-networking','--disable-default-apps','--no-first-run','--no-default-browser-check','--new-window','--start-maximized',"--user-data-dir=$profile",$fixtureUrl)
  $browser=Start-Process -FilePath $BrowserExe -ArgumentList $args -PassThru
  $portFile=Join-Path $profile 'DevToolsActivePort';$deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while(-not (Test-Path -LiteralPath $portFile) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
  if(-not(Test-Path -LiteralPath $portFile)){throw 'DevToolsActivePort missing'}
  $port=[int]((Get-Content -LiteralPath $portFile -TotalCount 1).Trim());if($port -lt 1 -or $port -gt 65535){throw "Bad CDP port: $port"}
  $endpoint="http://127.0.0.1:$port"
  $hwnd=[IntPtr]::Zero;$deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while($hwnd -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline){$hwnd=[LightRemoteAcceptanceWindow]::Find('Light Remote OS Input Acceptance');if($hwnd -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}}
  if($hwnd -eq [IntPtr]::Zero){throw 'Visible acceptance window missing'}
  [LightRemoteAcceptanceWindow]::Focus($hwnd);Start-Sleep -Milliseconds 500

  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$ClientExe;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.ArgumentList.Add('--real-remote-helper')
  $rr=[Diagnostics.Process]::new();$rr.StartInfo=$psi;if(-not $rr.Start()){throw 'Helper start failed'}
  $status=Invoke-Rr 'accept-status' 'status'
  if(-not $status.interactive -or $status.platform -ne 'win32' -or @($status.screens).Count -lt 1){throw 'Interactive Windows desktop required'}
  if([string]$status.foreground.title -notlike '*Light Remote OS Input Acceptance*'){throw "Acceptance browser is not foreground: $($status.foreground.title)"}

  $attach=Invoke-Rr 'accept-attach' 'semantic-attach' @{provider='browser-cdp';cdpEndpoint=$endpoint;urlMatch='real-remote-browser-os-input.html';maxDepth=8;maxNodes=600}
  $sem=[string]$attach.semanticSessionId;if($attach.provider -ne 'browser-cdp' -or [string]::IsNullOrWhiteSpace($sem)){throw 'browser-cdp attach failed'}
  $before=Invoke-Rr 'accept-before' 'semantic-snapshot' @{semanticSessionId=$sem}
  if($before.provider -ne 'browser-cdp' -or -not $before.viewport.screenEstimateAvailable){throw 'No browser screen estimate'}
  $nodes=@($before.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote OS Input' })
  if($nodes.Count -ne 1){throw "Acceptance button count=$($nodes.Count)"}
  $button=$nodes[0];if($button.coordinateSpace -ne 'screen-dip-estimate' -or $null -eq $button.center){throw "Bad coordinate space: $($button.coordinateSpace)"}
  $x=[int][Math]::Round([double]$button.center.x);$y=[int][Math]::Round([double]$button.center.y);$beforeSeq=[long]$before.stateSeq

  $ack=Invoke-Rr 'accept-os-click' 'input' @{events=@(@{type='move';x=$x;y=$y},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$beforeSeq;settleMs=150}
  if($ack.provider -ne 'browser-cdp' -or $ack.observation -ne 'cdp-snapshot+journal'){throw 'CDP ACK contract mismatch'}
  if([int]$ack.appliedEvents -ne 2 -or [int]$ack.sentInputs -lt 2){throw "SendInput proof missing applied=$($ack.appliedEvents) sent=$($ack.sentInputs)"}
  if([long]$ack.stateSeq -le $beforeSeq -or $ack.gap -or $ack.resyncRecommended){throw 'CDP ACK did not advance cleanly'}

  $after=Invoke-Rr 'accept-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $accepted=@($after.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Accepted' })
  if($accepted.Count -ne 1){throw 'OS click did not change browser semantic state'}
  if([long]$after.stateSeq -le [long]$ack.stateSeq){throw 'Post-click stateSeq did not advance'}

  Write-Host "windows-real-remote-os-input=PASS sentInputs=$($ack.sentInputs) x=$x y=$y"
  Write-Host "windows-real-remote-cdp-ack=PASS inputSeq=$($ack.inputSeq) beforeSeq=$beforeSeq ackSeq=$($ack.stateSeq)"
  Write-Host "windows-real-remote-browser-state-change=PASS name=Light Remote Accepted seq=$($after.stateSeq)"
  $d=Invoke-Rr 'accept-detach' 'semantic-detach' @{semanticSessionId=$sem};if(-not $d.detached -or $d.provider -ne 'browser-cdp'){throw 'Detach failed'};$detached=$true
  Write-Host 'windows-real-remote-browser-os-input-acceptance=PASS'
}finally{
  if($rr){
    if($sem -and -not $detached -and -not $rr.HasExited){try{$null=Invoke-Rr 'accept-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};$rr.Dispose()
  }
  if($browser){try{if(-not $browser.HasExited){& taskkill.exe /PID $browser.Id /T /F 2>$null|Out-Null}}catch{}}
  Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
}
