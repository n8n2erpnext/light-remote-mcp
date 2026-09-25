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
function Invoke-Rr([string]$Id,[string]$Op,[hashtable]$RequestArgs=@{}){
  $script:rr.StandardInput.WriteLine((@{id=$Id;op=$Op;args=$RequestArgs}|ConvertTo-Json -Compress -Depth 12));$script:rr.StandardInput.Flush()
  $task=$script:rr.StandardOutput.ReadLineAsync()
  if(-not $task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))){throw "Helper timeout: $Op"}
  $line=$task.Result;if([string]::IsNullOrWhiteSpace($line)){throw "Empty helper response: $Op"}
  $r=$line|ConvertFrom-Json;if(-not $r.ok){throw "Helper error $Op : $($r.error)"};return $r.result
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
  $readyDeadline=[DateTime]::UtcNow.AddSeconds([Math]::Min($TimeoutSeconds,10));$readyAttempt=0;$before=$null;$nodes=@()
  do{
    $readyAttempt++
    $before=Invoke-Rr ("accept-before-"+$readyAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
    if($before.provider -ne 'browser-cdp'){throw 'browser-cdp snapshot provider mismatch'}
    $nodes=@($before.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote OS Input' })
    if($nodes.Count -eq 1 -and $before.viewport.screenEstimateAvailable -and $nodes[0].coordinateSpace -eq 'screen-dip-estimate' -and $null -ne $nodes[0].center){break}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $readyDeadline)
  if($nodes.Count -ne 1){throw "Acceptance button count=$($nodes.Count) after readiness wait"}
  if(-not $before.viewport.screenEstimateAvailable){throw 'No browser screen estimate'}
  $button=$nodes[0];if($button.coordinateSpace -ne 'screen-dip-estimate' -or $null -eq $button.center){throw "Bad coordinate space after readiness wait: $($button.coordinateSpace)"}
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

  $unicodeText='Tiếng Việt ✓'
  $textboxes=@($after.nodes|Where-Object { $_.role -eq 'textbox' -and $_.name -eq 'Light Remote Text Input' })
  if($textboxes.Count -ne 1 -or $null -eq $textboxes[0].center){throw "Text input semantic center missing count=$($textboxes.Count)"}
  $textX=[int][Math]::Round([double]$textboxes[0].center.x);$textY=[int][Math]::Round([double]$textboxes[0].center.y);$textBeforeSeq=[long]$after.stateSeq
  $textAck=Invoke-Rr 'accept-os-text' 'input' @{events=@(@{type='move';x=$textX;y=$textY},@{type='click';button='left';count=1},@{type='text';text=$unicodeText});semanticSessionId=$sem;afterSeq=$textBeforeSeq;settleMs=150}
  if($textAck.provider -ne 'browser-cdp' -or $textAck.observation -ne 'cdp-snapshot+journal'){throw 'Unicode text CDP ACK contract mismatch'}
  $expectedTextInputs=2+($unicodeText.Length*2)
  if([int]$textAck.appliedEvents -ne 3 -or [int]$textAck.sentInputs -lt $expectedTextInputs){throw "Unicode SendInput proof missing applied=$($textAck.appliedEvents) sent=$($textAck.sentInputs) expected=$expectedTextInputs"}
  if([long]$textAck.stateSeq -le $textBeforeSeq -or $textAck.gap -or $textAck.resyncRecommended){throw 'Unicode text ACK did not advance cleanly'}
  $textAfter=Invoke-Rr 'accept-text-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $textAccepted=@($textAfter.nodes|Where-Object { $_.role -eq 'textbox' -and $_.name -eq 'Light Remote Text Accepted' })
  if($textAccepted.Count -ne 1){throw 'Unicode OS text did not change browser semantic state'}
  if([long]$textAfter.stateSeq -le [long]$textAck.stateSeq){throw 'Post-text stateSeq did not advance'}
  Write-Host "windows-real-remote-unicode-text=PASS text=$unicodeText sentInputs=$($textAck.sentInputs) x=$textX y=$textY"
  Write-Host "windows-real-remote-text-cdp-ack=PASS inputSeq=$($textAck.inputSeq) beforeSeq=$textBeforeSeq ackSeq=$($textAck.stateSeq)"
  Write-Host "windows-real-remote-text-state-change=PASS name=Light Remote Text Accepted seq=$($textAfter.stateSeq)"

  $ctrlAText='CTRL+A OK'
  $ctrlABeforeSeq=[long]$textAfter.stateSeq
  $ctrlAAck=Invoke-Rr 'accept-os-ctrl-a' 'input' @{events=@(@{type='key';key='A';modifiers=@('CTRL')},@{type='text';text=$ctrlAText});semanticSessionId=$sem;afterSeq=$ctrlABeforeSeq;settleMs=150}
  $expectedCtrlAInputs=4+($ctrlAText.Length*2)
  if([int]$ctrlAAck.appliedEvents -ne 2 -or [int]$ctrlAAck.sentInputs -ne $expectedCtrlAInputs){throw "CTRL+A SendInput proof missing applied=$($ctrlAAck.appliedEvents) sent=$($ctrlAAck.sentInputs) expected=$expectedCtrlAInputs"}
  if([long]$ctrlAAck.stateSeq -le $ctrlABeforeSeq -or $ctrlAAck.gap -or $ctrlAAck.resyncRecommended){throw 'CTRL+A ACK did not advance cleanly'}
  $ctrlAAfter=Invoke-Rr 'accept-ctrl-a-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $ctrlAAccepted=@($ctrlAAfter.nodes|Where-Object { $_.role -eq 'textbox' -and $_.name -eq 'Light Remote CtrlA Accepted' })
  if($ctrlAAccepted.Count -ne 1){throw 'CTRL+A did not replace textbox contents'}
  if([long]$ctrlAAfter.stateSeq -le [long]$ctrlAAck.stateSeq){throw 'Post-CTRL+A stateSeq did not advance'}
  Write-Host "windows-real-remote-ctrl-a=PASS text=$ctrlAText sentInputs=$($ctrlAAck.sentInputs) inputSeq=$($ctrlAAck.inputSeq) seq=$($ctrlAAfter.stateSeq)"

  $tabBeforeSeq=[long]$ctrlAAfter.stateSeq
  $tabAck=Invoke-Rr 'accept-os-tab' 'input' @{events=@(@{type='key';key='TAB';modifiers=@()});semanticSessionId=$sem;afterSeq=$tabBeforeSeq;settleMs=150}
  if([int]$tabAck.appliedEvents -ne 1 -or [int]$tabAck.sentInputs -ne 2){throw "TAB SendInput proof missing applied=$($tabAck.appliedEvents) sent=$($tabAck.sentInputs)"}
  $tabAfter=Invoke-Rr 'accept-tab-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $tabAccepted=@($tabAfter.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Tab Accepted' })
  if($tabAccepted.Count -ne 1){throw 'TAB did not move focus to keyboard target'}
  if([long]$tabAfter.stateSeq -le [long]$tabAck.stateSeq){throw 'Post-TAB stateSeq did not advance'}
  Write-Host "windows-real-remote-tab=PASS sentInputs=$($tabAck.sentInputs) inputSeq=$($tabAck.inputSeq) seq=$($tabAfter.stateSeq)"

  $rightBeforeSeq=[long]$tabAfter.stateSeq
  $rightAck=Invoke-Rr 'accept-os-right' 'input' @{events=@(@{type='key';key='RIGHT';modifiers=@()});semanticSessionId=$sem;afterSeq=$rightBeforeSeq;settleMs=150}
  if([int]$rightAck.appliedEvents -ne 1 -or [int]$rightAck.sentInputs -ne 2){throw "RIGHT SendInput proof missing applied=$($rightAck.appliedEvents) sent=$($rightAck.sentInputs)"}
  $rightAfter=Invoke-Rr 'accept-right-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $rightAccepted=@($rightAfter.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Right Accepted' })
  if($rightAccepted.Count -ne 1){throw 'RIGHT named key did not reach keyboard target'}
  if([long]$rightAfter.stateSeq -le [long]$rightAck.stateSeq){throw 'Post-RIGHT stateSeq did not advance'}
  Write-Host "windows-real-remote-right=PASS sentInputs=$($rightAck.sentInputs) inputSeq=$($rightAck.inputSeq) seq=$($rightAfter.stateSeq)"

  $enterBeforeSeq=[long]$rightAfter.stateSeq
  $enterAck=Invoke-Rr 'accept-os-enter' 'input' @{events=@(@{type='key';key='ENTER';modifiers=@()});semanticSessionId=$sem;afterSeq=$enterBeforeSeq;settleMs=150}
  if([int]$enterAck.appliedEvents -ne 1 -or [int]$enterAck.sentInputs -ne 2){throw "ENTER SendInput proof missing applied=$($enterAck.appliedEvents) sent=$($enterAck.sentInputs)"}
  $enterAfter=Invoke-Rr 'accept-enter-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $enterAccepted=@($enterAfter.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Enter Accepted' })
  if($enterAccepted.Count -ne 1){throw 'ENTER did not activate keyboard target'}
  if([long]$enterAfter.stateSeq -le [long]$enterAck.stateSeq){throw 'Post-ENTER stateSeq did not advance'}
  Write-Host "windows-real-remote-enter=PASS sentInputs=$($enterAck.sentInputs) inputSeq=$($enterAck.inputSeq) seq=$($enterAfter.stateSeq)"
  Write-Host 'windows-real-remote-keyboard-navigation=PASS keys=CTRL+A,TAB,RIGHT,ENTER'

  $scrollRegions=@($enterAfter.nodes|Where-Object { $_.role -eq 'region' -and $_.name -eq 'Light Remote Scroll Region' })
  if($scrollRegions.Count -ne 1 -or $null -eq $scrollRegions[0].center){throw "Scroll region semantic center missing count=$($scrollRegions.Count)"}
  $scrollX=[int][Math]::Round([double]$scrollRegions[0].center.x);$scrollY=[int][Math]::Round([double]$scrollRegions[0].center.y);$scrollBeforeSeq=[long]$enterAfter.stateSeq
  $scrollAck=Invoke-Rr 'accept-os-wheel' 'input' @{events=@(@{type='move';x=$scrollX;y=$scrollY},@{type='wheel';delta=-1200});semanticSessionId=$sem;afterSeq=$scrollBeforeSeq;settleMs=150}
  if([int]$scrollAck.appliedEvents -ne 2 -or [int]$scrollAck.sentInputs -ne 1){throw "WHEEL SendInput proof missing applied=$($scrollAck.appliedEvents) sent=$($scrollAck.sentInputs)"}
  if([long]$scrollAck.stateSeq -le $scrollBeforeSeq -or $scrollAck.gap -or $scrollAck.resyncRecommended){throw 'WHEEL ACK did not advance cleanly'}
  $scrollAfter=Invoke-Rr 'accept-wheel-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $scrollAccepted=@($scrollAfter.nodes|Where-Object { $_.role -eq 'region' -and $_.name -eq 'Light Remote Scroll Accepted' })
  if($scrollAccepted.Count -ne 1){throw 'OS wheel did not scroll acceptance region'}
  if([long]$scrollAfter.stateSeq -le [long]$scrollAck.stateSeq){throw 'Post-WHEEL stateSeq did not advance'}
  Write-Host "windows-real-remote-wheel=PASS delta=-1200 sentInputs=$($scrollAck.sentInputs) x=$scrollX y=$scrollY inputSeq=$($scrollAck.inputSeq) seq=$($scrollAfter.stateSeq)"
  Write-Host 'windows-real-remote-scroll-closed-loop=PASS'

  $d=Invoke-Rr 'accept-detach' 'semantic-detach' @{semanticSessionId=$sem};if(-not $d.detached -or $d.provider -ne 'browser-cdp'){throw 'Detach failed'};$detached=$true
  Write-Host 'windows-real-remote-browser-os-input-acceptance=PASS'
}finally{
  if($rr){
    if($sem -and -not $detached -and -not $rr.HasExited){try{$null=Invoke-Rr 'accept-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};$rr.Dispose()
  }
  if($browser){try{if(-not $browser.HasExited){$null=Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID',[string]$browser.Id,'/T','/F') -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue}}catch{}}
  Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
}
