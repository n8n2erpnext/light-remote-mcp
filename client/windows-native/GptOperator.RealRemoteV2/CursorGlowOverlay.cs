using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
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
    private readonly ScaleTransform _arrowScale=new();
    // The aura follows the exact black cursor polygon, not circles around
    // a guessed hotspot/centroid; one silhouette drives both renderers.
    private const int SM_CXCURSOR=13;
    private const int SM_CYCURSOR=14;
    private System.Drawing.Point _lastPosition=new(int.MinValue,int.MinValue);
    private volatile bool _disposed;
    private volatile bool _shown;
    private nint _handle;
    private int _paintCount;

    private const int SizePx=72;
    private const int Anchor=28;
    private const int GWL_EXSTYLE=-20;
    private const int WS_EX_TRANSPARENT=0x20;
    private const int WS_EX_TOOLWINDOW=0x80;
    private const int WS_EX_NOACTIVATE=0x08000000;

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

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
        // Reference #2: a soft three-color glow radiating from the
        // SHAPE of the black arrow, not a detached orb/circular spotlight.
        // Preserve cyan / blue / yellow palette and a compact 4–10 DIP
        // feather beyond the arrow edges. The OS arrow is drawn above this.
        var geometry=CreateArrowGeometry();
        AddArrowAura(root,geometry,255,210,62,80,10); // soft yellow rim
        AddArrowAura(root,geometry,57,119,246,105,6); // blue transition
        AddArrowAura(root,geometry,35,232,249,130,3.5); // cyan core

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

    private static Geometry CreateArrowGeometry()
    {
        var geometry=new StreamGeometry();
        var points=AgentCursorShape.RelativeOutline;
        using(var ctx=geometry.Open())
        {
            ctx.BeginFigure(new System.Windows.Point(points[0].X,points[0].Y),true,true);
            for(var i=1;i<points.Length;i++)
                ctx.LineTo(new System.Windows.Point(points[i].X,points[i].Y),true,false);
        }
        geometry.Freeze();
        return geometry;
    }

    private void AddArrowAura(Canvas root,Geometry silhouette,
        byte red,byte green,byte blue,byte alpha,double blurRadius)
    {
        var aura=new System.Windows.Shapes.Path{
            Data=silhouette,
            Fill=new SolidColorBrush(System.Windows.Media.Color.FromArgb(alpha,red,green,blue)),
            StrokeThickness=0,
            Stretch=Stretch.None,
            IsHitTestVisible=false,
            Effect=new BlurEffect{Radius=blurRadius,KernelType=KernelType.Gaussian}
        };
        Canvas.SetLeft(aura,Anchor);
        Canvas.SetTop(aura,Anchor);
        aura.RenderTransform=_arrowScale;
        root.Children.Add(aura);
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
            // Render the SAME source polygon and SAME hotspot as the
            // native Win32 cursor, scaled from 48-unit art to screen DIPs.
            _arrowScale.ScaleX=GetSystemMetrics(SM_CXCURSOR)
                /AgentCursorShape.DesignSize/dpi.DpiScaleX;
            _arrowScale.ScaleY=GetSystemMetrics(SM_CYCURSOR)
                /AgentCursorShape.DesignSize/dpi.DpiScaleY;
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
