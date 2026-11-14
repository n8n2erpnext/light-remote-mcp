param([Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][string]$Output,[Parameter(Mandatory=$true)][string]$FixtureOutput)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true'){throw 'video_acceptance_actions_only'}
$fixture=Start-Process -FilePath $Exe -ArgumentList @('--video-fixture-output',$FixtureOutput) -PassThru -WindowStyle Hidden
if(-not $fixture.WaitForExit(90000)){$fixture.Kill();throw 'video_fixture_timeout'}
if($fixture.ExitCode -ne 0){if(Test-Path $FixtureOutput){Get-Content $FixtureOutput -Raw|Write-Host};throw 'video_fixture_encode_failed'}
$synthetic=Get-Content $FixtureOutput -Raw|ConvertFrom-Json
if($synthetic.result -ne 'ENCODED_BROWSER_DECODE_REQUIRED' -or $synthetic.frames.Count -ne 16){throw 'video_fixture_missing_frames'}
foreach($frame in $synthetic.frames){if(-not $frame.keyFrame -or $frame.format -ne 'annexb' -or $frame.dataBytes -lt 1 -or $frame.dataBytes -gt 665600){throw 'video_fixture_invalid_packet'}}
$priorBackend=$env:LIGHT_REMOTE_RM_CAPTURE_BACKEND;$env:LIGHT_REMOTE_RM_CAPTURE_BACKEND='dxgi'
$pipeName="lightremote-rmv2-video-$PID";$process=Start-Process -FilePath $Exe -ArgumentList @('--pipe',$pipeName) -PassThru -WindowStyle Hidden
$pipe=$null;$reader=$null;$writer=$null
try{
 $pipe=[IO.Pipes.NamedPipeClientStream]::new('.',$pipeName,[IO.Pipes.PipeDirection]::InOut);$pipe.Connect(10000)
 $reader=[IO.StreamReader]::new($pipe);$writer=[IO.StreamWriter]::new($pipe);$writer.AutoFlush=$true
 function Rpc([hashtable]$Request){
  $Request.id=[guid]::NewGuid().ToString('N');$writer.WriteLine(($Request|ConvertTo-Json -Compress));$clock=[diagnostics.stopwatch]::StartNew()
  while($clock.ElapsedMilliseconds -lt 10000){$read=$reader.ReadLineAsync();if(-not $read.Wait([int][math]::Max(1,10000-$clock.ElapsedMilliseconds))){throw 'video_native_timeout'};$reply=$read.Result|ConvertFrom-Json;if($reply.type -eq 'response' -and $reply.id -eq $Request.id){return $reply}}
  throw 'video_native_reply_missing'
 }
 function Success([hashtable]$Request){$reply=Rpc $Request;if(-not $reply.ok){throw "video_native_failure:$($reply.error)"};return $reply.data}
 $view=Success @{op='desktop.visual.attach';screen=0;maxWidth=320;maxHeight=180;leaseMs=45000}
 $bad=Rpc @{op='desktop.visual.video';visualSessionId=$view.visualSessionId;leaseToken='wrong';fps=5;preferHardware=$false}
 if($bad.ok){throw 'video_bad_lease_accepted'}
 $first=Success @{op='desktop.visual.video';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken;fps=5;preferHardware=$false}
 $second=Success @{op='desktop.visual.video';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken;fps=5;preferHardware=$false}
 if($second.frameSeq -le $first.frameSeq -or $first.video.mime -ne 'video/h264' -or -not $first.video.keyFrame -or $first.video.hardwareEncoding -or $first.video.encoderBackend -ne 'media-foundation-software'){throw 'video_live_scoped_metadata_invalid'}
 if($first.video.dataBytes -gt 665600 -or $first.video.zeroCopy -or $first.video.width -gt 320 -or $first.video.height -gt 180){throw 'video_live_budget_invalid'}
 $closed=Success @{op='desktop.visual.detach';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken}
 if(-not $closed.scopeClosed){throw 'video_close_not_confirmed'}
 $stale=Rpc @{op='desktop.visual.video';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken;fps=5;preferHardware=$false}
 if($stale.ok){throw 'video_closed_lease_reused'}
 $status=Success @{op='desktop.status'}
 if($status.captureCapabilities.optional.videoActive -or $status.captureCapabilities.optional.cleanupPending){throw 'video_resources_retained_after_close'}
 $receipt=@{result='NATIVE_PASS_BROWSER_DECODE_PENDING';scope='isolated_actions_native_video_not_owner_physical';syntheticIndependentFrames=16;softwareEncoder=$true;hardwarePreferenceTested=$true;hardwarePhysical='NOT_RUN';actualScopedCapture=$true;badLeaseDenied=$true;closedLeaseDenied=$true;closeClearsResources=$true;frameSeqMonotonic=$true;maxPacketBytes=665600;storedOnDisk=$false;captureBackendFirst=$first.video.captureBackend;gpuResizeFirst=$first.video.gpuResize;captureBackendSecond=$second.video.captureBackend;gpuResizeSecond=$second.video.gpuResize}
 $receipt|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $Output -Encoding utf8
}finally{
 $env:LIGHT_REMOTE_RM_CAPTURE_BACKEND=$priorBackend
 if(-not $process.HasExited){$process.Kill();$process.WaitForExit(3000)|Out-Null}
 foreach($stream in @($writer,$reader,$pipe)){if($null -ne $stream){try{$stream.Dispose()}catch{}}}
}
