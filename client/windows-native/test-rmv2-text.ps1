param([Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
# Isolated Actions desktop only. Never run on the Owner's installed desktop.
$shared=[hashtable]::Synchronized(@{ready=$false;command='';done=$false;initial='';result='';error=''})
$space=[runspacefactory]::CreateRunspace();$space.ApartmentState='STA';$space.ThreadOptions='ReuseThread';$space.Open()
$ui=[powershell]::Create();$ui.Runspace=$space
$null=$ui.AddScript({param($s)
 try {
  Add-Type -AssemblyName System.Windows.Forms
  $f=[Windows.Forms.Form]::new();$f.Text='RM isolated text acceptance';$f.Width=600;$f.Height=440;$f.TopMost=$true
  $a=[Windows.Forms.TextBox]::new();$a.Multiline=$true;$a.MaxLength=0;$a.SetBounds(20,20,540,160)
  $b=[Windows.Forms.TextBox]::new();$b.Multiline=$true;$b.MaxLength=0;$b.SetBounds(20,200,540,160)
  $f.Controls.AddRange(@($a,$b));$timer=[Windows.Forms.Timer]::new();$timer.Interval=30
  $timer.Add_Tick({
   if($s.command){
    $c=$s.command;$s.command=''
    if($c -eq 'reset'){$a.Text=$s.initial;$b.Clear();$f.Activate();$a.Focus();$a.Select($a.Text.Length,0)}
    if($c -eq 'other'){$b.Focus()}
    if($c -eq 'read'){$s.result=$a.Text;$s.other=$b.Text}
    if($c -eq 'close'){$f.Close()}
    $s.done=$true
   }
  }.GetNewClosure());$f.Add_Shown({$s.ready=$true;$a.Focus()}.GetNewClosure());$timer.Start()
  [Windows.Forms.Application]::Run($f);$timer.Dispose();$f.Dispose()
 }catch{$s.error=$_.Exception.Message;$s.ready=$true}
}).AddArgument($shared)
$uiTask=$ui.BeginInvoke();$process=$null;$pipe=$null;$reader=$null;$writer=$null
function Ui-Command([string]$Command,[string]$Initial=''){
 $shared.initial=$Initial;$shared.done=$false;$shared.command=$Command
 $wait=[diagnostics.stopwatch]::StartNew()
 while(-not $shared.done){if($shared.error){throw $shared.error};if($wait.ElapsedMilliseconds -gt 5000){throw 'text_fixture_timeout'};Start-Sleep -Milliseconds 20}
 Start-Sleep -Milliseconds 350
}
try {
 for($i=0;$i -lt 200 -and -not $shared.ready;$i++){Start-Sleep -Milliseconds 30}
 if(-not $shared.ready -or $shared.error){throw "text_fixture_start_failed:$($shared.error)"}
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
 $view=Invoke-Rm @{op='desktop.visual.attach';leaseMs=45000}
 function Text-Rpc([string]$Op,[hashtable]$Payload){
  $Payload.op='desktop.text.'+$Op;$Payload.visualSessionId=$view.visualSessionId;$Payload.leaseToken=$view.leaseToken
  return Invoke-Rm $Payload
 }
 $sizes=@()
 foreach($size in @(16384,65536,262144)){
  Ui-Command 'reset'
  # A surrogate pair and a combining sequence remain together in every chunk.
  $seed='Unicode '+[char]0x0110+[char]0x00e2+'y '+[char]::ConvertFromUtf32(0x1f600)+' e'+[char]0x0301+' '
  $text=($seed*([int][math]::Floor($size/$seed.Length)))+('x'*($size%$seed.Length))
  $id='write_'+[guid]::NewGuid().ToString('N')
  $prepared=Text-Rpc 'start' @{writeId=$id;requestedUnits=$text.Length;verification='required';mode='insert'}
  if(-not $prepared.verificationAvailable){throw 'text_fixture_readback_unavailable'}
  $offset=0
  while($offset -lt $text.Length){
   $take=[math]::Min(480,$text.Length-$offset)
   # Use .NET grapheme enumeration, not arbitrary UTF16 slicing.
   $remaining=$text.Substring($offset);$elements=[Globalization.StringInfo]::GetTextElementEnumerator($remaining);$chunk=''
   while($elements.MoveNext()){$e=$elements.GetTextElement();if($chunk.Length+$e.Length -gt $take){break};$chunk+=$e}
   $ack=Text-Rpc 'chunk' @{writeId=$id;offset=$offset;text=$chunk;intervalMs=0}
   if($ack.state -ne 'running' -or $ack.sentUnits -ne ($offset+$chunk.Length)){throw "text_chunk_interrupted:$($ack|ConvertTo-Json -Compress)"}
   $offset+=$chunk.Length
  }
  $final=Text-Rpc 'finish' @{writeId=$id;complete=$true}
  Ui-Command 'read'
  if($final.contentVerification -ne 'verified' -or $final.verifiedInsertedUnits -ne $text.Length -or $shared.result -cne $text){
   $actual=[string]$shared.result;$firstDifference=-1
   for($k=0;$k -lt [math]::Min($actual.Length,$text.Length);$k++){if($actual[$k] -cne $text[$k]){$firstDifference=$k;break}}
   if($firstDifference -eq -1 -and $actual.Length -ne $text.Length){$firstDifference=[math]::Min($actual.Length,$text.Length)}
   $expectedHash=[convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::Unicode.GetBytes($text)))
   $actualHash=[convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::Unicode.GetBytes($actual)))
   $normalizedEqual=$false;try{$normalizedEqual=$actual.Normalize([Text.NormalizationForm]::FormC) -ceq $text.Normalize([Text.NormalizationForm]::FormC)}catch{}
   $diagnostic=@{result='FAIL';scope='isolated_actions_synthetic_text_no_raw_content';requestedUnits=$text.Length;actualUnits=$actual.Length;firstDifference=$firstDifference;expectedUtf16Sha256=$expectedHash;actualUtf16Sha256=$actualHash;nfcEqualDiagnosticOnly=$normalizedEqual;lastChunk=$ack;final=$final}
   $diagnostic|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $Output -Encoding utf8
   Write-Host ($diagnostic|ConvertTo-Json -Depth 8 -Compress)
   throw "text_full_readback_failed:$size"
  }
  $sizes+=$size
 }
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
 $receipt=@{result='PASS';scope='isolated_actions_winforms_native_not_owner_physical';unicodeReadbackSizes=$sizes;focusSwitchStopsSuffix=$true;otherControlUnmodified=$true;explicitClose=$true;automaticReplay=$false}
 $receipt|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $Output -Encoding utf8
 Write-Host ($receipt|ConvertTo-Json -Compress)
} finally {
 if($null -ne $writer){$writer.Dispose()};if($null -ne $reader){$reader.Dispose()};if($null -ne $pipe){$pipe.Dispose()}
 if($null -ne $process -and -not $process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
 if($shared.ready -and -not $shared.error){try{Ui-Command 'close'}catch{}}
 if($uiTask.IsCompleted){$null=$ui.EndInvoke($uiTask)};$ui.Dispose();$space.Dispose()
}
