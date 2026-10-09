using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace GptOperator.RealRemoteV2;

/// <summary>
/// Per-pixel-alpha, nonactivating and click-through Win32 cursor companion.
/// WPF supplies a real transparent layered window. WinForms TransparencyKey
/// flattened semi-transparent glow into the dark bullseye seen on Windows.
/// No redundant arrow, badge, app popup or input interception.
/// </summary>
internal sealed class CursorGlowOverlay : System.Windows.Window, IDisposable
{
    private readonly AgentCursorVisualState _visual;
    private readonly DispatcherTimer _timer;
    private readonly Dispatcher _uiDispatcher;
    private int _lastScreenLeft=-10000;
    private int _lastScreenTop=-10000;
    private readonly Ellipse _clickRing;
    private System.Drawing.Point _lastPosition=new(int.MinValue,int.MinValue);
    private volatile bool _disposed;
    private volatile bool _shown;
    private nint _handle;
    private int _paintCount;

    private const int SizePx=96;
    private const int Anchor=48;
    private const int GWL_EXSTYLE=-20;
    private const int WS_EX_TRANSPARENT=0x20;
    private const int WS_EX_TOOLWINDOW=0x80;
    private const int WS_EX_NOACTIVATE=0x08000000;

    [DllImport("user32.dll",EntryPoint="GetWindowLongW",SetLastError=true)]
    private static extern int GetWindowLong(nint hwnd,int index);
    [DllImport("user32.dll",EntryPoint="SetWindowLongW",SetLastError=true)]
    private static extern int SetWindowLong(nint hwnd,int index,int value);

    public bool IsDisposed => _disposed;
    public bool IsHandleCreated => _handle!=0;
    public bool Visible => _shown;
    public int PaintCount => System.Threading.Volatile.Read(ref _paintCount);
    // Native RPC calls run off the WPF UI thread. Never read Window.Left/Top
    // or any DependencyProperty inside the telemetry/status method.
    public System.Drawing.Rectangle Bounds => new(
        System.Threading.Volatile.Read(ref _lastScreenLeft),
        System.Threading.Volatile.Read(ref _lastScreenTop),SizePx,SizePx);

    public nint Handle
    {
        get {
            if(_handle==0)_handle=new WindowInteropHelper(this).EnsureHandle();
            return _handle;
        }
    }

    public CursorGlowOverlay(AgentCursorVisualState visual)
    {
        _visual=visual;
        _uiDispatcher=Dispatcher;
        Width=SizePx;
        Height=SizePx;
        Left=-10000;
        Top=-10000;
        WindowStyle=WindowStyle.None;
        ResizeMode=ResizeMode.NoResize;
        AllowsTransparency=true;
        Background=System.Windows.Media.Brushes.Transparent;
        ShowInTaskbar=false;
        ShowActivated=false;
        Topmost=true;
        Focusable=false;
        IsHitTestVisible=false;

        var root=new Canvas{
            Width=SizePx,Height=SizePx,IsHitTestVisible=false,
            Background=System.Windows.Media.Brushes.Transparent
        };
        // Three superposed continuous radial blooms around the pointer HOTSPOT.
        // Cyan supplies a bright center, blue stays distinct on white UI,
        // and a warm yellow outer ambience adds contrast on dark canvas.
        // Keep every circle mathematically centered, with NO direction/tail.
        AddCenteredBloom(root,80,255,210,62,
            (0.00,12),(0.36,47),(0.62,57),(0.82,26),(1.00,0)); // yellow
        AddCenteredBloom(root,60,57,119,246,
            (0.00,35),(0.35,83),(0.62,63),(0.85,22),(1.00,0)); // blue
        AddCenteredBloom(root,36,35,232,249,
            (0.00,95),(0.30,125),(0.67,52),(1.00,0)); // cyan

        _clickRing=new Ellipse{
            Width=18,Height=18,Visibility=Visibility.Collapsed,
            Stroke=new SolidColorBrush(System.Windows.Media.Color.FromArgb(180,94,225,255)),
            StrokeThickness=1.2,IsHitTestVisible=false
        };
        Canvas.SetLeft(_clickRing,Anchor-9);
        Canvas.SetTop(_clickRing,Anchor-9);
        root.Children.Add(_clickRing);
        Content=root;
        SourceInitialized+=(_,_)=>{
            _handle=new WindowInteropHelper(this).Handle;
            var style=GetWindowLong(_handle,GWL_EXSTYLE);
            _=SetWindowLong(_handle,GWL_EXSTYLE,style|WS_EX_TRANSPARENT|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE);
        };
        Closed+=(_,_)=>{
            _shown=false;
            _disposed=true;
            _timer.Stop();
        };
        _timer=new DispatcherTimer(DispatcherPriority.Render,Dispatcher){
            Interval=TimeSpan.FromMilliseconds(16)
        };
        _timer.Tick+=(_,_)=>UpdateGlow();
        _timer.Start();
    }

