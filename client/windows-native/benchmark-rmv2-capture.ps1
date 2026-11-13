param([Parameter(Mandatory=$true)][string]$BaselineExe,[Parameter(Mandatory=$true)][string]$CurrentExe,[Parameter(Mandatory=$true)][string]$CurrentSource,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
# Actions-only, two exact GitHub sources on the SAME isolated hosted desktop.
# Alternating ABBA reads reduce ordering/load bias. No input, screenshots saved,
# performance threshold, installation, network or physical-Owner speedup claim.
$baselineSource='241359b57ebda76306f23b81d51ce8fbd928207f'
$connections=@();$oldBackend=$env:LIGHT_REMOTE_RM_CAPTURE_BACKEND;$env:LIGHT_REMOTE_RM_CAPTURE_BACKEND='gdi'
function Connect-Rm([string]$Exe,[string]$Name){
 $process=Start-Process -FilePath $Exe -ArgumentList @('--pipe',$Name) -PassThru -WindowStyle Hidden
 $row=@{process=$process;pipe=$null;reader=$null;writer=$null;samples=@();native=@();bytes=@()}
 $script:connections+=$row
 $row.pipe=[IO.Pipes.NamedPipeClientStream]::new('.',$Name,[IO.Pipes.PipeDirection]::InOut);$row.pipe.Connect(10000)
 $row.reader=[IO.StreamReader]::new($row.pipe);$row.writer=[IO.StreamWriter]::new($row.pipe);$row.writer.AutoFlush=$true
 return $row
}
function Capture-Rm($Connection){
 $id=[guid]::NewGuid().ToString('N');$clock=[diagnostics.stopwatch]::StartNew()
 $request=@{id=$id;op='desktop.frame';screen=0;maxWidth=960;maxHeight=540;quality=50}
 $Connection.writer.WriteLine(($request|ConvertTo-Json -Compress))
 while($clock.ElapsedMilliseconds -lt 15000){
  $read=$Connection.reader.ReadLineAsync();$remaining=[math]::Max(1,15000-$clock.ElapsedMilliseconds)
  if(-not $read.Wait([int]$remaining)){throw 'benchmark_native_reply_timeout'}
  $reply=$read.Result|ConvertFrom-Json
  if($reply.type -eq 'response' -and $reply.id -eq $id){
   if(-not $reply.ok){throw "benchmark_native_failure:$($reply.error)"}
   $elapsed=$clock.Elapsed.TotalMilliseconds;$frame=$reply.data
   if($frame.mime -ne 'image/jpeg' -or -not $frame.data -or $frame.frame.width -gt 960 -or $frame.frame.height -gt 540){throw 'benchmark_frame_invalid'}
   # Use the SAME timing boundary in both sources. The prior source does not
   # expose captureDurationMs; absent timing must never become a fake zero.
   if($null -eq $frame.nativeTiming.handlerMs -or [double]$frame.nativeTiming.handlerMs -le 0){throw 'benchmark_common_native_timing_unavailable'}
   return @{roundtripMs=$elapsed;nativeMs=[double]$frame.nativeTiming.handlerMs;bytes=[int]$frame.dataBytes}
  }
 };throw 'benchmark_native_reply_missing'
}
function Percentile($Values,[double]$P){$sorted=@($Values|Sort-Object);return $sorted[[int][math]::Ceiling(($sorted.Count-1)*$P)]}
try {
 $base=Connect-Rm $BaselineExe "lightremote-bench-base-$PID";$current=Connect-Rm $CurrentExe "lightremote-bench-current-$PID"
 foreach($row in @($base,$current)){for($i=0;$i -lt 3;$i++){$null=Capture-Rm $row}}
 for($i=0;$i -lt 15;$i++){
  foreach($row in @($base,$current,$current,$base)){
   $sample=Capture-Rm $row;$row.samples+=,$sample.roundtripMs;$row.native+=,$sample.nativeMs;$row.bytes+=,$sample.bytes
  }
 }
 $baseP95=Percentile $base.samples .95;$currentP95=Percentile $current.samples .95
 $report=@{result='RECORDED';scope='ISOLATED_SAME_RUNNER_CAPTURE_AND_LOCAL_PIPE_ONLY_NOT_NETWORK_INPUT_OR_OWNER_HARDWARE';baselineSource=$baselineSource;currentSource=$CurrentSource;baselineExeSha256=(Get-FileHash $BaselineExe -Algorithm SHA256).Hash.ToLower();currentExeSha256=(Get-FileHash $CurrentExe -Algorithm SHA256).Hash.ToLower();requestedBackend='gdi';image=@{maxWidth=960;maxHeight=540;quality=50};warmupPerSource=3;sampleOrder='15_ABBA_ROUNDS';samplesPerSource=30;baseline=@{roundtripP50Ms=(Percentile $base.samples .5);roundtripP95Ms=$baseP95;nativeHandlerP50Ms=(Percentile $base.native .5);nativeHandlerP95Ms=(Percentile $base.native .95);roundtripSamples=$base.samples;nativeHandlerSamples=$base.native};current=@{roundtripP50Ms=(Percentile $current.samples .5);roundtripP95Ms=$currentP95;nativeHandlerP50Ms=(Percentile $current.native .5);nativeHandlerP95Ms=(Percentile $current.native .95);roundtripSamples=$current.samples;nativeHandlerSamples=$current.native};roundtripP95ChangePercent=(100*($currentP95-$baseP95)/$baseP95);acceptance='MEASUREMENT_ONLY_NO_SPEEDUP_THRESHOLD';ownerPhysical='PENDING'}
 $report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $Output -Encoding utf8
 Write-Host ($report|ConvertTo-Json -Depth 8 -Compress)
} finally {
 foreach($row in $connections){
  if(-not $row.process.HasExited){$row.process.Kill();if(-not $row.process.WaitForExit(2000)){throw 'benchmark_isolated_helper_cleanup_timeout'}}
  # Force termination closes the pipe; disposing its writer may flush and
  # throw. Release every wrapper without replacing a test failure/success.
  foreach($stream in @($row.writer,$row.reader,$row.pipe)){if($null -ne $stream){try{$stream.Dispose()}catch [IO.IOException]{}catch [ObjectDisposedException]{}}}
 }
 $env:LIGHT_REMOTE_RM_CAPTURE_BACKEND=$oldBackend
}
