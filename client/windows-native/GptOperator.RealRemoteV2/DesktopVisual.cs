using System.IO;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace GptOperator.RealRemoteV2;

internal static class DesktopVisual
{
    private const uint MONITOR_DEFAULTTONEAREST=2;

    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left,Top,Right,Bottom; }

    private delegate bool EnumWindowsProc(nint hwnd,nint lParam);

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback,nint lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(nint hwnd);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetWindowText(nint hwnd,StringBuilder text,int count);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetClassName(nint hwnd,StringBuilder text,int count);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd,out RECT rect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd,out uint processId);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern nint MonitorFromPoint(POINT point,uint flags);
    [DllImport("shcore.dll")] private static extern int GetDpiForMonitor(nint monitor,int dpiType,out uint dpiX,out uint dpiY);

    public static object ReadTopology()
    {
        var screens=Screen.AllScreens.Select((s,i)=>{
            var dpi=ReadDpi(s);
            return new {
                index=i,
                deviceName=s.DeviceName,
                primary=s.Primary,
                bounds=new {x=s.Bounds.X,y=s.Bounds.Y,width=s.Bounds.Width,height=s.Bounds.Height},
                workingArea=new {x=s.WorkingArea.X,y=s.WorkingArea.Y,width=s.WorkingArea.Width,height=s.WorkingArea.Height},
                dpiX=dpi.X,
                dpiY=dpi.Y
            };
        }).ToArray();
        var v=SystemInformation.VirtualScreen;
        var topologyId=ReadTopologyId();
        return new {
            displayTopologyId=topologyId,
            virtualScreen=new {x=v.X,y=v.Y,width=v.Width,height=v.Height},
            screens
        };
    }

    public static int ReadScreenCount() => Screen.AllScreens.Length;

    public static (int X,int Y) LocalToVirtualPoint(int screenIndex,int x,int y)
    {
        var all=Screen.AllScreens;
        if(screenIndex<0||screenIndex>=all.Length) throw new InvalidOperationException("screen_invalid");
        var bounds=all[screenIndex].Bounds;
        if(x<0||y<0||x>=bounds.Width||y>=bounds.Height) throw new InvalidOperationException("screen_coordinates_invalid");
        return (bounds.X+x,bounds.Y+y);
    }

    public static string ReadTopologyId()
    {
        var raw=string.Join("|",Screen.AllScreens.Select((screen,index)=>{
            var dpi=ReadDpi(screen);
            return $"{index}:{screen.DeviceName}:{screen.Primary}:{screen.Bounds.X},{screen.Bounds.Y},{screen.Bounds.Width},{screen.Bounds.Height}:{dpi.X},{dpi.Y}";
        }));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();
    }

    public static object[] ListWindows(int maxWindows=100)
    {
        maxWindows=Math.Clamp(maxWindows,1,250);
        var foreground=GetForegroundWindow();
        var rows=new List<object>();
        EnumWindows((hwnd,unused)=>{
            if(rows.Count>=maxWindows) return false;
            if(!IsWindowVisible(hwnd)) return true;
            var len=GetWindowTextLength(hwnd);
            if(len<=0) return true;
            var title=new StringBuilder(Math.Min(len+1,1024));
            _=GetWindowText(hwnd,title,title.Capacity);
            if(string.IsNullOrWhiteSpace(title.ToString())) return true;
            var cls=new StringBuilder(256);
            _=GetClassName(hwnd,cls,cls.Capacity);
            _=GetWindowThreadProcessId(hwnd,out var pid);
            _=GetWindowRect(hwnd,out var r);
            rows.Add(new {
                hwnd=hwnd.ToInt64(),
                processId=pid,
                title=title.ToString(),
                className=cls.ToString(),
                foreground=hwnd==foreground,
                bounds=new {x=r.Left,y=r.Top,width=Math.Max(0,r.Right-r.Left),height=Math.Max(0,r.Bottom-r.Top)}
            });
            return true;
        },0);
        return rows.ToArray();
    }

    private static readonly GdiFrameCache FrameCache=new();
    private static readonly DxgiCapture Dxgi=new();
    private static readonly DesktopVideo Video=new();
    private static readonly object CaptureGate=new();
    private static int _clearRequested;
    public static string RequestedCaptureBackend=>String.Equals(Environment.GetEnvironmentVariable("LIGHT_REMOTE_RM_CAPTURE_BACKEND"),"dxgi",StringComparison.OrdinalIgnoreCase)?"dxgi":"gdi";
    public static object CaptureCapabilities()=>new {requestedBackend=RequestedCaptureBackend,defaultBackend="gdi",cleanupPending=Volatile.Read(ref _clearRequested)!=0,dxgi=Dxgi.Metadata(),
        transport="existing-authorized-image-jpeg-or-pull-h264",videoStreamingSupported=true,videoActive=Video.Active,videoCodec="h264-annexb-independent-idr",hardwareEncoder="media-foundation-prefer-with-software-fallback",gpuResizeSupported=true,gpuResizeBackend="dxgi-d3d11-compute"};
    public static void ClearCaptureCache()
    {
        Interlocked.Exchange(ref _clearRequested,1);
        // Expiry/status/detach may call this while holding the visual-session
        // gate. Never wait there for a slow GPU/desktop capture or driver Map.
        if(!Monitor.TryEnter(CaptureGate))return;
        try{DrainCaptureCleanup();}finally{Monitor.Exit(CaptureGate);}
    }
    private static void DrainCaptureCleanup()
    {
        if(Interlocked.Exchange(ref _clearRequested,0)==0)return;
        try{FrameCache.Clear();Video.Dispose();Dxgi.Clear();}catch{Interlocked.Exchange(ref _clearRequested,1);throw;}
    }
    public static object CaptureVideo(string scope,int screen,int width,int height,Rectangle? region,int fps,bool hardware,bool gpu,Action guard)
    {
        lock(CaptureGate) {
            DrainCaptureCleanup();
            try{return Video.Capture(scope,screen,width,height,region,fps,hardware,gpu,Dxgi,guard);}
            catch{Video.Dispose();throw;}
            finally{DrainCaptureCleanup();}
        }
    }
    internal static Rectangle Crop(Rectangle bounds,Rectangle? region)
    {
        var local=region??new Rectangle(0,0,bounds.Width,bounds.Height);
        if(local.X<0||local.Y<0||local.Width<1||local.Height<1||
           (long)local.X+local.Width>bounds.Width||(long)local.Y+local.Height>bounds.Height)
            throw new InvalidOperationException("frame_region_outside_screen");
        return new Rectangle(bounds.X+local.X,bounds.Y+local.Y,local.Width,local.Height);
    }
    public static object Capture(int screenIndex=0,int maxWidth=960,int maxHeight=540,int quality=50,
        Rectangle? region=null,string previousSha="",bool omitUnchanged=false)
    {
        lock(CaptureGate) {
        DrainCaptureCleanup();
        try {
        var all=Screen.AllScreens;
        if(screenIndex<0||screenIndex>=all.Length)throw new InvalidOperationException("screen_invalid");
        maxWidth=Math.Clamp(maxWidth,160,1280);maxHeight=Math.Clamp(maxHeight,90,720);quality=Math.Clamp(quality,25,70);
        var screen=all[screenIndex];var screenBounds=screen.Bounds;var b=Crop(screenBounds,region);
        var topologyBefore=ReadTopologyId();var startedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var clock=System.Diagnostics.Stopwatch.StartNew();
        var scale=Math.Min(1d,Math.Min((double)maxWidth/b.Width,(double)maxHeight/b.Height));
        var outW=Math.Max(1,(int)Math.Round(b.Width*scale));var outH=Math.Max(1,(int)Math.Round(b.Height*scale));
        var requestedBackend=RequestedCaptureBackend;var backend="gdi";var fallback="";
        var key=$"{requestedBackend}:{topologyBefore}:{screenIndex}:{b.X},{b.Y},{b.Width},{b.Height}:{outW},{outH}:{quality}";
        EncodedCapture captured;
        try {
            if(requestedBackend!="dxgi")throw new CaptureBackendUnavailable();
            // Cache/encode only the output-sized bitmap. Full screen pixels stay
            // on D3D11 until after crop and resize; never CPU-map the full frame.
            captured=FrameCache.CaptureBitmap(key+":gpu-scaled",outW,outH,outW,outH,quality,(bitmap,graphics)=>{
                if(!Dxgi.TryCopy(bitmap,screen.DeviceName,screenBounds,b,topologyBefore,out fallback))throw new CaptureBackendUnavailable();
                backend="dxgi-d3d11";
            });
        }catch(CaptureBackendUnavailable) {
            captured=FrameCache.CaptureBitmap(key+":fresh-gdi",b.Width,b.Height,outW,outH,quality,(bitmap,graphics)=>
                graphics.CopyFromScreen(b.X,b.Y,0,0,new Size(b.Width,b.Height),CopyPixelOperation.SourceCopy));
        }
        var topologyId=ReadTopologyId();
        if(topologyBefore!=topologyId)throw new InvalidOperationException("display_topology_changed_during_capture");
        var dpi=ReadDpi(screen);var unchanged=omitUnchanged&&previousSha==captured.Sha256;
        return new {
            screen=screenIndex,bounds=new {x=b.X,y=b.Y,width=b.Width,height=b.Height},
            screenBounds=new {x=screenBounds.X,y=screenBounds.Y,width=screenBounds.Width,height=screenBounds.Height},
            frame=new {width=captured.Width,height=captured.Height,quality=captured.Quality},
            dpiX=dpi.X,dpiY=dpi.Y,displayTopologyId=topologyId,frameSha256=captured.Sha256,
            dataBytes=captured.Bytes,mime="image/jpeg",unchanged,
            capturedAt=startedAt,captureDurationMs=clock.Elapsed.TotalMilliseconds,
            captureBackend=backend,requestedCaptureBackend=requestedBackend,captureFallback=fallback.Length>0?fallback:null,
            gpuCapture=backend=="dxgi-d3d11",gpuResize=backend=="dxgi-d3d11",gpuResizeStage=backend=="dxgi-d3d11"?"before-cpu-readback":null,readbackPixels=backend=="dxgi-d3d11"?outW*outH:b.Width*b.Height,hardwareEncoding=false,
            freshPixelsChecked=true,encodeReused=captured.EncodeReused,
            captureTiming=new {copyMs=captured.CopyMs,pixelHashMs=captured.HashMs,encodeMs=captured.EncodeMs},
            captureCounters=new {captures=captured.Captures,encodes=captured.Encodes},
            effectiveLimits=new {maxWidth=1280,maxHeight=720,minQuality=25,maxQuality=70,maxSourcePixels=16*1024*1024,latestCacheEntries=1},
            inputMapping=new {xOffset=b.X,yOffset=b.Y,xScale=(double)b.Width/captured.Width,yScale=(double)b.Height/captured.Height,
                coordinateConvention="frame-pixel-centers-to-physical-virtual-no-extra-dpi"},
            data=unchanged?null:captured.Data
        };
        } finally {DrainCaptureCleanup();}
        }
    }
    private sealed class CaptureBackendUnavailable:Exception {}
    internal static bool CleanupSelfTest()
    {
        using var entered=new ManualResetEventSlim();using var release=new ManualResetEventSlim();
        var worker=Task.Run(()=>{lock(CaptureGate){entered.Set();release.Wait(TimeSpan.FromSeconds(3));DrainCaptureCleanup();}});
        if(!entered.Wait(TimeSpan.FromSeconds(3))){release.Set();return false;}
        var responsive=false;
        try {
            var clock=System.Diagnostics.Stopwatch.StartNew();ClearCaptureCache();
            responsive=clock.ElapsedMilliseconds<=200&&Volatile.Read(ref _clearRequested)!=0;
        } finally {release.Set();}
        return worker.Wait(TimeSpan.FromSeconds(3))&&responsive&&Volatile.Read(ref _clearRequested)==0;
    }
    internal static bool CropSelfTest()
    {
        var b=new Rectangle(-1920,-200,1920,1080);var c=Crop(b,new Rectangle(40,50,100,80));
        if(c!=new Rectangle(-1880,-150,100,80))return false;
        try{Crop(b,new Rectangle(1910,0,20,20));return false;}catch(InvalidOperationException){}
        try{Crop(b,new Rectangle(-1,0,20,20));return false;}catch(InvalidOperationException){}
        return true;
    }

    private static (uint X,uint Y) ReadDpi(Screen screen)
    {
        try
        {
            var p=new POINT{X=screen.Bounds.Left+screen.Bounds.Width/2,Y=screen.Bounds.Top+screen.Bounds.Height/2};
            var monitor=MonitorFromPoint(p,MONITOR_DEFAULTTONEAREST);
            if(monitor!=0 && GetDpiForMonitor(monitor,0,out var x,out var y)==0) return (x,y);
        }
        catch {}
        return (96,96);
    }
}