    private static void AddCenteredBloom(Canvas canvas,double diameter,
        byte red,byte green,byte blue,
        params (double offset,byte alpha)[] stops)
    {
        var bloom=new RadialGradientBrush{
            GradientOrigin=new System.Windows.Point(.5,.5),
            Center=new System.Windows.Point(.5,.5),
            RadiusX=.5,RadiusY=.5
        };
        foreach(var (offset,alpha) in stops)
            bloom.GradientStops.Add(new GradientStop(
                System.Windows.Media.Color.FromArgb(alpha,red,green,blue),offset));
        bloom.Freeze();
        var layer=new Ellipse{
            Width=diameter,Height=diameter,
            Fill=bloom,IsHitTestVisible=false
        };
        Canvas.SetLeft(layer,Anchor-diameter/2);
        Canvas.SetTop(layer,Anchor-diameter/2);
        canvas.Children.Add(layer);
    }

    public void BeginInvoke(Action action)
    {
        if(_disposed)return;
        _=_uiDispatcher.BeginInvoke(action,DispatcherPriority.Normal);
    }

    public new void Show()
    {
        if(_disposed)return;
        base.Show();
        _shown=true;
        UpdateGlow();
    }

    public new void Hide()
    {
        if(_disposed)return;
        base.Hide();
        _shown=false;
    }

    public new void Close()
    {
        if(_disposed)return;
        _disposed=true;
        _shown=false;
        _timer.Stop();
        base.Close();
    }

    public void Dispose()=>Close();

    private void UpdateGlow()
    {
        if(_disposed||!_shown)return;
        var cursor=System.Windows.Forms.Cursor.Position;
        if(cursor!=_lastPosition)
        {
            var dpi=VisualTreeHelper.GetDpi(this);
            // The mouse hotspot is in physical screen pixels, while Left/Top
            // and Anchor are WPF DIPs. Convert the pointer to DIPs FIRST,
            // then subtract the centered glow offset in DIPs.
            // (cursor.X-Anchor)/scale incorrectly adds Anchor*(scale-1)
            // physical pixels to the glow's center on scaled monitors.
            Left=cursor.X/dpi.DpiScaleX-Anchor;
            Top=cursor.Y/dpi.DpiScaleY-Anchor;
            System.Threading.Volatile.Write(ref _lastScreenLeft,cursor.X-Anchor);
            System.Threading.Volatile.Write(ref _lastScreenTop,cursor.Y-Anchor);
            _lastPosition=cursor;
        }

        var pulse=(float)_visual.Status().ClickPulse;
        if(pulse>0)
        {
            var r=9f+(1f-pulse)*11f;
            _clickRing.Width=2*r;
            _clickRing.Height=2*r;
            Canvas.SetLeft(_clickRing,Anchor-r);
            Canvas.SetTop(_clickRing,Anchor-r);
            _clickRing.Opacity=pulse*.85f;
            _clickRing.Visibility=Visibility.Visible;
        }
        else _clickRing.Visibility=Visibility.Collapsed;
        System.Threading.Interlocked.Increment(ref _paintCount);
    }
}
