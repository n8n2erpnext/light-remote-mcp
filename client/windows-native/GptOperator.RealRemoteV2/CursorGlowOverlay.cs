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
    private readonly Ellipse _halo;
    private readonly Ellipse _clickRing;
    private System.Drawing.Point _lastPosition=new(int.MinValue,int.MinValue);
    private volatile bool _disposed;
    private volatile bool _shown;
    private nint _handle;
    private int _paintCount;

    private const int SizePx=76;
    private const int Anchor=24;
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
    public System.Drawing.Rectangle Bounds => new((int)Math.Round(Left),(int)Math.Round(Top),SizePx,SizePx);

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
        // Small warm light BEHIND the arrow, not a concentric bullseye.
        var gradient=new RadialGradientBrush{
            GradientOrigin=new System.Windows.Point(.40,.42),
            Center=new System.Windows.Point(.5,.5),
            RadiusX=.5,RadiusY=.5
        };
        gradient.GradientStops.Add(new GradientStop(System.Windows.Media.Color.FromArgb(52,255,197,93),0));
        gradient.GradientStops.Add(new GradientStop(System.Windows.Media.Color.FromArgb(15,255,194,74),.48));
        gradient.GradientStops.Add(new GradientStop(System.Windows.Media.Color.FromArgb(0,255,194,74),1));
        _halo=new Ellipse{Width=32,Height=29,Fill=gradient,IsHitTestVisible=false};
        Canvas.SetLeft(_halo,Anchor+2);
        Canvas.SetTop(_halo,Anchor+8);
        root.Children.Add(_halo);

        _clickRing=new Ellipse{
            Width=18,Height=18,Visibility=Visibility.Collapsed,
            Stroke=new SolidColorBrush(System.Windows.Media.Color.FromArgb(155,250,190,75)),
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
            Interval=TimeSpan.FromMilliseconds(33)
        };
        _timer.Tick+=(_,_)=>UpdateGlow();
        _timer.Start();
    }

    public void BeginInvoke(Action action)
    {
        if(_disposed)return;
        _=Dispatcher.BeginInvoke(action,DispatcherPriority.Normal);
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
            // Win32 Cursor.Position is physical pixels; WPF positions use DIPs.
            Left=(cursor.X-Anchor)/dpi.DpiScaleX;
            Top=(cursor.Y-Anchor)/dpi.DpiScaleY;
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
