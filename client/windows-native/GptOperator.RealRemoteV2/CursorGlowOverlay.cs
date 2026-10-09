using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace GptOperator.RealRemoteV2;

/// <summary>
/// Live, per-session RM V2 ambient glow. The OS cursor stays a real Win32
/// cursor (SetSystemCursor + SetCursorPos), not a simulated DOM element.
/// This nonactivating, click-through window renders ONLY the surrounding
/// animation; drawing a second arrow would duplicate the cursor/hotspot.
/// Opt-in for UAT until a real Windows owner has approved the appearance.
/// </summary>
internal sealed class CursorGlowOverlay : Form
{
    private readonly AgentCursorVisualState _visual;
    private readonly System.Windows.Forms.Timer _timer;
    private readonly Color _transparent=Color.FromArgb(255,3,1,7);
    private Point _lastPosition=new(int.MinValue,int.MinValue);
    private long _lastRender;
    private bool _disposed;
    private int _paintCount;
    public int PaintCount => _paintCount;

    private const int SizePx=74;
    private const int Anchor=23;
    private const int WS_EX_TRANSPARENT=0x20;
    private const int WS_EX_TOOLWINDOW=0x80;
    private const int WS_EX_NOACTIVATE=0x08000000;

    protected override bool ShowWithoutActivation => true;
    protected override CreateParams CreateParams
    {
        get {
            var cp=base.CreateParams;
            cp.ExStyle|=WS_EX_TRANSPARENT|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE;
            return cp;
        }
    }

    public CursorGlowOverlay(AgentCursorVisualState visual)
    {
        _visual=visual;
        FormBorderStyle=FormBorderStyle.None;
        ShowInTaskbar=false;
        StartPosition=FormStartPosition.Manual;
        Size=new Size(SizePx,SizePx);
        BackColor=_transparent;
        TransparencyKey=_transparent;
        TopMost=true;
        // Keep painting enabled. Extended styles plus no-activation enforce
        // click-through; disabling the Form prevents proper layered paints.
        SetStyle(ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.UserPaint,true);

        _timer=new System.Windows.Forms.Timer{Interval=33};
        _timer.Tick+=(_,_)=>UpdateGlow();
        _timer.Start();
        UpdateGlow();
    }

    private void UpdateGlow()
    {
        if(_disposed||IsDisposed)return;
        var cursor=Cursor.Position;
        if(cursor!=_lastPosition)
        {
            Location=new Point(cursor.X-Anchor,cursor.Y-Anchor);
            _lastPosition=cursor;
            Invalidate();
            _lastRender=Environment.TickCount64;
            return;
        }
        // 8Hz refresh while idle, ~30Hz while clicking/dragging.
        var status=_visual.Status();
        var interactive=status.Phase is "clicking" or "dragging";
        var interval=interactive?33:125;
        if(Environment.TickCount64-_lastRender>=interval)
        {
            _lastRender=Environment.TickCount64;
            Invalidate();
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        _paintCount++;
        // Do not clear to black or draw any rectangular hit-test surface.
        e.Graphics.Clear(_transparent);
        e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
        e.Graphics.CompositingQuality=CompositingQuality.HighQuality;
        var phase=_visual.Status();
        var click=(float)phase.ClickPulse;
        // Muted amber tail, offset BELOW the real cursor hotspot.
        // Avoid the old bullseye of four centered cyan/violet/mint discs.
        using (var outer=new SolidBrush(Color.FromArgb(13,255,196,66)))
        using (var inner=new SolidBrush(Color.FromArgb(24,255,209,103)))
        {
            e.Graphics.FillEllipse(outer,Anchor+4,Anchor+9,30,26);
            e.Graphics.FillEllipse(inner,Anchor+8,Anchor+12,18,16);
        }
        if(click>0)
        {
            var radius=9f+(1f-click)*10f;
            using var ring=new Pen(Color.FromArgb((int)(104*click),255,194,82),1f);
            e.Graphics.DrawEllipse(ring,Anchor-radius,Anchor-radius,2*radius,2*radius);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if(disposing&&!_disposed)
        {
            _disposed=true;
            _timer.Stop();
            _timer.Dispose();
        }
        base.Dispose(disposing);
    }
}
