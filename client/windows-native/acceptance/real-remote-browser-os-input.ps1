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
 public static IntPtr FindDifferent(string n,IntPtr exclude){IntPtr f=IntPtr.Zero;EnumWindows((h,_)=>{if(h==exclude||!IsWindowVisible(h))return true;var s=new StringBuilder(1024);GetWindowText(h,s,s.Capacity);if(s.ToString().IndexOf(n,StringComparison.OrdinalIgnoreCase)>=0){f=h;return false;}return true;},IntPtr.Zero);return f;}
 public static void Focus(IntPtr h){if(h!=IntPtr.Zero){ShowWindow(h,3);SetForegroundWindow(h);}}
}
'@
}

$browser=$null;$rr=$null;$sem=$null;$detached=$false;$originServer=$null;$originAUrl='';$originBUrl=''
function Invoke-Rr([string]$Id,[string]$Op,[hashtable]$RequestArgs=@{}){
  $script:rr.StandardInput.WriteLine((@{id=$Id;op=$Op;args=$RequestArgs}|ConvertTo-Json -Compress -Depth 12));$script:rr.StandardInput.Flush()
  $task=$script:rr.StandardOutput.ReadLineAsync()
  if(-not $task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))){throw "Helper timeout: $Op"}
  $line=$task.Result;if([string]::IsNullOrWhiteSpace($line)){throw "Empty helper response: $Op"}
  $r=$line|ConvertFrom-Json;if(-not $r.ok){throw "Helper error $Op : $($r.error)"};return $r.result
}

