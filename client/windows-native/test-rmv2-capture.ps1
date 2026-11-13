param([Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
# Actual isolated Actions screen. These numbers are capture-only cold/warm
# measurements, not end-to-end latency or a comparison against a prior release.
$pipeName="lightremote-rmv2-capture-$PID"
$process=Start-Process -FilePath $Exe -ArgumentList @('--pipe',$pipeName) -PassThru -WindowStyle Hidden
$pipe=$null;$reader=$null;$writer=$null
try {
 $pipe=[IO.Pipes.NamedPipeClientStream]::new('.',$pipeName,[IO.Pipes.PipeDirection]::InOut);$pipe.Connect(10000)
 $reader=[IO.StreamReader]::new($pipe);$writer=[IO.StreamWriter]::new($pipe);$writer.AutoFlush=$true
 function Invoke-Rm([hashtable]$Request){
  $Request.id=[guid]::NewGuid().ToString('N');$writer.WriteLine(($Request|ConvertTo-Json -Depth 10 -Compress))
  $deadline=[diagnostics.stopwatch]::StartNew();$events=0
  while($deadline.ElapsedMilliseconds -lt 12000){
   $read=$reader.ReadLineAsync();$remaining=[math]::Max(1,12000-$deadline.ElapsedMilliseconds);if(-not $read.Wait([int]$remaining)){throw 'capture_native_timeout'}
   $row=$read.Result|ConvertFrom-Json;if($row.type -eq 'event'){$events++}
   if($row.type -eq 'response' -and $row.id -eq $Request.id){if(-not $row.ok){throw "capture_native_failure:$($row.error)"};return $row.data}
  };throw "capture_native_reply_missing op=$($Request.op) events=$events"
 }
 $status=Invoke-Rm @{op='desktop.status'};$screen=$status.native.Screens[0]
 $region=@{x=30;y=30;width=257;height=129}
 if($screen.Width -lt 300 -or $screen.Height -lt 200){throw 'capture_ci_screen_too_small'}
 $crop=Invoke-Rm @{op='desktop.frame';screen=0;region=$region;maxWidth=640;maxHeight=360;quality=50}
 if($crop.bounds.x -ne ($screen.X+30) -or $crop.bounds.y -ne ($screen.Y+30) -or $crop.frame.width -ne 257 -or $crop.frame.height -ne 129){throw 'capture_roi_geometry_mismatch'}
 if(-not $crop.freshPixelsChecked -or $crop.captureBackend -ne 'gdi'){throw 'capture_backend_metadata_missing'}
 $jpeg=[convert]::FromBase64String($crop.data)
 if($jpeg.Length -ne $crop.dataBytes -or $jpeg[0] -ne 255 -or $jpeg[1] -ne 216){throw 'capture_jpeg_payload_invalid'}
 $cleanup=Invoke-Rm @{op='desktop.visual.attach';leaseMs=45000}
 $null=Invoke-Rm @{op='desktop.visual.detach';visualSessionId=$cleanup.visualSessionId;leaseToken=$cleanup.leaseToken}
 Add-Type -AssemblyName System.Drawing
 $stream=[IO.MemoryStream]::new($jpeg);$image=[Drawing.Image]::FromStream($stream)
 try{if($image.Width -ne 257 -or $image.Height -ne 129){throw 'capture_actual_jpeg_dimensions_mismatch'}}finally{$image.Dispose();$stream.Dispose()}
 $cold=@();$warm=@();$reused=0;$omitted=0
 for($i=0;$i -lt 6;$i++){
  $view=Invoke-Rm @{op='desktop.visual.attach';screen=0;region=$region;leaseMs=45000;quality=50;maxWidth=640;maxHeight=360}
  $first=Invoke-Rm @{op='desktop.visual.frame';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken}
  if($first.frame.encodeReused){throw 'closed_scope_retained_private_capture_cache'}
  $cold+=[double]$first.frame.captureDurationMs
  $previous=$first.frame.frameSha256;$seq=$first.frameSeq
  for($j=0;$j -lt 4;$j++){
   $next=Invoke-Rm @{op='desktop.visual.frame';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken;previousFrameSha256=$previous;omitUnchanged=$true}
   if(-not $next.frame.freshPixelsChecked -or $next.frameSeq -le $seq){throw 'capture_returned_stale_frame_or_sequence'}
   if($next.frame.encodeReused){$reused++}
   if($next.frame.unchanged){if($null -ne $next.frame.data){throw 'unchanged_jpeg_was_not_omitted'};$omitted++}
   $warm+=[double]$next.frame.captureDurationMs;$previous=$next.frame.frameSha256;$seq=$next.frameSeq
  }
  $close=Invoke-Rm @{op='desktop.visual.detach';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken}
  if(-not $close.scopeClosed){throw 'capture_scope_close_unconfirmed'}
 }
 # Synthetic cache self-test verifies identical-pixel reuse deterministically;
 # actual screen reuse is recorded without assuming the CI desktop is static.
 function Percentile($values,[double]$p){$sorted=@($values|Sort-Object);return $sorted[[int][math]::Ceiling(($sorted.Count-1)*$p)]}
 $receipt=@{result='PASS';scope='isolated_actions_actual_gdi_screen_not_owner_physical';roi=$region;roiJpegValid=$true;freshPixelsEveryRead=$true;scopeCloseClearsCache=$true;frameSeqMonotonic=$true;coldSamples=$cold.Count;warmSamples=$warm.Count;coldCaptureP50Ms=(Percentile $cold .5);coldCaptureP95Ms=(Percentile $cold .95);warmCaptureP50Ms=(Percentile $warm .5);warmCaptureP95Ms=(Percentile $warm .95);actualEncodeReuseCount=$reused;actualPayloadOmissionCount=$omitted;comparison='SAME_SOURCE_CAPTURE_ONLY_COLD_ALLOCATION_VS_WARM_CACHE_NOT_PRIOR_RELEASE_OR_NETWORK';gpuPhysical='NOT_RUN';mixedDpiPhysical='PENDING_OWNER'}
 $receipt|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $Output -Encoding utf8
 Write-Host ($receipt|ConvertTo-Json -Depth 6 -Compress)
} finally {
 if($null -ne $writer){$writer.Dispose()};if($null -ne $reader){$reader.Dispose()};if($null -ne $pipe){$pipe.Dispose()}
 if(-not $process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
}
