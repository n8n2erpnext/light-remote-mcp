param([Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing.Common
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
public static class RmCursorProbe {
 [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr instance,IntPtr name);
 [DllImport("user32.dll")] static extern bool DrawIconEx(IntPtr dc,int x,int y,IntPtr icon,int width,int height,uint step,IntPtr brush,uint flags);
 public static string Roles() {
  var result="";
  foreach(int id in new[]{32512,32513,32514,32515,32642,32643,32644,32645,32646,32648,32649}) {
   var cursor=LoadCursor(IntPtr.Zero,(IntPtr)id);
   if(cursor==IntPtr.Zero)throw new Exception("cursor_role_missing:"+id);
   using(var image=new Bitmap(64,64))using(var g=Graphics.FromImage(image))using(var stream=new MemoryStream()) {
    var dc=g.GetHdc(); try { if(!DrawIconEx(dc,0,0,cursor,64,64,0,IntPtr.Zero,3))throw new Exception("cursor_draw_failed"); } finally { g.ReleaseHdc(dc); }
    image.Save(stream,ImageFormat.Png);
    result+=id+":"+Convert.ToHexString(SHA256.HashData(stream.ToArray()))+";";
   }
  }
  return result;
 }
}
'@ -ReferencedAssemblies @('System.Drawing.Common','System.Drawing.Primitives','System.Security.Cryptography')
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
  $move=Invoke-Rm @{op='desktop.input';actions=@(@{op='cursor.move';x=$x+$delta;y=$y;durationMs=0;steps=1})}
  if($move.native.Cursor.X -ne ($x+$delta) -or $move.native.Cursor.Y -ne $y){throw 'tiny_motion_endpoint_mismatch'}
  $timings+=[double]$move.nativeTiming.handlerMs
 }
 Start-Sleep -Milliseconds 100
 $active=Invoke-Rm @{op='status'}
 if($active.osCursorOverridden -or $active.cursorRenderer -ne 'native-system+ai-badge-border' -or -not $active.ambientGlowActive){throw 'active_badge_state_invalid'}
 if([RmCursorProbe]::Roles() -ne $baseline){throw 'native_system_cursor_role_changed'}
 Start-Sleep -Milliseconds 1100
 $quiet=Invoke-Rm @{op='status'};Start-Sleep -Milliseconds 180;$quietAgain=Invoke-Rm @{op='status'}
 if($quietAgain.ambientGlowActive -or $quietAgain.ambientGlowPaintCount -ne $quiet.ambientGlowPaintCount){throw 'hidden_indicator_timer_still_running'}
 $null=Invoke-Rm @{op='desktop.visual.detach';visualSessionId=$view.visualSessionId;leaseToken=$view.leaseToken}
 if([RmCursorProbe]::Roles() -ne $baseline){throw 'cursor_role_changed_after_detach'}
 $restore=Invoke-Rm @{op='cursor.restore'}
 if(-not $restore.restored -or $restore.osCursorOverridden){throw 'explicit_cursor_restore_failed'}
 $null=Invoke-Rm @{op='cursor.move';x=$x;y=$y;durationMs=0;steps=1}
 $afterRestore=Invoke-Rm @{op='status'}
 if($afterRestore.osCursorOverridden){throw 'cursor_reoverridden_after_restore'}
 $null=Invoke-Rm @{op='session.close'}
 $writer.Dispose();$reader.Dispose();$pipe.Dispose();$writer=$null;$reader=$null;$pipe=$null
 if(-not $process.WaitForExit(8000)){throw 'rmv2_phase1_did_not_exit'}
 $sorted=@($timings|Sort-Object)
 $receipt=@{result='PASS';scope='isolated_windows_ci_not_owner_physical';systemCursorRoles=11;tinyMoves=$timings.Count;observationNoOverride=$true;controlBadge=$true;idleTimerStopped=$true;restoreWhileAlive=$true;handlerP50Ms=$sorted[[int][math]::Floor(($sorted.Count-1)*0.5)];handlerP95Ms=$sorted[[int][math]::Ceiling(($sorted.Count-1)*0.95)];performanceComparison='NO_BEFORE_AFTER_BENCHMARK';physicalLocalTakeover='PENDING_OWNER';mixedDpiPhysical='PENDING_OWNER'}
 $receipt|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $Output -Encoding utf8
 Write-Host ($receipt|ConvertTo-Json -Compress)
} finally {
 if($null -ne $writer){$writer.Dispose()};if($null -ne $reader){$reader.Dispose()};if($null -ne $pipe){$pipe.Dispose()}
 if(-not $process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
}
