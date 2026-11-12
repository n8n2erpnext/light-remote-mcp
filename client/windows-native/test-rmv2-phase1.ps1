param([Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
public static class RmCursorProbe {
 [StructLayout(LayoutKind.Sequential)] struct IconInfo { public int Icon; public uint X,Y; public IntPtr Mask,Color; }
 [StructLayout(LayoutKind.Sequential)] struct BitmapInfo { public int Type,Width,Height,WidthBytes; public ushort Planes,BitsPixel; public IntPtr Bits; }
 [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr instance,IntPtr name);
 [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr cursor,out IconInfo info);
 [DllImport("gdi32.dll",EntryPoint="GetObjectW")] static extern int GetObject(IntPtr bitmap,int size,out BitmapInfo info);
 [DllImport("gdi32.dll")] static extern int GetBitmapBits(IntPtr bitmap,int size,byte[] bits);
 [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
 static string BitmapHash(IntPtr bitmap) {
  if(bitmap==IntPtr.Zero)return "none";
  BitmapInfo info;
  if(GetObject(bitmap,Marshal.SizeOf<BitmapInfo>(),out info)==0)throw new Exception("cursor_bitmap_missing");
  var size=checked(info.WidthBytes*Math.Abs(info.Height));
  if(size<=0||size>16*1024*1024)throw new Exception("cursor_bitmap_size_invalid");
  var bits=new byte[size];if(GetBitmapBits(bitmap,size,bits)!=size)throw new Exception("cursor_bitmap_read_failed");
  return info.Width+"x"+info.Height+":"+Convert.ToHexString(SHA256.HashData(bits));
 }
 public static string Roles() {
  var result="";
  foreach(int id in new[]{32512,32513,32514,32515,32642,32643,32644,32645,32646,32648,32649}) {
   var cursor=LoadCursor(IntPtr.Zero,(IntPtr)id);IconInfo icon;
   if(cursor==IntPtr.Zero||!GetIconInfo(cursor,out icon))throw new Exception("cursor_role_missing:"+id);
   try {result+=id+":"+icon.X+","+icon.Y+":"+BitmapHash(icon.Mask)+":"+BitmapHash(icon.Color)+";";}
   finally {if(icon.Mask!=IntPtr.Zero)DeleteObject(icon.Mask);if(icon.Color!=IntPtr.Zero)DeleteObject(icon.Color);}
  }
  return result;
 }
}
'@
$pipeName="lightremote-rmv2-phase1-$PID"
$process=Start-Process -FilePath $Exe -ArgumentList @('--pipe',$pipeName) -PassThru -WindowStyle Hidden
$pipe=$null;$reader=$null;$writer=$null
try {
 $pipe=[IO.Pipes.NamedPipeClientStream]::new('.',$pipeName,[IO.Pipes.PipeDirection]::InOut)
 $pipe.Connect(10000);$reader=[IO.StreamReader]::new($pipe);$writer=[IO.StreamWriter]::new($pipe);$writer.AutoFlush=$true
 function Invoke-Rm([hashtable]$Request) {
  $Request.id=[guid]::NewGuid().ToString('N');$writer.WriteLine(($Request|ConvertTo-Json -Depth 14 -Compress))
  for($i=0;$i -lt 80;$i++) {
   $read=$reader.ReadLineAsync(); if(-not $read.Wait(12000)){throw 'rmv2_response_timeout'}
   $line=$read.Result;if($null -eq $line){throw 'rmv2_pipe_eof'}
   $row=$line|ConvertFrom-Json
   if($row.type -eq 'response' -and $row.id -eq $Request.id) {
    if(-not $row.ok){throw "rmv2_failure:$($row.error)"};return $row.data
   }
  };throw 'rmv2_response_missing'
 }
 $baseline=[RmCursorProbe]::Roles()
 $idle=Invoke-Rm @{op='status'}
 if($idle.osCursorOverridden -or $idle.ambientGlowActive -or -not $idle.localInputMonitorAvailable){throw 'rmv2_idle_or_monitor_invalid'}
 $view=Invoke-Rm @{op='desktop.visual.attach';leaseMs=30000}
 $observed=Invoke-Rm @{op='status'}
 if($observed.osCursorOverridden -or $observed.ambientGlowActive -or $observed.controlState -ne 'observing'){throw 'observe_must_not_control'}
 Start-Sleep -Milliseconds 800
 $screen=$idle.native.Screens[0];$x=[int]$screen.X+[int]($screen.Width/2);$y=[int]$screen.Y+[int]($screen.Height/2)
 $timings=@()
 foreach($delta in @(0,1,2,3,4,5,4,3,2,1,0)) {
  $move=Invoke-Rm @{op='desktop.input';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken;actions=@(@{op='cursor.move';x=$x+$delta;y=$y;durationMs=0;steps=1})}
  if($move.native.Cursor.X -ne ($x+$delta) -or $move.native.Cursor.Y -ne $y){throw 'tiny_motion_endpoint_mismatch'}
  $timings+=[double]$move.nativeTiming.handlerMs
 }
 Start-Sleep -Milliseconds 100
 $active=Invoke-Rm @{op='status'}
 if($active.osCursorOverridden -or $active.cursorRenderer -ne 'native-system+ai-badge-border' -or -not $active.ambientGlowActive){throw 'active_badge_state_invalid'}
 if([RmCursorProbe]::Roles() -ne $baseline){throw 'native_system_cursor_role_changed'}
 # A live working session remains visibly marked between tool calls/model waits.
 Start-Sleep -Milliseconds 2200
 $working=Invoke-Rm @{op='status'}
 if(-not $working.ambientGlowActive -or $working.indicator.label -ne 'AI'){throw 'working_session_indicator_disappeared_between_actions'}
 $edges=@($working.indicator.edges)
 if($edges.Count -ne (4*$working.indicator.screenCount)){throw 'full_display_edges_not_visible'}
 foreach($edge in $edges) {
  if(-not $edge.clickThrough -or $edge.centerAlpha -lt 100 -or $edge.centerBlue -le $edge.centerRed -or $edge.centerGreen -le $edge.centerRed){throw 'edge_surface_not_painted_or_intercepts_input'}
  if([Math]::Max($edge.width,$edge.height) -lt 300 -or [Math]::Max($edge.surfaceWidth,$edge.surfaceHeight) -lt 250){throw 'edge_hwnd_or_wpf_surface_still_tiny'}
 }
 # An unrelated read-only view must not keep the completed task indicator alive.
 $readOnly=Invoke-Rm @{op='desktop.visual.attach';screen=0;leaseMs=5000}
 $closed=Invoke-Rm @{op='desktop.visual.detach';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken}
 if(-not $closed.scopeClosed -or -not $closed.indicatorStopped -or -not $closed.newAttachRequired){throw 'explicit_scope_close_not_acknowledged'}
 try {
  $null=Invoke-Rm @{op='desktop.input';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken;actions=@(@{op='cursor.move';x=$x;y=$y;durationMs=0;steps=1})}
  throw 'closed_scope_accepted_input'
 }catch{if($_.Exception.Message -notmatch 'visual_session_missing|visual_lease_expired'){throw}}

 Start-Sleep -Milliseconds 150
 $quiet=Invoke-Rm @{op='status'};Start-Sleep -Milliseconds 180;$quietAgain=Invoke-Rm @{op='status'}
 if($quietAgain.ambientGlowActive -or $quietAgain.ambientGlowPaintCount -ne $quiet.ambientGlowPaintCount){throw 'detached_indicator_timer_still_running'}
 if([RmCursorProbe]::Roles() -ne $baseline){throw 'cursor_role_changed_after_detach'}
 $restore=Invoke-Rm @{op='cursor.restore'}
 if(-not $restore.restored -or $restore.osCursorOverridden){throw 'explicit_cursor_restore_failed'}
 $null=Invoke-Rm @{op='cursor.move';x=$x;y=$y;durationMs=0;steps=1}
 $afterRestore=Invoke-Rm @{op='status'}
 if($afterRestore.osCursorOverridden){throw 'cursor_reoverridden_after_restore'}
 # Reopen is explicit. Repeated status queries must not keep an orphan alive.
 $reopened=Invoke-Rm @{op='desktop.visual.attach';screen=0;leaseMs=45000}
 if($reopened.visualSessionId -eq $view.visualSessionId){throw 'reopen_reused_closed_scope'}
 $null=Invoke-Rm @{op='desktop.input';visualSessionId=$reopened.visualSessionId;leaseToken=$reopened.leaseToken;actions=@(@{op='cursor.move';x=$x;y=$y;durationMs=0;steps=1})}
 for($i=0;$i -lt 8;$i++){Start-Sleep -Seconds 5;$pending=Invoke-Rm @{op='status'};if(-not $pending.ambientGlowActive){throw 'working_scope_expired_before45s'}}
 Start-Sleep -Seconds 6
 $expired=Invoke-Rm @{op='status'}
 if($expired.ambientGlowActive){throw 'status_poll_kept_orphan_indicator_alive_beyond45s'}
 $expiryClose=Invoke-Rm @{op='desktop.visual.detach';visualSessionId=$reopened.visualSessionId;leaseToken=$reopened.leaseToken}
 if(-not $expiryClose.scopeClosed -or -not $expiryClose.indicatorStopped){throw 'expired_scope_cleanup_unconfirmed'}
 $null=Invoke-Rm @{op='session.close'}
 $writer.Dispose();$reader.Dispose();$pipe.Dispose();$writer=$null;$reader=$null;$pipe=$null
 if(-not $process.WaitForExit(8000)){throw 'rmv2_phase1_did_not_exit'}
 $sorted=@($timings|Sort-Object)
 $receipt=@{result='PASS';scope='isolated_windows_ci_not_owner_physical';systemCursorRoles=11;tinyMoves=$timings.Count;observationNoOverride=$true;controlBadge=$true;workingGapIndicator=$true;explicitCloseAcknowledged=$true;closedScopeInputRejected=$true;readOnlyViewDoesNotKeepControlAlive=$true;reopenNewId=$true;orphanExpiry45sDespiteStatusPolling=$true;palette='outlook-light-sky-blue';paintedDisplayEdges=$edges;ownerInputBehavior="yield-current-input-keep-agent-session";idleTimerStopped=$true;restoreWhileAlive=$true;handlerP50Ms=$sorted[[int][math]::Floor(($sorted.Count-1)*0.5)];handlerP95Ms=$sorted[[int][math]::Ceiling(($sorted.Count-1)*0.95)];performanceComparison='NO_BEFORE_AFTER_BENCHMARK';physicalLocalTakeover='PENDING_OWNER';mixedDpiPhysical='PENDING_OWNER'}
 $receipt|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $Output -Encoding utf8
 Write-Host ($receipt|ConvertTo-Json -Compress)
} finally {
 if($null -ne $writer){$writer.Dispose()};if($null -ne $reader){$reader.Dispose()};if($null -ne $pipe){$pipe.Dispose()}
 if(-not $process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
}