try{
  $node=(Get-Command node -ErrorAction Stop).Source
  $originServerScript=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'real-remote-browser-cross-origin-server.cjs')).Path
  $originPortFile=Join-Path $profile 'cross-origin-ports.json'
  $originServer=Start-Process -FilePath $node -ArgumentList @($originServerScript,$originPortFile) -PassThru -WindowStyle Hidden
  $originDeadline=[DateTime]::UtcNow.AddSeconds([Math]::Min($TimeoutSeconds,10))
  while(-not(Test-Path -LiteralPath $originPortFile) -and [DateTime]::UtcNow -lt $originDeadline){
    if($originServer.HasExited){throw "Cross-origin server exited early: $($originServer.ExitCode)"}
    Start-Sleep -Milliseconds 100
  }
  if(-not(Test-Path -LiteralPath $originPortFile)){throw 'Cross-origin server ports missing'}
  $originPorts=Get-Content -LiteralPath $originPortFile -Raw|ConvertFrom-Json
  if([int]$originPorts.a -lt 1 -or [int]$originPorts.b -lt 1 -or [int]$originPorts.a -eq [int]$originPorts.b){throw 'Cross-origin server ports invalid'}
  $originAUrl="http://127.0.0.1:$([int]$originPorts.a)/origin-a"
  $originBUrl="http://127.0.0.1:$([int]$originPorts.b)/origin-b"

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
  $clickAttempt=0;$accepted=@();$ack=$null;$after=$before;$x=0;$y=0;$beforeSeq=[long]$before.stateSeq
  do{
    $clickAttempt++
    if($clickAttempt -gt 1){
      $before=Invoke-Rr ("accept-click-before-"+$clickAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
      $alreadyAccepted=@($before.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Accepted' })
      if($alreadyAccepted.Count -eq 1){$after=$before;$accepted=$alreadyAccepted;break}
      $nodes=@($before.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote OS Input' })
      if($nodes.Count -ne 1){throw "Acceptance button count=$($nodes.Count) before click retry $clickAttempt"}
    }
    $button=$nodes[0];if($button.coordinateSpace -ne 'screen-dip-estimate' -or $null -eq $button.center){throw "Bad coordinate space on click attempt ${clickAttempt}: $($button.coordinateSpace)"}
    $x=[int][Math]::Round([double]$button.center.x);$y=[int][Math]::Round([double]$button.center.y);$beforeSeq=[long]$before.stateSeq
    [LightRemoteAcceptanceWindow]::Focus($hwnd);Start-Sleep -Milliseconds 100
    $ack=Invoke-Rr ("accept-os-click-"+$clickAttempt) 'input' @{events=@(@{type='move';x=$x;y=$y},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$beforeSeq;settleMs=150}
    if($ack.provider -ne 'browser-cdp' -or $ack.observation -ne 'cdp-snapshot+journal'){throw 'CDP ACK contract mismatch'}
    if([int]$ack.appliedEvents -ne 2 -or [int]$ack.sentInputs -lt 2){throw "SendInput proof missing applied=$($ack.appliedEvents) sent=$($ack.sentInputs)"}
    if([long]$ack.stateSeq -le $beforeSeq -or $ack.gap -or $ack.resyncRecommended){throw 'CDP ACK did not advance cleanly'}
    $observeDeadline=[DateTime]::UtcNow.AddMilliseconds(900);$observeAttempt=0
    do{
      $observeAttempt++
      $after=Invoke-Rr ("accept-after-"+$clickAttempt+"-"+$observeAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
      $accepted=@($after.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Accepted' })
      if($accepted.Count -eq 1){break}
      Start-Sleep -Milliseconds 100
    }while([DateTime]::UtcNow -lt $observeDeadline)
  }while($accepted.Count -ne 1 -and $clickAttempt -lt 2)
  if($accepted.Count -ne 1){throw "OS click did not change browser semantic state after $clickAttempt attempts"}
  if($ack -and [long]$after.stateSeq -le [long]$ack.stateSeq){throw 'Post-click stateSeq did not advance'}

  Write-Host "windows-real-remote-os-input=PASS sentInputs=$($ack.sentInputs) x=$x y=$y attempts=$clickAttempt"
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

  $navLinks=@($scrollAfter.nodes|Where-Object { $_.role -eq 'link' -and $_.name -eq 'Light Remote Navigate' })
  if($navLinks.Count -ne 1 -or $null -eq $navLinks[0].center){throw "Navigation link semantic center missing count=$($navLinks.Count)"}
  $navX=[int][Math]::Round([double]$navLinks[0].center.x);$navY=[int][Math]::Round([double]$navLinks[0].center.y);$navBeforeSeq=[long]$scrollAfter.stateSeq
  $navAck=Invoke-Rr 'accept-os-navigation' 'input' @{events=@(@{type='move';x=$navX;y=$navY},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$navBeforeSeq;settleMs=250}
  if([int]$navAck.appliedEvents -ne 2 -or [int]$navAck.sentInputs -lt 2){throw "Navigation SendInput proof missing applied=$($navAck.appliedEvents) sent=$($navAck.sentInputs)"}
  $navResyncEvents=@($navAck.events|Where-Object { $_.resyncRecommended -and ($_.kind -eq 'navigation' -or $_.kind -eq 'structure' -or $_.kind -eq 'accessibility') })
  if(-not $navAck.resyncRecommended -or $navResyncEvents.Count -lt 1){throw "Navigation ACK failed to propagate resync events=$($navResyncEvents.Count) resync=$($navAck.resyncRecommended)"}
  Write-Host "windows-real-remote-navigation-resync=PASS events=$($navResyncEvents.Count) inputSeq=$($navAck.inputSeq) seq=$($navAck.stateSeq)"

  $navDeadline=[DateTime]::UtcNow.AddSeconds(5);$navAttempt=0;$nextAfter=$null;$nextButtons=@()
  do{
    $navAttempt++
    try{
      $candidate=Invoke-Rr ("accept-navigation-snapshot-"+$navAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
      $candidateButtons=@($candidate.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Next Page' })
      if($candidateButtons.Count -eq 1 -and $null -ne $candidateButtons[0].center){$nextAfter=$candidate;$nextButtons=$candidateButtons;break}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $navDeadline)
  if($null -eq $nextAfter -or $nextButtons.Count -ne 1){throw 'Same semantic session did not observe navigation target page'}
  if([string]$nextAfter.semanticSessionId -ne $sem){throw "Semantic session changed across navigation: $($nextAfter.semanticSessionId)"}
  $nextTargetUrl=[string]$nextAfter.target.url
  $nextTargetTitle=[string]$nextAfter.target.title
  if($nextTargetUrl -notlike '*real-remote-browser-os-input-next.html'){throw "Navigation target URL stale: $nextTargetUrl"}
  if($nextTargetTitle -ne 'Light Remote Navigation Acceptance'){throw "Navigation target title stale: $nextTargetTitle"}
  Write-Host "windows-real-remote-navigation-target-metadata=PASS title=$nextTargetTitle url=$nextTargetUrl"
  Write-Host "windows-real-remote-navigation-same-session=PASS semanticSessionId=$sem seq=$($nextAfter.stateSeq) targetUrl=$nextTargetUrl"

  Start-Sleep -Milliseconds 250
  $nextStable=Invoke-Rr 'accept-navigation-stable' 'semantic-snapshot' @{semanticSessionId=$sem}
  $nextButtons=@($nextStable.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Next Page' })
  if($nextButtons.Count -ne 1 -or $null -eq $nextButtons[0].center){throw 'Navigation target button disappeared during resync'}
  $nextX=[int][Math]::Round([double]$nextButtons[0].center.x);$nextY=[int][Math]::Round([double]$nextButtons[0].center.y);$nextBeforeSeq=[long]$nextStable.stateSeq
  $nextAck=Invoke-Rr 'accept-os-navigation-continued' 'input' @{events=@(@{type='move';x=$nextX;y=$nextY},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$nextBeforeSeq;settleMs=150}
  if([int]$nextAck.appliedEvents -ne 2 -or [int]$nextAck.sentInputs -lt 2){throw "Post-navigation SendInput proof missing applied=$($nextAck.appliedEvents) sent=$($nextAck.sentInputs)"}
  $nextDone=Invoke-Rr 'accept-navigation-continued-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $nextAccepted=@($nextDone.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Next Accepted' })
  if($nextAccepted.Count -ne 1){throw 'Same semantic session could not continue OS input after navigation'}
  if([string]$nextDone.semanticSessionId -ne $sem){throw 'Semantic session changed after continued navigation input'}
  Write-Host "windows-real-remote-navigation-continued-input=PASS sentInputs=$($nextAck.sentInputs) inputSeq=$($nextAck.inputSeq) seq=$($nextDone.stateSeq)"
  Write-Host 'windows-real-remote-navigation-closed-loop=PASS'

  $historyTargetId=[string]$nextDone.target.id;$backBeforeSeq=[long]$nextDone.stateSeq
  [LightRemoteAcceptanceWindow]::Focus($hwnd);Start-Sleep -Milliseconds 100
  $backAck=Invoke-Rr 'accept-os-history-back' 'input' @{events=@(@{type='key';key='LEFT';modifiers=@('ALT')});semanticSessionId=$sem;afterSeq=$backBeforeSeq;settleMs=250}
  if([int]$backAck.appliedEvents -ne 1 -or [int]$backAck.sentInputs -lt 4){throw "ALT+LEFT SendInput proof missing applied=$($backAck.appliedEvents) sent=$($backAck.sentInputs)"}
  if([string]$backAck.semanticSessionId -ne $sem){throw 'Semantic session changed during ALT+LEFT'}

  $backDeadline=[DateTime]::UtcNow.AddSeconds(5);$backAttempt=0;$backStable=$null;$backLinks=@()
  do{
    $backAttempt++
    try{
      $candidate=Invoke-Rr ("accept-history-back-snapshot-"+$backAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
      $candidateLinks=@($candidate.nodes|Where-Object { $_.role -eq 'link' -and $_.name -eq 'Light Remote Navigate' })
      if([string]$candidate.target.url -like '*real-remote-browser-os-input.html' -and $candidateLinks.Count -eq 1){$backStable=$candidate;$backLinks=$candidateLinks;break}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $backDeadline)
  if($null -eq $backStable -or $backLinks.Count -ne 1){throw 'ALT+LEFT did not restore initial browser history entry'}
  if([string]$backStable.semanticSessionId -ne $sem -or [string]$backStable.target.id -ne $historyTargetId){throw 'ALT+LEFT changed semantic session or target identity'}
  Write-Host "windows-real-remote-history-back=PASS sentInputs=$($backAck.sentInputs) inputSeq=$($backAck.inputSeq) seq=$($backStable.stateSeq) target=$historyTargetId url=$($backStable.target.url)"

  $forwardBeforeSeq=[long]$backStable.stateSeq
  [LightRemoteAcceptanceWindow]::Focus($hwnd);Start-Sleep -Milliseconds 100
  $forwardAck=Invoke-Rr 'accept-os-history-forward' 'input' @{events=@(@{type='key';key='RIGHT';modifiers=@('ALT')});semanticSessionId=$sem;afterSeq=$forwardBeforeSeq;settleMs=250}
  if([int]$forwardAck.appliedEvents -ne 1 -or [int]$forwardAck.sentInputs -lt 4){throw "ALT+RIGHT SendInput proof missing applied=$($forwardAck.appliedEvents) sent=$($forwardAck.sentInputs)"}
  if([string]$forwardAck.semanticSessionId -ne $sem){throw 'Semantic session changed during ALT+RIGHT'}

  $forwardDeadline=[DateTime]::UtcNow.AddSeconds(5);$forwardAttempt=0;$forwardStable=$null;$forwardLinks=@()
  do{
    $forwardAttempt++
    try{
      $candidate=Invoke-Rr ("accept-history-forward-snapshot-"+$forwardAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
      $candidateLinks=@($candidate.nodes|Where-Object { $_.role -eq 'link' -and $_.name -eq 'Light Remote Open New Tab' })
      if([string]$candidate.target.url -like '*real-remote-browser-os-input-next.html' -and $candidateLinks.Count -eq 1){$forwardStable=$candidate;$forwardLinks=$candidateLinks;break}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $forwardDeadline)
  if($null -eq $forwardStable -or $forwardLinks.Count -ne 1){throw 'ALT+RIGHT did not restore next browser history entry'}
  if([string]$forwardStable.semanticSessionId -ne $sem -or [string]$forwardStable.target.id -ne $historyTargetId){throw 'ALT+RIGHT changed semantic session or target identity'}
  Write-Host "windows-real-remote-history-forward=PASS sentInputs=$($forwardAck.sentInputs) inputSeq=$($forwardAck.inputSeq) seq=$($forwardStable.stateSeq) target=$historyTargetId url=$($forwardStable.target.url)"

  $reloadBeforeSeq=[long]$forwardStable.stateSeq
  [LightRemoteAcceptanceWindow]::Focus($hwnd);Start-Sleep -Milliseconds 100
  $reloadAck=Invoke-Rr 'accept-os-history-reload' 'input' @{events=@(@{type='key';key='R';modifiers=@('CTRL')});semanticSessionId=$sem;afterSeq=$reloadBeforeSeq;settleMs=300}
  if([int]$reloadAck.appliedEvents -ne 1 -or [int]$reloadAck.sentInputs -lt 4){throw "CTRL+R SendInput proof missing applied=$($reloadAck.appliedEvents) sent=$($reloadAck.sentInputs)"}
  if([string]$reloadAck.semanticSessionId -ne $sem){throw 'Semantic session changed during CTRL+R'}

  $reloadDeadline=[DateTime]::UtcNow.AddSeconds(5);$reloadAttempt=0;$reloadStable=$null;$reloadButtons=@()
  do{
    $reloadAttempt++
    try{
      $candidate=Invoke-Rr ("accept-history-reload-snapshot-"+$reloadAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
      $candidateButtons=@($candidate.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Next Page' })
      if([string]$candidate.target.url -like '*real-remote-browser-os-input-next.html' -and [string]$candidate.target.title -eq 'Light Remote Navigation Acceptance' -and $candidateButtons.Count -eq 1){$reloadStable=$candidate;$reloadButtons=$candidateButtons;break}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $reloadDeadline)
  if($null -eq $reloadStable -or $reloadButtons.Count -ne 1){throw 'CTRL+R did not restore fresh next-page semantic state'}
  if([string]$reloadStable.semanticSessionId -ne $sem -or [string]$reloadStable.target.id -ne $historyTargetId){throw 'CTRL+R changed semantic session or target identity'}
  Write-Host "windows-real-remote-reload=PASS sentInputs=$($reloadAck.sentInputs) inputSeq=$($reloadAck.inputSeq) seq=$($reloadStable.stateSeq) target=$historyTargetId title=$($reloadStable.target.title)"
  Write-Host 'windows-real-remote-history-reload-closed-loop=PASS keys=ALT+LEFT,ALT+RIGHT,CTRL+R'
  $nextDone=$reloadStable

  $newTabLinks=@($nextDone.nodes|Where-Object { $_.role -eq 'link' -and $_.name -eq 'Light Remote Open New Tab' })
  if($newTabLinks.Count -ne 1 -or $null -eq $newTabLinks[0].center){throw "New-tab link semantic center missing count=$($newTabLinks.Count)"}
  $newTabX=[int][Math]::Round([double]$newTabLinks[0].center.x);$newTabY=[int][Math]::Round([double]$newTabLinks[0].center.y)
  $oldTargetId=[string]$nextDone.target.id;$survivorTitle=[string]$nextDone.target.title;$survivorUrl=[string]$nextDone.target.url;$newTabBeforeSeq=[long]$nextDone.stateSeq
  [LightRemoteAcceptanceWindow]::Focus($hwnd);Start-Sleep -Milliseconds 100
  $newTabAck=Invoke-Rr 'accept-os-new-tab' 'input' @{events=@(@{type='move';x=$newTabX;y=$newTabY},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$newTabBeforeSeq;settleMs=250}
  if([int]$newTabAck.appliedEvents -ne 2 -or [int]$newTabAck.sentInputs -lt 2){throw "New-tab SendInput proof missing applied=$($newTabAck.appliedEvents) sent=$($newTabAck.sentInputs)"}

  $newTabDeadline=[DateTime]::UtcNow.AddSeconds(5);$newTabAttempt=0;$newTabStable=$null;$newTabButtons=@()
  do{
    $newTabAttempt++
    try{
      $candidate=Invoke-Rr ("accept-new-tab-snapshot-"+$newTabAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
      $candidateButtons=@($candidate.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote New Tab Target' })
      if([string]$candidate.target.id -ne $oldTargetId -and $candidateButtons.Count -eq 1 -and $null -ne $candidateButtons[0].center){$newTabStable=$candidate;$newTabButtons=$candidateButtons;break}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $newTabDeadline)
  if($null -eq $newTabStable -or $newTabButtons.Count -ne 1){throw 'Same semantic session did not hand off to foreground new-tab target'}
  if([string]$newTabStable.semanticSessionId -ne $sem){throw 'Semantic session changed during new-tab target handoff'}
  if([string]$newTabStable.target.id -eq $oldTargetId){throw 'New-tab target id did not change'}
  if([string]$newTabStable.target.url -notlike '*real-remote-browser-os-input-new-tab.html'){throw "New-tab target URL mismatch: $($newTabStable.target.url)"}
  if([string]$newTabStable.target.title -ne 'Light Remote New Tab Acceptance'){throw "New-tab target title mismatch: $($newTabStable.target.title)"}

  $handoffEvents=Invoke-Rr 'accept-new-tab-events' 'semantic-events' @{semanticSessionId=$sem;afterSeq=$newTabBeforeSeq;limit=100}
  $targetHandoffs=@($handoffEvents.events|Where-Object { $_.kind -eq 'target' -and $_.property -eq 'targetId' -and $_.change -like 'handoff:*' -and $_.resyncRecommended })
  if($targetHandoffs.Count -lt 1){throw "New-tab handoff resync event missing count=$($targetHandoffs.Count)"}
  Write-Host "windows-real-remote-new-tab-handoff=PASS oldTarget=$oldTargetId newTarget=$($newTabStable.target.id) events=$($targetHandoffs.Count) semanticSessionId=$sem"

  $newTabButton=$newTabButtons[0]
  $newTabButtonX=[int][Math]::Round([double]$newTabButton.center.x);$newTabButtonY=[int][Math]::Round([double]$newTabButton.center.y);$newTabActionBefore=[long]$newTabStable.stateSeq
  $newTabActionAck=Invoke-Rr 'accept-os-new-tab-action' 'input' @{events=@(@{type='move';x=$newTabButtonX;y=$newTabButtonY},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$newTabActionBefore;settleMs=150}
  if([int]$newTabActionAck.appliedEvents -ne 2 -or [int]$newTabActionAck.sentInputs -lt 2){throw "New-tab continued SendInput proof missing applied=$($newTabActionAck.appliedEvents) sent=$($newTabActionAck.sentInputs)"}
  $newTabDone=Invoke-Rr 'accept-new-tab-action-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $newTabAccepted=@($newTabDone.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote New Tab Accepted' })
  if($newTabAccepted.Count -ne 1){throw 'OS input did not continue after new-tab target handoff'}
  if([string]$newTabDone.semanticSessionId -ne $sem -or [string]$newTabDone.target.id -ne [string]$newTabStable.target.id){throw 'New-tab target/session changed during continued input'}
  Write-Host "windows-real-remote-new-tab-continued-input=PASS sentInputs=$($newTabActionAck.sentInputs) inputSeq=$($newTabActionAck.inputSeq) seq=$($newTabDone.stateSeq)"
  Write-Host 'windows-real-remote-new-tab-closed-loop=PASS'

  $newTabTargetId=[string]$newTabDone.target.id;$closeBeforeSeq=[long]$newTabDone.stateSeq
  [LightRemoteAcceptanceWindow]::Focus($hwnd);Start-Sleep -Milliseconds 100
  $closeAck=Invoke-Rr 'accept-os-close-current-tab' 'input' @{events=@(@{type='key';key='W';modifiers=@('CTRL')});semanticSessionId=$sem;afterSeq=$closeBeforeSeq;settleMs=300}
  if([int]$closeAck.appliedEvents -ne 1 -or [int]$closeAck.sentInputs -lt 4){throw "Close-tab SendInput proof missing applied=$($closeAck.appliedEvents) sent=$($closeAck.sentInputs)"}
  if([string]$closeAck.semanticSessionId -ne $sem){throw 'Semantic session changed while closing current tab'}

  $closeDeadline=[DateTime]::UtcNow.AddSeconds(5);$closeAttempt=0;$returnStable=$null;$returnButtons=@()
  do{
    $closeAttempt++
    try{
      $candidate=Invoke-Rr ("accept-close-tab-snapshot-"+$closeAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
      $candidateButtons=@($candidate.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Return Target' })
      if([string]$candidate.target.id -eq $oldTargetId -and $candidateButtons.Count -eq 1 -and $null -ne $candidateButtons[0].center){$returnStable=$candidate;$returnButtons=$candidateButtons;break}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $closeDeadline)
  if($null -eq $returnStable -or $returnButtons.Count -ne 1){throw 'Same semantic session did not recover surviving foreground tab after close'}
  if([string]$returnStable.semanticSessionId -ne $sem){throw 'Semantic session changed during close-tab recovery'}
  if([string]$returnStable.target.id -ne $oldTargetId){throw "Close-tab recovery target mismatch: $($returnStable.target.id)"}
  if([string]$returnStable.target.url -ne $survivorUrl){throw "Close-tab recovery URL mismatch: actual=$($returnStable.target.url) expected=$survivorUrl"}
  if([string]$returnStable.target.title -ne $survivorTitle){throw "Close-tab recovery title mismatch: actual=$($returnStable.target.title) expected=$survivorTitle"}

  $closeEvents=Invoke-Rr 'accept-close-tab-events' 'semantic-events' @{semanticSessionId=$sem;afterSeq=$closeBeforeSeq;limit=100}
  $closeHandoffs=@($closeEvents.events|Where-Object { $_.kind -eq 'target' -and $_.property -eq 'targetId' -and $_.change -eq ("handoff:"+$newTabTargetId+"->"+$oldTargetId) -and $_.resyncRecommended })
  if($closeHandoffs.Count -lt 1){throw "Close-tab handoff resync event missing count=$($closeHandoffs.Count)"}
  Write-Host "windows-real-remote-close-tab-handoff=PASS closedTarget=$newTabTargetId recoveredTarget=$oldTargetId events=$($closeHandoffs.Count) semanticSessionId=$sem"

  $returnButton=$returnButtons[0]
  $returnX=[int][Math]::Round([double]$returnButton.center.x);$returnY=[int][Math]::Round([double]$returnButton.center.y);$returnBeforeSeq=[long]$returnStable.stateSeq
  $returnAck=Invoke-Rr 'accept-os-close-tab-continued' 'input' @{events=@(@{type='move';x=$returnX;y=$returnY},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$returnBeforeSeq;settleMs=150}
  if([int]$returnAck.appliedEvents -ne 2 -or [int]$returnAck.sentInputs -lt 2){throw "Post-close SendInput proof missing applied=$($returnAck.appliedEvents) sent=$($returnAck.sentInputs)"}
  $returnDone=Invoke-Rr 'accept-close-tab-continued-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $returnAccepted=@($returnDone.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Return Accepted' })
  if($returnAccepted.Count -ne 1){throw 'OS input did not continue after close-tab recovery'}
  if([string]$returnDone.semanticSessionId -ne $sem -or [string]$returnDone.target.id -ne $oldTargetId){throw 'Close-tab recovery target/session changed during continued input'}
  Write-Host "windows-real-remote-close-tab-continued-input=PASS sentInputs=$($returnAck.sentInputs) inputSeq=$($returnAck.inputSeq) seq=$($returnDone.stateSeq)"
  Write-Host 'windows-real-remote-close-tab-closed-loop=PASS'
  if([string]$returnDone.target.title -ne 'Light Remote Return Accepted'){throw "Source title not ready for collision proof: $($returnDone.target.title)"}

  $popupOpenButtons=@($returnDone.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Open Popup' })
  if($popupOpenButtons.Count -ne 1 -or $null -eq $popupOpenButtons[0].center){throw "Popup-open semantic center missing count=$($popupOpenButtons.Count)"}
  $popupOpenX=[int][Math]::Round([double]$popupOpenButtons[0].center.x);$popupOpenY=[int][Math]::Round([double]$popupOpenButtons[0].center.y)
  $popupBeforeSeq=[long]$returnDone.stateSeq
  [LightRemoteAcceptanceWindow]::Focus($hwnd);Start-Sleep -Milliseconds 100
  $popupOpenAck=Invoke-Rr 'accept-os-open-popup-window' 'input' @{events=@(@{type='move';x=$popupOpenX;y=$popupOpenY},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$popupBeforeSeq;settleMs=250}
  if([int]$popupOpenAck.appliedEvents -ne 2 -or [int]$popupOpenAck.sentInputs -lt 2){throw "Popup-open SendInput proof missing applied=$($popupOpenAck.appliedEvents) sent=$($popupOpenAck.sentInputs)"}
  if([string]$popupOpenAck.semanticSessionId -ne $sem){throw 'Semantic session changed while opening popup window'}

  $popupHwnd=[IntPtr]::Zero;$popupWindowDeadline=[DateTime]::UtcNow.AddSeconds(5)
  while($popupHwnd -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $popupWindowDeadline){
    $popupHwnd=[LightRemoteAcceptanceWindow]::FindDifferent('Light Remote Return Accepted',$hwnd)
    if($popupHwnd -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100}
  }
  if($popupHwnd -eq [IntPtr]::Zero){throw 'Visible popup Chromium window missing'}
  if($popupHwnd -eq $hwnd){throw 'Popup acceptance did not create a distinct Chromium HWND'}
  [LightRemoteAcceptanceWindow]::Focus($popupHwnd);Start-Sleep -Milliseconds 150

  $popupDeadline=[DateTime]::UtcNow.AddSeconds(5);$popupAttempt=0;$popupStable=$null;$popupButtons=@()
  do{
    $popupAttempt++
    try{
      $candidate=Invoke-Rr ("accept-popup-snapshot-"+$popupAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
      $candidateButtons=@($candidate.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Popup Target' })
      if([string]$candidate.target.id -ne $oldTargetId -and $candidateButtons.Count -eq 1 -and $null -ne $candidateButtons[0].center){$popupStable=$candidate;$popupButtons=$candidateButtons;break}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $popupDeadline)
  if($null -eq $popupStable -or $popupButtons.Count -ne 1){throw 'Same semantic session did not hand off to popup window target'}
  if([string]$popupStable.semanticSessionId -ne $sem){throw 'Semantic session changed during popup-window handoff'}
  $popupTargetId=[string]$popupStable.target.id
  if($popupTargetId -eq $oldTargetId){throw 'Popup target id did not change'}
  if([string]$popupStable.target.url -notlike '*real-remote-browser-os-input-popup.html'){throw "Popup target URL mismatch: $($popupStable.target.url)"}
  if([string]$popupStable.target.title -ne 'Light Remote Return Accepted'){throw "Popup target title collision mismatch: $($popupStable.target.title)"}

  $popupEvents=Invoke-Rr 'accept-popup-events' 'semantic-events' @{semanticSessionId=$sem;afterSeq=$popupBeforeSeq;limit=100}
  $popupHandoffs=@($popupEvents.events|Where-Object { $_.kind -eq 'target' -and $_.property -eq 'targetId' -and $_.change -eq ("handoff:"+$oldTargetId+"->"+$popupTargetId) -and $_.resyncRecommended })
  if($popupHandoffs.Count -lt 1){throw "Popup-window handoff resync event missing count=$($popupHandoffs.Count)"}
  Write-Host "windows-real-remote-popup-window-handoff=PASS sourceHwnd=$hwnd popupHwnd=$popupHwnd oldTarget=$oldTargetId popupTarget=$popupTargetId events=$($popupHandoffs.Count) semanticSessionId=$sem"
  Write-Host "windows-real-remote-target-identity-title-collision=PASS sourceHwnd=$hwnd popupHwnd=$popupHwnd title=Light Remote Return Accepted sourceTarget=$oldTargetId popupTarget=$popupTargetId"

  $popupButton=$popupButtons[0]
  $popupX=[int][Math]::Round([double]$popupButton.center.x);$popupY=[int][Math]::Round([double]$popupButton.center.y);$popupActionBefore=[long]$popupStable.stateSeq
  [LightRemoteAcceptanceWindow]::Focus($popupHwnd);Start-Sleep -Milliseconds 100
  $popupActionAck=Invoke-Rr 'accept-os-popup-window-action' 'input' @{events=@(@{type='move';x=$popupX;y=$popupY},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$popupActionBefore;settleMs=150}
  if([int]$popupActionAck.appliedEvents -ne 2 -or [int]$popupActionAck.sentInputs -lt 2){throw "Popup continued SendInput proof missing applied=$($popupActionAck.appliedEvents) sent=$($popupActionAck.sentInputs)"}
  $popupDone=Invoke-Rr 'accept-popup-window-action-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $popupAccepted=@($popupDone.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Popup Accepted' })
  if($popupAccepted.Count -ne 1){throw 'OS input did not continue after popup-window handoff'}
  if([string]$popupDone.semanticSessionId -ne $sem -or [string]$popupDone.target.id -ne $popupTargetId){throw 'Popup target/session changed during continued input'}
  Write-Host "windows-real-remote-popup-window-continued-input=PASS sentInputs=$($popupActionAck.sentInputs) inputSeq=$($popupActionAck.inputSeq) seq=$($popupDone.stateSeq)"
  Write-Host 'windows-real-remote-popup-window-closed-loop=PASS'

  $crossTargetId=[string]$popupDone.target.id;$crossBeforeSeq=[long]$popupDone.stateSeq
  [LightRemoteAcceptanceWindow]::Focus($popupHwnd);Start-Sleep -Milliseconds 100
  $originAFocusAck=Invoke-Rr 'accept-os-cross-origin-focus-address' 'input' @{events=@(@{type='key';key='L';modifiers=@('CTRL')});semanticSessionId=$sem;afterSeq=$crossBeforeSeq;settleMs=120}
  if([int]$originAFocusAck.appliedEvents -ne 1 -or [int]$originAFocusAck.sentInputs -lt 4){throw "Origin-A Ctrl+L SendInput proof missing applied=$($originAFocusAck.appliedEvents) sent=$($originAFocusAck.sentInputs)"}
  $originATextAck=Invoke-Rr 'accept-os-cross-origin-type-address' 'input' @{events=@(@{type='text';text=$originAUrl});semanticSessionId=$sem;afterSeq=[long]$originAFocusAck.stateSeq;settleMs=80}
  $originATextExpected=$originAUrl.Length*2
  if([int]$originATextAck.appliedEvents -ne 1 -or [int]$originATextAck.sentInputs -lt $originATextExpected){throw "Origin-A text SendInput proof missing applied=$($originATextAck.appliedEvents) sent=$($originATextAck.sentInputs) expected=$originATextExpected"}
  $originAEnterAck=Invoke-Rr 'accept-os-cross-origin-enter-address' 'input' @{events=@(@{type='key';key='ENTER'});semanticSessionId=$sem;afterSeq=[long]$originATextAck.stateSeq;settleMs=350}
  if([int]$originAEnterAck.appliedEvents -ne 1 -or [int]$originAEnterAck.sentInputs -lt 2){throw "Origin-A Enter SendInput proof missing applied=$($originAEnterAck.appliedEvents) sent=$($originAEnterAck.sentInputs)"}
  if([string]$originAFocusAck.semanticSessionId -ne $sem -or [string]$originATextAck.semanticSessionId -ne $sem -or [string]$originAEnterAck.semanticSessionId -ne $sem){throw 'Semantic session changed while navigating address bar to origin A'}
  $originAAddressSent=[int]$originAFocusAck.sentInputs+[int]$originATextAck.sentInputs+[int]$originAEnterAck.sentInputs

  $originADeadline=[DateTime]::UtcNow.AddSeconds(5);$originAAttempt=0;$originAStable=$null;$originALinks=@();$originALastUrl='';$originALastTitle=''
  do{
    $originAAttempt++
    try{
      $candidate=Invoke-Rr ("accept-cross-origin-a-snapshot-"+$originAAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
      $originALastUrl=[string]$candidate.target.url;$originALastTitle=[string]$candidate.target.title
      $candidateLinks=@($candidate.nodes|Where-Object { $_.role -eq 'link' -and $_.name -eq 'Light Remote Cross Origin Navigate' })
      if([string]$candidate.target.url -eq $originAUrl -and [string]$candidate.target.title -eq 'Light Remote Cross Origin A' -and $candidateLinks.Count -eq 1 -and $null -ne $candidateLinks[0].center){$originAStable=$candidate;$originALinks=$candidateLinks;break}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $originADeadline)
  if($null -eq $originAStable -or $originALinks.Count -ne 1){throw "OS address-bar navigation did not reach origin A lastTitle=$originALastTitle lastUrl=$originALastUrl expected=$originAUrl"}
  if([string]$originAStable.semanticSessionId -ne $sem -or [string]$originAStable.target.id -ne $crossTargetId){throw 'Origin-A navigation changed semantic session or target identity'}
  Write-Host "windows-real-remote-cross-origin-a=PASS target=$crossTargetId url=$($originAStable.target.url) sentInputs=$originAAddressSent"

  $originALink=$originALinks[0]
  $originAX=[int][Math]::Round([double]$originALink.center.x);$originAY=[int][Math]::Round([double]$originALink.center.y);$originABeforeSeq=[long]$originAStable.stateSeq
  [LightRemoteAcceptanceWindow]::Focus($popupHwnd);Start-Sleep -Milliseconds 100
  $originBAck=Invoke-Rr 'accept-os-cross-origin-b' 'input' @{events=@(@{type='move';x=$originAX;y=$originAY},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$originABeforeSeq;settleMs=250}
  if([int]$originBAck.appliedEvents -ne 2 -or [int]$originBAck.sentInputs -lt 2){throw "Origin-B click SendInput proof missing applied=$($originBAck.appliedEvents) sent=$($originBAck.sentInputs)"}
  if([string]$originBAck.semanticSessionId -ne $sem){throw 'Semantic session changed while crossing origins'}

  $originBDeadline=[DateTime]::UtcNow.AddSeconds(5);$originBAttempt=0;$originBStable=$null;$originBButtons=@()
  do{
    $originBAttempt++
    try{
      $candidate=Invoke-Rr ("accept-cross-origin-b-snapshot-"+$originBAttempt) 'semantic-snapshot' @{semanticSessionId=$sem}
      $candidateButtons=@($candidate.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Cross Origin Target' })
      if([string]$candidate.target.url -eq $originBUrl -and [string]$candidate.target.title -eq 'Light Remote Cross Origin B' -and $candidateButtons.Count -eq 1 -and $null -ne $candidateButtons[0].center){$originBStable=$candidate;$originBButtons=$candidateButtons;break}
    }catch{}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $originBDeadline)
  if($null -eq $originBStable -or $originBButtons.Count -ne 1){throw 'OS click did not navigate from origin A to origin B'}
  if([string]$originBStable.semanticSessionId -ne $sem -or [string]$originBStable.target.id -ne $crossTargetId){throw 'Cross-origin navigation changed semantic session or target identity'}
  if($originAUrl -eq $originBUrl){throw 'Cross-origin acceptance accidentally used one origin'}
  Write-Host "windows-real-remote-cross-origin-transition=PASS target=$crossTargetId from=$originAUrl to=$originBUrl sentInputs=$($originBAck.sentInputs)"

  $originBButton=$originBButtons[0]
  $originBX=[int][Math]::Round([double]$originBButton.center.x);$originBY=[int][Math]::Round([double]$originBButton.center.y);$originBBeforeSeq=[long]$originBStable.stateSeq
  [LightRemoteAcceptanceWindow]::Focus($popupHwnd);Start-Sleep -Milliseconds 100
  $originBActionAck=Invoke-Rr 'accept-os-cross-origin-action' 'input' @{events=@(@{type='move';x=$originBX;y=$originBY},@{type='click';button='left';count=1});semanticSessionId=$sem;afterSeq=$originBBeforeSeq;settleMs=150}
  if([int]$originBActionAck.appliedEvents -ne 2 -or [int]$originBActionAck.sentInputs -lt 2){throw "Cross-origin continued SendInput proof missing applied=$($originBActionAck.appliedEvents) sent=$($originBActionAck.sentInputs)"}
  $originBDone=Invoke-Rr 'accept-cross-origin-action-after' 'semantic-snapshot' @{semanticSessionId=$sem}
  $originBAccepted=@($originBDone.nodes|Where-Object { $_.role -eq 'button' -and $_.name -eq 'Light Remote Cross Origin Accepted' })
  if($originBAccepted.Count -ne 1){throw 'OS input did not continue after cross-origin navigation'}
  if([string]$originBDone.semanticSessionId -ne $sem -or [string]$originBDone.target.id -ne $crossTargetId){throw 'Cross-origin target/session changed during continued input'}
  if([string]$originBDone.target.url -ne $originBUrl -or [string]$originBDone.target.title -ne 'Light Remote Cross Origin Accepted'){throw "Cross-origin accepted metadata mismatch title=$($originBDone.target.title) url=$($originBDone.target.url)"}
  Write-Host "windows-real-remote-cross-origin-continued-input=PASS sentInputs=$($originBActionAck.sentInputs) inputSeq=$($originBActionAck.inputSeq) seq=$($originBDone.stateSeq)"
  Write-Host 'windows-real-remote-cross-origin-closed-loop=PASS'

  $d=Invoke-Rr 'accept-detach' 'semantic-detach' @{semanticSessionId=$sem};if(-not $d.detached -or $d.provider -ne 'browser-cdp'){throw 'Detach failed'};$detached=$true
  Write-Host 'windows-real-remote-browser-os-input-acceptance=PASS'
}finally{
  if($rr){
    if($sem -and -not $detached -and -not $rr.HasExited){try{$null=Invoke-Rr 'accept-detach-finally' 'semantic-detach' @{semanticSessionId=$sem}}catch{}}
    try{$rr.StandardInput.Close()}catch{};try{if(-not $rr.WaitForExit(3000)){$rr.Kill($true)}}catch{};$rr.Dispose()
  }
  if($browser){try{if(-not $browser.HasExited){$null=Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID',[string]$browser.Id,'/T','/F') -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue}}catch{}}
  if($originServer){try{if(-not $originServer.HasExited){$originServer.Kill($true);$null=$originServer.WaitForExit(2000)}}catch{};try{$originServer.Dispose()}catch{}}
  Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
}
