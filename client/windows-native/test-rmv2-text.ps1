param([Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][string]$Output,[Parameter(Mandatory=$true)][string]$FixtureExe,[ValidateSet('all','smoke','rich-paragraph','rich-single','classic-single','classic-paragraph','native-paragraph')][string]$CaseName='all')
$ErrorActionPreference='Stop'
# Isolated Actions desktop only. Never run on the Owner's installed desktop.
$script:lastStage='starting';$script:testUnits=0;$script:testOffset=0
$script:totalClock=[diagnostics.stopwatch]::StartNew();$script:sizeClock=$null;$script:chunkTiming=@();$script:completedSizes=@()
function Write-TextStage([string]$Stage){
 $script:lastStage=$Stage
 $row=@{result='RUNNING';scope='isolated_actions_synthetic_text_no_raw_content';stage=$Stage;requestedUnits=$script:testUnits;sentOffset=$script:testOffset;at=[datetime]::UtcNow.ToString('o');elapsedMs=$script:totalClock.Elapsed.TotalMilliseconds;sizeElapsedMs=$(if($script:sizeClock){$script:sizeClock.Elapsed.TotalMilliseconds}else{0});completedSizes=$script:completedSizes;lastChunkTiming=$script:chunkTiming;nativeMultilineLineEndings=$script:newlineReports}
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
function Normalize-LineEndings([string]$Text){return $Text.Replace("`r`n","`n").Replace("`r","`n")}
function Ui-Command([string]$Command,[string]$Initial='',[string]$Kind='classic',[int]$DelayMs=0){
 $request=@{id=[guid]::NewGuid().ToString('N');op=$Command;initial=$Initial;kind=$Kind;delayMs=$DelayMs}
 $fixtureWriter.WriteLine(($request|ConvertTo-Json -Compress))
 $read=$fixtureReader.ReadLineAsync();if(-not $read.Wait(15000)){throw "text_fixture_timeout:$Command"}
 $reply=$read.Result|ConvertFrom-Json
 if($reply.id -ne $request.id -or -not $reply.ok){throw 'text_fixture_reply_invalid'}
 if($Command -eq 'read'){$shared.result=$reply.data.text;$shared.other=$reply.data.other;$shared.characters=$reply.data.characters;$shared.keyDowns=$reply.data.keyDowns;$shared.controlMaxLength=$reply.data.controlMaxLength;$shared.wordWrap=$reply.data.wordWrap;$shared.controlKind=$reply.data.controlKind;$shared.delayMs=$reply.data.delayMs;$shared.accessibilityObjectCreated=$reply.data.accessibilityObjectCreated}
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
 $nativeCapabilities=(Invoke-Rm @{op='desktop.status'}).logicalText
 function Text-Rpc([string]$Op,[hashtable]$Payload){
  $Payload.op='desktop.text.'+$Op;$Payload.visualSessionId=$view.visualSessionId;$Payload.leaseToken=$view.leaseToken
  if($Op -eq 'chunk'){$Payload.authorityBudgetMs=1000}
  return Invoke-Rm $Payload
 }
 # Test LF/CRLF/CR before the expensive sizes. These are explicit native
 # multiline WANTRETURN controls; arbitrary form fields never gain Enter keys.
 $newlineReports=@()
 foreach($kind in @('classic','rich','native')){
  foreach($lineEnding in @("`n","`r`n","`r")){
   Ui-Command 'reset' '' $kind
   $id='write_'+[guid]::NewGuid().ToString('N');$lineText='first'+$lineEnding+'second'+$lineEnding+'third'
   $script:testUnits=$lineText.Length;$script:testOffset=0;Write-TextStage 'native_multiline_line_endings'
   $prepared=Text-Rpc 'start' @{writeId=$id;requestedUnits=$lineText.Length;verification='required';mode='insert'}
   if(-not $prepared.target.nativeMultilineLineBreaks){throw 'text_fixture_native_multiline_policy_not_bound'}
   $ack=Text-Rpc 'chunk' @{writeId=$id;offset=0;text=$lineText;intervalMs=0}
   if($ack.state -ne 'running' -or $ack.sentUnits -ne $lineText.Length){throw 'text_native_multiline_chunk_failed'}
   $final=Text-Rpc 'finish' @{writeId=$id;complete=$true};Ui-Command 'read'
   if($final.contentVerification -ne 'verified' -or $final.verifiedInsertedUnits -ne $lineText.Length -or (Normalize-LineEndings $shared.result) -cne (Normalize-LineEndings $lineText) -or $shared.other -cne ''){throw 'text_native_multiline_full_content_failed'}
   $newlineReports+=,@{controlKind=$kind;lineEndingCodeUnits=@([char[]]$lineEnding|ForEach-Object {[int]$_});sourceUnits=$lineText.Length;nativeVerified=$true;fullFixtureReadback=$true}
  }
 }
 # Actual deliberately slow keyboard delivery must be observed before more
 # input; no clipboard/SetValue, replay or reclassification of a failed ACK.
 Ui-Command 'reset' '' 'classic' 80
 $slowText='read-only completion after send';$id='write_'+[guid]::NewGuid().ToString('N')
 $script:testUnits=$slowText.Length;$script:testOffset=0;Write-TextStage 'delayed_delivery_test'
 $null=Text-Rpc 'start' @{writeId=$id;requestedUnits=$slowText.Length;verification='required';mode='insert'}
 $slowClock=[diagnostics.stopwatch]::StartNew();$slowAck=Text-Rpc 'chunk' @{writeId=$id;offset=0;text=$slowText;intervalMs=0}
 $ack=$slowAck
 if($slowAck.state -ne 'running' -or $slowAck.sentUnits -ne $slowText.Length -or -not $slowAck.authorityExpiredAtReceipt -or $slowClock.ElapsedMilliseconds -lt 1500){throw 'text_delayed_delivery_not_verified_after_admission_expiry'}
 $slowFinal=Text-Rpc 'finish' @{writeId=$id;complete=$true};Ui-Command 'read'
 if($slowFinal.contentVerification -ne 'verified' -or $slowFinal.verifiedInsertedUnits -ne $slowText.Length -or $shared.result -cne $slowText){throw 'text_delayed_delivery_full_readback_failed'}
 $slowReport=@{units=$slowText.Length;elapsedMs=$slowClock.Elapsed.TotalMilliseconds;nativeVerified=$true;exactFixtureReadback=$true;authorityExpiredAfterSend=$true;delayPerWmCharMs=$shared.delayMs}
 $sizes=@()
 $matrix=@(
  @{case='smoke';units=16384;kind='classic';layout='single-paragraph'},
  @{case='smoke';units=65536;kind='classic';layout='single-paragraph'},
  @{case='rich-paragraph';units=262144;kind='rich';layout='paragraphs-cr'},
  @{case='rich-single';units=262144;kind='rich';layout='single-paragraph'},
  @{case='classic-single';units=262144;kind='classic';layout='single-paragraph'},
  @{case='classic-paragraph';units=262144;kind='classic';layout='paragraphs-cr'},
  @{case='native-paragraph';units=262144;kind='native';layout='paragraphs-cr'}
 )
 if($CaseName -ne 'all'){$matrix=@($matrix|Where-Object {$_.case -eq $CaseName})}
 if($matrix.Count -lt 1){throw 'text_selected_case_missing'}
 $selectedCases=$matrix.Count
 foreach($case in $matrix){
  $size=$case.units
  $script:testUnits=$size;$script:testOffset=0;$script:sizeClock=[diagnostics.stopwatch]::StartNew();Write-TextStage 'resetting_control'
  $kind=$case.kind;$layout=$case.layout;Ui-Command 'reset' '' $kind
  # Required real managed controls include the previously failing cases.
  # Keep Unicode/grapheme coverage and actual keyboard messages, no paste.
  $seed='Unicode '+[char]0x0110+[char]0x00e2+'y '+[char]::ConvertFromUtf32(0x1f600)+' e'+[char]0x0301+' '
  if($layout -eq 'paragraphs-cr'){$seed=($seed*8)+"`r"}
  $text=($seed*([int][math]::Floor($size/$seed.Length)))+('x'*($size%$seed.Length))
  $id='write_'+[guid]::NewGuid().ToString('N')
  Write-TextStage 'binding_target'
  $prepared=Text-Rpc 'start' @{writeId=$id;requestedUnits=$text.Length;verification='required';mode='insert'}
  if(-not $prepared.verificationAvailable -or $prepared.verificationMethod -ne 'win32-empty-edit-full-line-endings'){throw 'text_fixture_native_readback_unavailable'}
  $chunkLimit=[int]$prepared.maxChunkUnits
  if($chunkLimit -lt 1 -or $chunkLimit -gt 256){throw 'text_fixture_native_window_invalid'}
  if($nativeCapabilities.chunkUnits -ne $chunkLimit){throw 'text_native_status_prepared_budget_mismatch'}
  $offset=0;$nextReport=0;Write-TextStage 'typing_chunks'
  while($offset -lt $text.Length){
   $take=[math]::Min($chunkLimit,$text.Length-$offset)
   # Use .NET grapheme enumeration, not arbitrary UTF16 slicing.
   $remaining=$text.Substring($offset);$elements=[Globalization.StringInfo]::GetTextElementEnumerator($remaining);$chunk=''
   while($elements.MoveNext()){$e=$elements.GetTextElement();if($chunk.Length+$e.Length -gt $take){break};$chunk+=$e}
   $ack=Text-Rpc 'chunk' @{writeId=$id;offset=$offset;text=$chunk;intervalMs=0}
   $script:chunkTiming=@{nativeHandlerMs=$ack.nativeTiming.handlerMs;nativeQueueMs=$ack.nativeQueueMs;sentUnits=$ack.sentUnits;observedUnits=$ack.lastObservedInsertedUnits;phase=$ack.phase;textTiming=$ack.textTiming}
   if($ack.state -ne 'running' -or $ack.sentUnits -ne ($offset+$chunk.Length)){
    # Observe the owned fixture AFTER native stops, without any more input or
    # retries. Three snapshots distinguish delayed delivery from actual loss.
    $snapshots=@();$stopped=[diagnostics.stopwatch]::StartNew()
    for($attempt=0;$attempt -lt 3;$attempt++){
     if($attempt -gt 0){Start-Sleep -Milliseconds 750}
     Ui-Command 'read';$actual=[string]$shared.result;$sent=$ack.sentUnits;$firstDifference=$null;$equal=$false;$expectedHash=$null
     if($null -ne $sent -and $sent -ge 0 -and $sent -le $text.Length){
      $expectedPrefix=$text.Substring(0,[int]$sent);$comparedActual=Normalize-LineEndings $actual;$comparedExpected=Normalize-LineEndings $expectedPrefix
      $equal=$comparedActual -ceq $comparedExpected;$firstDifference=-1
      for($k=0;$k -lt [math]::Min($comparedActual.Length,$comparedExpected.Length);$k++){if($comparedActual[$k] -cne $comparedExpected[$k]){$firstDifference=$k;break}}
      if($firstDifference -eq -1 -and $comparedActual.Length -ne $comparedExpected.Length){$firstDifference=[math]::Min($comparedActual.Length,$comparedExpected.Length)}
      $expectedHash=[convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::Unicode.GetBytes($expectedPrefix)))
     }
     $snapshots+=,@{afterStopMs=$stopped.Elapsed.TotalMilliseconds;actualUnits=$actual.Length;sentUnits=$sent;exactSentPrefix=$equal;firstDifference=$firstDifference;expectedUtf16Sha256=$expectedHash;actualUtf16Sha256=([convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::Unicode.GetBytes($actual))));fixtureWmCharCount=$shared.characters;fixtureKeyDownCount=$shared.keyDowns;otherUnits=([string]$shared.other).Length;fixtureMaxLength=$shared.controlMaxLength;wordWrap=$shared.wordWrap;controlKind=$shared.controlKind}
    }
    $failure=@{result='FAIL';scope='isolated_actions_synthetic_text_no_raw_content';stage=$script:lastStage;requestedUnits=$script:testUnits;lastAcknowledgedOffset=$offset;lastNativeReply=$ack;completedSizes=$script:completedSizes;nativeMultilineLineEndings=$newlineReports;deliverySnapshots=$snapshots;automaticReplay=$false;lateFixtureMatchDoesNotChangeNativeFailure=$true}
    $failure|ConvertTo-Json -Depth 9|Set-Content -LiteralPath $Output -Encoding utf8
    throw "text_chunk_interrupted:$($ack|ConvertTo-Json -Compress)"
   }
   $offset+=$chunk.Length
   $script:testOffset=$offset
   if($offset -ge $nextReport){Write-TextStage 'typing_chunks';$nextReport=$offset+8192}
  }
  Write-TextStage 'verifying_native_readback'
  $final=Text-Rpc 'finish' @{writeId=$id;complete=$true}
  Write-TextStage 'reading_fixture_control'
  Ui-Command 'read'
  Write-TextStage 'comparing_complete_text'
  if($final.contentVerification -ne 'verified' -or $final.verifiedInsertedUnits -ne $text.Length -or (Normalize-LineEndings $shared.result) -cne (Normalize-LineEndings $text)){
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
  if($shared.accessibilityObjectCreated){throw 'text_fast_readback_activated_managed_accessibility_provider'}
  $sizes+=$size
  $script:completedSizes+=,@{units=$size;elapsedMs=$script:sizeClock.Elapsed.TotalMilliseconds;fullFixtureReadback=$true;comparison='full-content-line-ending-equivalence-only';nativeVerified=$true;controlKind=$shared.controlKind;wordWrap=$shared.wordWrap;layout=$layout;accessibilityObjectCreated=$shared.accessibilityObjectCreated;verificationMethod=$prepared.verificationMethod}
 }
 Ui-Command 'reset' 'before:' 'classic'
 $id='write_'+[guid]::NewGuid().ToString('N')
 $prepared=Text-Rpc 'start' @{writeId=$id;requestedUnits=5;verification='required';mode='append'}
 if($prepared.verificationMethod -notlike 'uia-*'){throw 'text_nonempty_selection_fallback_missing'}
 $null=Text-Rpc 'chunk' @{writeId=$id;offset=0;text='after';intervalMs=0}
 $final=Text-Rpc 'finish' @{writeId=$id;complete=$true};Ui-Command 'read'
 if($final.contentVerification -ne 'verified' -or $shared.result -cne 'before:after'){throw 'text_nonempty_append_failed'}
 $script:testUnits=12;$script:testOffset=0;Write-TextStage 'focus_switch_test'
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
 if($script:completedSizes.Count -ne $selectedCases){throw 'text_selected_cases_not_complete'}
 $receipt=@{caseName=$CaseName;selectedCaseCount=$selectedCases;allSelectedCasesVerified=$true;result='PASS';scope='isolated_actions_native_and_managed_editors_not_owner_physical';nativeMultilineLineEndings=$newlineReports;unicodeReadbackSizes=$sizes;sizeMeasurements=$script:completedSizes;delayedDelivery=$slowReport;requiredManaged262KCases=@($matrix|Where-Object {$_.units -eq 262144 -and $_.kind -ne 'native'}).Count;managedAccessibilityProviderNotActivated=$true;elapsedMs=$script:totalClock.Elapsed.TotalMilliseconds;focusSwitchStopsSuffix=$true;otherControlUnmodified=$true;explicitClose=$true;automaticReplay=$false}
 $receipt|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $Output -Encoding utf8
 Write-Host ($receipt|ConvertTo-Json -Compress)
} catch {
 # Preserve a detailed mismatch diagnostic; other failures gain their exact
 # stage/ack/timing instead of leaving a misleading RUNNING artifact behind.
 $existing=Get-Content -LiteralPath $Output -Raw|ConvertFrom-Json
 if($existing.result -eq 'RUNNING'){
  $failure=@{result='FAIL';scope='isolated_actions_synthetic_text_no_raw_content';stage=$script:lastStage;requestedUnits=$script:testUnits;lastAcknowledgedOffset=$script:testOffset;completedSizes=$script:completedSizes;nativeMultilineLineEndings=$newlineReports;elapsedMs=$script:totalClock.Elapsed.TotalMilliseconds;lastNativeReply=$ack;error=$_.Exception.Message}
  $failure|ConvertTo-Json -Depth 9|Set-Content -LiteralPath $Output -Encoding utf8
 }
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
