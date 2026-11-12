using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Brushes=System.Windows.Media.Brushes;
using Color=System.Windows.Media.Color;
using FontFamily=System.Windows.Media.FontFamily;

namespace GptOperator.RealRemoteV2;

// Native cursor stays intact. Badge and four thin edges are click-through,
// nonactivating windows; no full-screen input surface or hidden idle timer.
internal sealed class CursorGlowOverlay : System.Windows.Window,IDisposable
{
    private readonly ControlActivity _activity;
    private readonly DispatcherTimer _timer;
    private readonly List<System.Windows.Window> _edges=new();
    private readonly TextBlock _label;
    private int _left=-10000,_top=-10000,_width,_height,_paints;
    private volatile bool _disposed,_shown;
    private nint _handle;
    private long _previewUntil;
    private nint _lastCursor;
    private System.Drawing.Point _tail;
    private System.Drawing.Point _lastPosition=new(int.MinValue,int.MinValue);
    private bool _lastPreview,_lastPaused;
    private string _lastTopology="";
    private double _lastDpi;
    private System.Drawing.Point _lastPaintTail;
    private System.Drawing.Rectangle _lastScreen;
    public bool IsDisposed=>_disposed;
    public bool IsHandleCreated=>_handle!=0;
    public bool Visible=>_shown;
    public int PaintCount=>Volatile.Read(ref _paints);
    public System.Drawing.Rectangle Bounds=>new(Volatile.Read(ref _left),Volatile.Read(ref _top),Volatile.Read(ref _width),Volatile.Read(ref _height));
    public nint Handle=>_handle!=0?_handle:(_handle=new WindowInteropHelper(this).EnsureHandle());
    public CursorGlowOverlay(ControlActivity activity)
    {
        _activity=activity; Configure(this);
        _label=new TextBlock { Text="AI",FontFamily=new FontFamily(new Uri("pack://application:,,,/"),"./Assets/#Google Sans"),FontSize=10,FontWeight=FontWeights.SemiBold,
            Foreground=Brushes.White,HorizontalAlignment=System.Windows.HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center };
        Content=new Border { Background=new SolidColorBrush(Color.FromRgb(35,77,88)),CornerRadius=new CornerRadius(5),Child=_label };
        _timer=new DispatcherTimer(DispatcherPriority.Background,Dispatcher) { Interval=TimeSpan.FromMilliseconds(32) };
        _timer.Tick+=(_,_)=>UpdateIndicator();
        Closed+=(_,_)=>{ _shown=false; _disposed=true; _timer.Stop(); };
    }
    private static void Configure(System.Windows.Window window)
    {
        window.Width=28; window.Height=18; window.Left=-10000; window.Top=-10000;
        window.WindowStyle=WindowStyle.None; window.ResizeMode=ResizeMode.NoResize;
        window.AllowsTransparency=true; window.Background=Brushes.Transparent;
        window.ShowInTaskbar=false; window.ShowActivated=false; window.Topmost=true;
        window.Focusable=false; window.IsHitTestVisible=false;
        window.SourceInitialized+=(_,_)=>{
            var hwnd=new WindowInteropHelper(window).Handle;
            _=SetWindowLong(hwnd,-20,GetWindowLong(hwnd,-20)|WS_EX_TRANSPARENT|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE);
            // Best effort; this is not a security boundary or capture guarantee.
            if(OperatingSystem.IsWindowsVersionAtLeast(10,0,19041)) _=SetWindowDisplayAffinity(hwnd,0x11);
        };
    }
    private const int WS_EX_TRANSPARENT=0x20,WS_EX_TOOLWINDOW=0x80,WS_EX_NOACTIVATE=0x08000000;
    public void BeginInvoke(Action action) { if(!_disposed)_=Dispatcher.BeginInvoke(action); }
    public void SetPreview(long until) { _previewUntil=until; }
    public new void Show()
    {
        if(_disposed)return;
        if(!_shown) { _lastPosition=new(int.MinValue,int.MinValue); base.Show(); _shown=true; }
        _timer.Start(); UpdateIndicator();
    }
    public new void Hide()
    {
        if(_disposed)return;
        _timer.Stop(); base.Hide(); _shown=false; foreach(var edge in _edges)edge.Hide();
    }
    public new void Close()
    {
        if(_disposed)return;
        _timer.Stop(); foreach(var edge in _edges)edge.Close();
        _shown=false; _disposed=true; base.Close();
    }
    public void Dispose()=>Close();
    private void UpdateIndicator()
    {
        if(_disposed||!_shown)return;
        var preview=Environment.TickCount64<_previewUntil;
        if((!_activity.IndicatorVisible&&!preview)||!ControlActivity.InputDesktopAvailable()) { Hide(); return; }
        var cursor=System.Windows.Forms.Cursor.Position;
        var screen=System.Windows.Forms.Screen.FromPoint(cursor).Bounds;
        var dpi=GetDpiForWindow(Handle)/96d; if(dpi<=0)dpi=1;
        var tail=CursorTail();
        var borderScreen=_activity.TargetScreen??screen;
        var showPreview=preview&&!_activity.IndicatorVisible;
        var paused=_activity.PausedFeedback;
        var screens=System.Windows.Forms.Screen.AllScreens.Select(x=>x.Bounds).ToArray();
        var topology=string.Join(";",screens.Select(x=>x.ToString()));
        if(cursor==_lastPosition&&showPreview==_lastPreview&&paused==_lastPaused&&dpi==_lastDpi&&tail==_lastPaintTail&&borderScreen==_lastScreen&&topology==_lastTopology)return;
        _lastPaused=paused; _lastTopology=topology;
        _lastPosition=cursor; _lastPreview=showPreview; _lastDpi=dpi; _lastPaintTail=tail; _lastScreen=borderScreen;
        _label.Text=showPreview?"Preview":paused?"AI paused":"AI";
        ((Border)Content).Background=new SolidColorBrush(paused?Color.FromRgb(117,82,19):Color.FromRgb(35,77,88));
        var width=(int)Math.Ceiling((paused?74:showPreview?48:28)*dpi); var height=(int)Math.Ceiling(18*dpi);
        var bounds=PlaceBadge(cursor.X,cursor.Y,tail.X,tail.Y,width,height,screen,(int)Math.Ceiling(2*dpi));
        Place(this,bounds.X,bounds.Y,bounds.Width,bounds.Height);
        Volatile.Write(ref _left,bounds.X); Volatile.Write(ref _top,bounds.Y);
        Volatile.Write(ref _width,width); Volatile.Write(ref _height,height);
        var rects=new List<System.Drawing.Rectangle>();
        foreach(var display in screens) {
            var thickness=Math.Max(4,(int)Math.Ceiling(5*dpi));
            rects.AddRange(new[]{new System.Drawing.Rectangle(display.Left,display.Top,display.Width,thickness),
                new System.Drawing.Rectangle(display.Left,display.Bottom-thickness,display.Width,thickness),
                new System.Drawing.Rectangle(display.Left,display.Top+thickness,thickness,Math.Max(1,display.Height-2*thickness)),
                new System.Drawing.Rectangle(display.Right-thickness,display.Top+thickness,thickness,Math.Max(1,display.Height-2*thickness))});
        }
        while(_edges.Count<rects.Count) {
            var edge=new System.Windows.Window(); Configure(edge);
            edge.Content=new Border(); _edges.Add(edge);
        }
        for(var i=0;i<_edges.Count;i++) {
            if(showPreview||i>=rects.Count) { _edges[i].Hide(); continue; }
            var edge=_edges[i];var surface=(Border)edge.Content;
            surface.Background=new SolidColorBrush(paused?Color.FromArgb(160,171,121,30):Color.FromArgb(160,35,133,148));
            surface.BorderBrush=new SolidColorBrush(paused?Color.FromArgb(230,176,128,36):Color.FromArgb(230,35,133,148));
            surface.BorderThickness=new Thickness(1);
            if(!edge.IsVisible)edge.Show();
            var rect=rects[i]; Place(edge,rect.X,rect.Y,rect.Width,rect.Height);
        }
        // Static subtle border, no breathing animation, also for reduced motion.
        Interlocked.Increment(ref _paints);
    }
    internal static System.Drawing.Rectangle PlaceBadge(int x,int y,int tailX,int tailY,int width,int height,System.Drawing.Rectangle screen,int gap)
    {
        // Tail is measured from visible pixels, not the transparent cursor canvas.
        var left=x+tailX+gap; var top=y+tailY+gap;
        if(left+width>screen.Right)left=x-width-gap;
        if(top+height>screen.Bottom)top=y-height-gap;
        return new(Math.Clamp(left,screen.Left,Math.Max(screen.Left,screen.Right-width)),
            Math.Clamp(top,screen.Top,Math.Max(screen.Top,screen.Bottom-height)),width,height);
    }
    private System.Drawing.Point CursorTail()
    {
        var info=new CursorInfo { Size=Marshal.SizeOf<CursorInfo>() };
        if(GetCursorInfo(ref info)&&info.Cursor==_lastCursor)return _tail;
        _lastCursor=info.Cursor;
        if(GetIconInfo(info.Cursor,out var icon)) {
            try {
                if(GetObject(icon.Color!=0?icon.Color:icon.Mask,Marshal.SizeOf<BitmapInfo>(),out var size)!=0) {
                    var width=size.Width;var height=icon.Color!=0?size.Height:size.Height/2;
                    if(width>0&&height>0&&width<=512&&height<=512) {
                        var color=icon.Color!=0?ReadBitmap(icon.Color,width,height):null;
                        var mask=ReadBitmap(icon.Mask,width,icon.Color!=0?height:height*2);
                        var alpha=color is not null && Enumerable.Range(0,width*height).Any(i=>color[i*4+3]>0);
                        if(mask is not null) {
                            var tail=VisibleTail(width,height,(x,y)=>alpha?color![(y*width+x)*4+3]>24:
                                mask[(y*width+x)*4]<128 || icon.Color==0&&mask[((y+height)*width+x)*4]>128);
                            if(tail.HasValue)return _tail=new(tail.Value.X-(int)icon.HotspotX,tail.Value.Y-(int)icon.HotspotY);
                        }
                    }
                }
            } finally { if(icon.Mask!=0)DeleteObject(icon.Mask); if(icon.Color!=0)DeleteObject(icon.Color); }
        }
        return _tail=new(GetSystemMetrics(13),GetSystemMetrics(14));
    }
    internal static System.Drawing.Point? VisibleTail(int width,int height,Func<int,int,bool> visible)
    {
        for(var y=height-1;y>=0;y--) {
            var left=width;var right=-1;
            for(var x=0;x<width;x++)if(visible(x,y)){left=Math.Min(left,x);right=x;}
            if(right>=left)return new((left+right)/2,y+1);
        }
        return null;
    }
    private static byte[]? ReadBitmap(nint bitmap,int width,int height)
    {
        if(bitmap==0)return null;
        var header=new DibHeader{Size=40,Width=width,Height=-height,Planes=1,Bits=32};
        var data=new byte[checked(width*height*4)];var dc=GetDC(0);
        try { return GetDIBits(dc,bitmap,0,(uint)height,data,ref header,0)==height?data:null; }
        finally { if(dc!=0)ReleaseDC(0,dc); }
    }
    public object Diagnostics()
    {
        var rows=_edges.Where(x=>x.IsVisible).Select(x=>{
            var hwnd=new WindowInteropHelper(x).Handle;GetWindowRect(hwnd,out var rect);
            var surface=(Border)x.Content;
            var width=Math.Max(1,(int)Math.Ceiling(surface.ActualWidth));var height=Math.Max(1,(int)Math.Ceiling(surface.ActualHeight));
            var sample=new System.Windows.Media.Imaging.RenderTargetBitmap(width,height,96,96,PixelFormats.Pbgra32);
            sample.Render(surface);var pixel=new byte[4];
            sample.CopyPixels(new Int32Rect(width/2,height/2,1,1),pixel,4,0);
            return new {left=rect.Left,top=rect.Top,width=rect.Right-rect.Left,height=rect.Bottom-rect.Top,
                surfaceWidth=surface.ActualWidth,surfaceHeight=surface.ActualHeight,centerAlpha=pixel[3],clickThrough=(GetWindowLong(hwnd,-20)&WS_EX_TRANSPARENT)!=0};
        }).ToArray();
        return new {visible=_shown,label=_label.Text,edges=rows,screenCount=System.Windows.Forms.Screen.AllScreens.Length,tailX=_tail.X,tailY=_tail.Y};
    }
    private static void Place(System.Windows.Window window,int x,int y,int width,int height)
    {
        var hwnd=new WindowInteropHelper(window).EnsureHandle();
        // Size WPF's actual content surface as well as the HWND. Changing only
        // SetWindowPos can leave a tiny initial layout painted inside a long edge.
        var dpi=GetDpiForWindow(hwnd)/96d;if(dpi<=0)dpi=1;
        window.Width=width/dpi;window.Height=height/dpi;
        _=SetWindowPos(hwnd,(nint)(-1),x,y,width,height,0x0010|0x0040);
        window.UpdateLayout();
    }
    internal static bool SelfTest()
    {
        foreach(var scale in new[]{1d,1.5,2d}) {
            var screen=new System.Drawing.Rectangle(-1920,-200,1920,1080);
            var rect=PlaceBadge(-1,879,64,64,(int)(28*scale),(int)(18*scale),screen,4);
            if(!screen.Contains(rect)||rect.Right>0||rect.Bottom>880)return false;
        }
        // Transparent padding must not push a 20px arrow's badge 32px away.
        var tail=VisibleTail(32,32,(x,y)=>x==8&&y<20);
        return tail==new System.Drawing.Point(8,20);
    }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left,Top,Right,Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct DibHeader { public uint Size;public int Width,Height;public ushort Planes,Bits;public uint Compression,SizeImage;public int XPels,YPels;public uint Used,Important; }
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint window,out Rect rect);
    [DllImport("user32.dll")] private static extern nint GetDC(nint window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(nint window,nint dc);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(nint dc,nint bitmap,uint start,uint lines,byte[] bits,ref DibHeader info,uint usage);
    [StructLayout(LayoutKind.Sequential)] private struct CursorInfo { public int Size,Flags; public nint Cursor; public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] private struct IconInfo { public int Icon; public uint HotspotX,HotspotY; public nint Mask,Color; }
    [StructLayout(LayoutKind.Sequential)] private struct BitmapInfo { public int Type,Width,Height,WidthBytes; public ushort Planes,BitsPixel; public nint Bits; }
    [DllImport("user32.dll",EntryPoint="GetWindowLongW")] private static extern int GetWindowLong(nint hwnd,int index);
    [DllImport("user32.dll",EntryPoint="SetWindowLongW")] private static extern int SetWindowLong(nint hwnd,int index,int value);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(nint hwnd,nint after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] private static extern bool SetWindowDisplayAffinity(nint hwnd,uint affinity);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern bool GetCursorInfo(ref CursorInfo info);
    [DllImport("user32.dll")] private static extern bool GetIconInfo(nint cursor,out IconInfo info);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("gdi32.dll",EntryPoint="GetObjectW")] private static extern int GetObject(nint bitmap,int size,out BitmapInfo info);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(nint value);
}
