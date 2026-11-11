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
    private readonly System.Windows.Window[] _edges;
    private readonly TextBlock _label;
    private int _left=-10000,_top=-10000,_width,_height,_paints;
    private volatile bool _disposed,_shown;
    private nint _handle;
    private long _previewUntil;
    private nint _lastCursor;
    private System.Drawing.Point _tail;
    private System.Drawing.Point _lastPosition=new(int.MinValue,int.MinValue);
    private bool _lastPreview;
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
        _edges=Enumerable.Range(0,4).Select(_=>{
            var window=new System.Windows.Window(); Configure(window);
            window.Background=new SolidColorBrush(Color.FromArgb(105,69,153,165)); return window;
        }).ToArray();
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
        if((!_activity.Active&&!preview)||!ControlActivity.InputDesktopAvailable()) { Hide(); return; }
        var cursor=System.Windows.Forms.Cursor.Position;
        var screen=System.Windows.Forms.Screen.FromPoint(cursor).Bounds;
        var dpi=GetDpiForWindow(Handle)/96d; if(dpi<=0)dpi=1;
        var tail=CursorTail();
        var borderScreen=_activity.TargetScreen??screen;
        var showPreview=preview&&!_activity.Active;
        if(cursor==_lastPosition&&showPreview==_lastPreview&&dpi==_lastDpi&&tail==_lastPaintTail&&borderScreen==_lastScreen)return;
        _lastPosition=cursor; _lastPreview=showPreview; _lastDpi=dpi; _lastPaintTail=tail; _lastScreen=borderScreen;
        _label.Text=showPreview?"Preview":"AI";
        var width=(int)Math.Ceiling((preview?48:28)*dpi); var height=(int)Math.Ceiling(18*dpi);
        var bounds=PlaceBadge(cursor.X,cursor.Y,tail.X,tail.Y,width,height,screen,(int)Math.Ceiling(4*dpi));
        Place(this,bounds.X,bounds.Y,bounds.Width,bounds.Height);
        Volatile.Write(ref _left,bounds.X); Volatile.Write(ref _top,bounds.Y);
        Volatile.Write(ref _width,width); Volatile.Write(ref _height,height);
        screen=borderScreen;
        var thickness=Math.Max(2,(int)Math.Ceiling((SystemParameters.HighContrast?2:3)*dpi));
        var rects=new[]{new System.Drawing.Rectangle(screen.Left,screen.Top,screen.Width,thickness),
            new System.Drawing.Rectangle(screen.Left,screen.Bottom-thickness,screen.Width,thickness),
            new System.Drawing.Rectangle(screen.Left,screen.Top+thickness,thickness,Math.Max(1,screen.Height-2*thickness)),
            new System.Drawing.Rectangle(screen.Right-thickness,screen.Top+thickness,thickness,Math.Max(1,screen.Height-2*thickness))};
        for(var i=0;i<_edges.Length;i++) {
            if(preview&&!_activity.Active) { _edges[i].Hide(); continue; }
            if(!_edges[i].IsVisible)_edges[i].Show();
            var rect=rects[i]; Place(_edges[i],rect.X,rect.Y,rect.Width,rect.Height);
        }
        // Static subtle border, no breathing animation, also for reduced motion.
        Interlocked.Increment(ref _paints);
    }
    internal static System.Drawing.Rectangle PlaceBadge(int x,int y,int tailX,int tailY,int width,int height,System.Drawing.Rectangle screen,int gap)
    {
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
                var bitmap=icon.Color!=0?icon.Color:icon.Mask;
                if(GetObject(bitmap,Marshal.SizeOf<BitmapInfo>(),out var size)!=0)
                    return _tail=new(Math.Max(0,size.Width-(int)icon.HotspotX),Math.Max(0,(icon.Color!=0?size.Height:size.Height/2)-(int)icon.HotspotY));
            } finally { if(icon.Mask!=0)DeleteObject(icon.Mask); if(icon.Color!=0)DeleteObject(icon.Color); }
        }
        return _tail=new(GetSystemMetrics(13),GetSystemMetrics(14));
    }
    private static void Place(System.Windows.Window window,int x,int y,int width,int height)
    {
        var hwnd=new WindowInteropHelper(window).EnsureHandle();
        // Physical pixels avoid transforming negative origins with the wrong DPI.
        _=SetWindowPos(hwnd,(nint)(-1),x,y,width,height,0x0010|0x0040);
    }
    internal static bool SelfTest()
    {
        foreach(var scale in new[]{1d,1.5,2d}) {
            var screen=new System.Drawing.Rectangle(-1920,-200,1920,1080);
            var rect=PlaceBadge(-1,879,64,64,(int)(28*scale),(int)(18*scale),screen,4);
            if(!screen.Contains(rect)||rect.Right>0||rect.Bottom>880)return false;
        }
        return true;
    }
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
