param([Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][string]$Output,[Parameter(Mandatory=$true)][string]$FixtureExe)
$ErrorActionPreference='Stop'
# Isolated Actions desktop only. Never run on the Owner's installed desktop.
$script:lastStage='starting';$script:testUnits=0;$script:testOffset=0
$script:totalClock=[diagnostics.stopwatch]::StartNew();$script:sizeClock=$null;$script:chunkTiming=@();$script:completedSizes=@()
function Write-TextStage([string]$Stage){
 $script:lastStage=$Stage
 $row=@{result='RUNNING';scope='isolated_actions_synthetic_text_no_raw_content';stage=$Stage;requestedUnits=$script:testUnits;sentOffset=$script:testOffset;at=[datetime]::UtcNow.ToString('o');elapsedMs=$script:totalClock.Elapsed.TotalMilliseconds;sizeElapsedMs=$(if($script:sizeClock){$script:sizeClock.Elapsed.TotalMilliseconds}else{0});completedSizes=$script:completedSizes;lastChunkTiming=$script:chunkTiming}
 $row|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $Output -Encoding utf8
 Write-Host "RM_TEXT_STAGE $Stage units=$script:testUnits offset=$script:testOffset"
}
Write-TextStage 'starting_fixture'
if($env:GITHUB_ACTIONS -ne 'true'){throw 'text_fixture_actions_only'}
$fixtureName="lightremote-text-fixture-$PID"
$fixtureProcess=Start-Process -FilePath $FixtureExe -ArgumentList @($fixtureName) -PassThru -WindowStyle Hidden
$fixturePipe=$null;$fixtureReader=$null;$fixtureWriter=$null
$shared=@{result='';other='';characters=0;keyDowns=0}
$process=$null;$pipe=$null;$reader=$null;$writer=$null
function Ui-Command([string]$Command,[string]$Initial=''){
 $request=@{id=[guid]::NewGuid().ToString('N');op=$Command;initial=$Initial}
 $fixtureWriter.WriteLine(($request|ConvertTo-Json -Compress))
 $read=$fixtureReader.ReadLineAsync();if(-not $read.Wait(15000)){throw "text_fixture_timeout:$Command"}
 $reply=$read.Result|ConvertFrom-Json
 if($reply.id -ne $request.id -or -not $reply.ok){throw 'text_fixture_reply_invalid'}
 if($Command -eq 'read'){$shared.result=$reply.data.text;$shared.other=$reply.data.other;$shared.characters=$reply.data.characters;$shared.keyDowns=$reply.data.keyDowns}
 Start-Sleep -Milliseconds 150
}
try {
 $fixturePipe=[IO.Pipes.NamedPipeClientStream]::new('.',$fixtureName,[IO.Pipes.PipeDirection]::InOut);$fixturePipe.Connect(10000)
 $fixtureReader=[IO.StreamReader]::new($fixturePipe);$fixtureWriter=[IO.StreamWriter]::new($fixturePipe);$fixtureWriter.AutoFlush=$true
 $pipeName="lightremote-rmv2-text-$PID"
 $process=Start-Process -FilePath $Exe -ArgumentList @('--pipe',$pipeName) -PassThru -WindowStyle Hidden
 $pipe=[IO.Pipes.NamedPipeClientStream]::new('.',$pipeName,[IO.Pipes.PipeDirection]::InOut);$pipe.Connect(10000)
 $reader=[IO.StreamReader]::new($pipe);$writer=[IO.StreamWriter]::new($pipe);$writer.AutoFlush=$true
 function Invoke-Rm([hashtable]$Request){
  $Request.id=[guid]::NewGuid().ToString('N');$writer.WriteLine(($Request|ConvertTo-Json -Depth 10 -Compress))
  $deadline=[diagnostics.stopwatch]::StartNew();$events=0
  while($deadline.ElapsedMilliseconds -lt 15000){
   $read=$reader.ReadLineAsync();$remaining=[math]::Max(1,15000-$deadline.ElapsedMilliseconds);if(-not $read.Wait([int]$remaining)){throw 'text_native_timeout'}
   $row=$read.Result|ConvertFrom-Json;if($row.type -eq 'event'){$events++}
   if($row.type -eq 'response' -and $row.id -eq $Request.id){if(-not $row.ok){throw "text_native_failure:$($row.error)"};return $row.data}
  };throw "text_native_reply_missing op=$($Request.op) events=$events"
 }
 Write-TextStage 'attaching_visual'
 $view=Invoke-Rm @{op='desktop.visual.attach';leaseMs=45000}
 function Text-Rpc([string]$Op,[hashtable]$Payload){
  $Payload.op='desktop.text.'+$Op;$Payload.visualSessionId=$view.visualSessionId;$Payload.leaseToken=$view.leaseToken
  if($Op -eq 'chunk'){$Payload.authorityBudgetMs=1000}
  return Invoke-Rm $Payload
 }
 $sizes=@()
 foreach($size in @(16384,65536,262144)){
  $script:testUnits=$size;$script:testOffset=0;$script:sizeClock=[diagnostics.stopwatch]::StartNew();Write-TextStage 'resetting_control'
  Ui-Command 'reset'
  # A surrogate pair and a combining sequence remain together in every chunk.
  $seed='Unicode '+[char]0x0110+[char]0x00e2+'y '+[char]::ConvertFromUtf32(0x1f600)+' e'+[char]0x0301+' '
  $text=($seed*([int][math]::Floor($size/$seed.Length)))+('x'*($size%$seed.Length))
  $id='write_'+[guid]::NewGuid().ToString('N')
  Write-TextStage 'binding_target'
  $prepared=Text-Rpc 'start' @{writeId=$id;requestedUnits=$text.Length;verification='required';mode='insert'}
  if(-not $prepared.verificationAvailable){throw 'text_fixture_readback_unavailable'}
  $chunkLimit=[int]$prepared.maxChunkUnits
  if($chunkLimit -lt 1 -or $chunkLimit -gt 256){throw 'text_fixture_native_window_invalid'}
  $offset=0;$nextReport=0;Write-TextStage 'typing_chunks'
  while($offset -lt $text.Length){
   $take=[math]::Min($chunkLimit,$text.Length-$offset)
   # Use .NET grapheme enumeration, not arbitrary UTF16 slicing.
   $remaining=$text.Substring($offset);$elements=[Globalization.StringInfo]::GetTextElementEnumerator($remaining);$chunk=''
   while($elements.MoveNext()){$e=$elements.GetTextElement();if($chunk.Length+$e.Length -gt $take){break};$chunk+=$e}
   $ack=Text-Rpc 'chunk' @{writeId=$id;offset=$offset;text=$chunk;intervalMs=0}
   $script:chunkTiming=@{nativeHandlerMs=$ack.nativeTiming.handlerMs;nativeQueueMs=$ack.nativeQueueMs;sentUnits=$ack.sentUnits;observedUnits=$ack.lastObservedInsertedUnits}
   if($ack.state -ne 'running' -or $ack.sentUnits -ne ($offset+$chunk.Length)){throw "text_chunk_interrupted:$($ack|ConvertTo-Json -Compress)"}
   $offset+=$chunk.Length
   $script:testOffset=$offset
   if($offset -ge $nextReport){Write-TextStage 'typing_chunks';$nextReport=$offset+8192}
  }
  Write-TextStage 'verifying_native_readback'
  $final=Text-Rpc 'finish' @{writeId=$id;complete=$true}
  Write-TextStage 'reading_fixture_control'
  Ui-Command 'read'
  Write-TextStage 'comparing_complete_text'
  if($final.contentVerification -ne 'verified' -or $final.verifiedInsertedUnits -ne $text.Length -or $shared.result -cne $text){
   $actual=[string]$shared.result;$firstDifference=-1
   for($k=0;$k -lt [math]::Min($actual.Length,$text.Length);$k++){if($actual[$k] -cne $text[$k]){$firstDifference=$k;break}}
   if($firstDifference -eq -1 -and $actual.Length -ne $text.Length){$firstDifference=[math]::Min($actual.Length,$text.Length)}
   $expectedHash=[convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::Unicode.GetBytes($text)))
   $actualHash=[convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::Unicode.GetBytes($actual)))
   $normalizedEqual=$false;try{$normalizedEqual=$actual.Normalize([Text.NormalizationForm]::FormC) -ceq $text.Normalize([Text.NormalizationForm]::FormC)}catch{}
   $diagnostic=@{result='FAIL';scope='isolated_actions_synthetic_text_no_raw_content';requestedUnits=$text.Length;actualUnits=$actual.Length;firstDifference=$firstDifference;expectedUtf16Sha256=$expectedHash;actualUtf16Sha256=$actualHash;nfcEqualDiagnosticOnly=$normalizedEqual;fixtureWmCharCount=$shared.characters;fixtureKeyDownCount=$shared.keyDowns;lastChunk=$ack;final=$final}
   $diagnostic|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $Output -Encoding utf8
   Write-Host ($diagnostic|ConvertTo-Json -Depth 8 -Compress)
   throw "text_full_readback_failed:$size"
  }
  $sizes+=$size
  $script:completedSizes+=,@{units=$size;elapsedMs=$script:sizeClock.Elapsed.TotalMilliseconds;exactFixtureReadback=$true;nativeVerified=$true}
 }
 Write-TextStage 'focus_switch_test'
 # Changing focus between acknowledged chunks must not type the suffix into B.
 Ui-Command 'reset';$id='write_'+[guid]::NewGuid().ToString('N')
 $null=Text-Rpc 'start' @{writeId=$id;requestedUnits=12;verification='required';mode='insert'}
 $first=Text-Rpc 'chunk' @{writeId=$id;offset=0;text='prefix';intervalMs=0}
 if($first.sentUnits -ne 6){throw 'text_prefix_not_acknowledged'}
 Ui-Command 'other'
 $second=Text-Rpc 'chunk' @{writeId=$id;offset=6;text='suffix';intervalMs=0}
 if($second.state -ne 'interrupted' -or $second.sentUnits -ne 6){throw 'text_focus_change_not_stopped'}
 $null=Text-Rpc 'finish' @{writeId=$id;complete=$false};Ui-Command 'read'
 if($shared.result -cne 'prefix' -or $shared.other -cne ''){throw 'text_suffix_leaked_to_other_control'}
 $closed=Invoke-Rm @{op='desktop.visual.detach';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken}
 if(-not $closed.scopeClosed){throw 'text_scope_not_closed'}
 $receipt=@{result='PASS';scope='isolated_actions_winforms_native_not_owner_physical';unicodeReadbackSizes=$sizes;sizeMeasurements=$script:completedSizes;elapsedMs=$script:totalClock.Elapsed.TotalMilliseconds;focusSwitchStopsSuffix=$true;otherControlUnmodified=$true;explicitClose=$true;automaticReplay=$false}
 $receipt|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $Output -Encoding utf8
 Write-Host ($receipt|ConvertTo-Json -Compress)
} catch {
 Write-Host "RM_TEXT_FAILED stage=$script:lastStage units=$script:testUnits offset=$script:testOffset error=$($_.Exception.Message)"
 throw
} finally {
 Write-Host "RM_TEXT_CLEANUP stage=$script:lastStage"
 # Kill the isolated helper first so any outstanding pipe/UIA read unblocks.
 if($null -ne $process -and -not $process.HasExited){$process.Kill();if(-not $process.WaitForExit(2000)){throw 'text_native_cleanup_timeout'}}
 # Test fixture is its own process: no PowerShell UI runspace disposal wait.
 if(-not $fixtureProcess.HasExited){$fixtureProcess.Kill();if(-not $fixtureProcess.WaitForExit(2000)){throw 'text_fixture_cleanup_timeout'}}
 foreach($stream in @($writer,$reader,$pipe,$fixtureWriter,$fixtureReader,$fixturePipe)){if($null -ne $stream){try{$stream.Dispose()}catch [IO.IOException]{}catch [ObjectDisposedException]{}}}
}
