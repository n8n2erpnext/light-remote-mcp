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

    public static object Capture(int screenIndex=0,int maxWidth=960,int maxHeight=540,int quality=50)
    {
        var all=Screen.AllScreens;
        if(screenIndex<0||screenIndex>=all.Length) throw new InvalidOperationException("screen_invalid");
        maxWidth=Math.Clamp(maxWidth,160,1280);
        maxHeight=Math.Clamp(maxHeight,90,720);
        quality=Math.Clamp(quality,25,70);
        var screen=all[screenIndex];
        var b=screen.Bounds;
        if(b.Width<=0||b.Height<=0) throw new InvalidOperationException("screen_bounds_invalid");

        using var full=new Bitmap(b.Width,b.Height,PixelFormat.Format24bppRgb);
        using(var g=Graphics.FromImage(full))
            g.CopyFromScreen(b.X,b.Y,0,0,new Size(b.Width,b.Height),CopyPixelOperation.SourceCopy);

        var scale=Math.Min(1d,Math.Min((double)maxWidth/b.Width,(double)maxHeight/b.Height));
        var outW=Math.Max(1,(int)Math.Round(b.Width*scale));
        var outH=Math.Max(1,(int)Math.Round(b.Height*scale));
        using var output=scale<0.999d?Resize(full,outW,outH):new Bitmap(full);

        byte[] bytes=Array.Empty<byte>();
        var appliedQuality=quality;
        for(var q=quality;q>=25;q-=5)
        {
            bytes=EncodeJpeg(output,q);
            appliedQuality=q;
            if(bytes.Length<=650*1024) break;
        }
        if(bytes.Length>650*1024) throw new InvalidOperationException("frame_too_large");

        var dpi=ReadDpi(screen);
        var topologyId=ReadTopologyId();
        var hash=Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        return new {
            screen=screenIndex,
            bounds=new {x=b.X,y=b.Y,width=b.Width,height=b.Height},
            frame=new {width=output.Width,height=output.Height,quality=appliedQuality},
            dpiX=dpi.X,
            dpiY=dpi.Y,
            displayTopologyId=topologyId,
            frameSha256=hash,
            dataBytes=bytes.Length,
            mime="image/jpeg",
            inputMapping=new {
                xOffset=b.X,
                yOffset=b.Y,
                xScale=(double)b.Width/output.Width,
                yScale=(double)b.Height/output.Height
            },
            data=Convert.ToBase64String(bytes)
        };
    }

    private static Bitmap Resize(Bitmap source,int width,int height)
    {
        var target=new Bitmap(width,height,PixelFormat.Format24bppRgb);
        using var g=Graphics.FromImage(target);
        g.InterpolationMode=InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode=PixelOffsetMode.HighQuality;
        g.DrawImage(source,new Rectangle(0,0,width,height));
        return target;
    }

    private static byte[] EncodeJpeg(Image image,int quality)
    {
        var codec=ImageCodecInfo.GetImageEncoders().First(c=>c.MimeType=="image/jpeg");
        using var ms=new MemoryStream();
        using var ep=new EncoderParameters(1);
        ep.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,(long)quality);
        image.Save(ms,codec,ep);
        return ms.ToArray();
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
