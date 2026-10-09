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

    private const int SizePx=126;
    private const int Anchor=34;
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
        Enabled=false; // completely ignore all mouse/keyboard input
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
        // Do not clear to black or draw any rectangular hit-test surface.
        e.Graphics.Clear(_transparent);
        e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
        e.Graphics.CompositingQuality=CompositingQuality.HighQuality;
        var phase=_visual.Status();
        var t=Environment.TickCount64/350d;
        var breathe=(float)(0.8+0.2*Math.Sin(t));
        var click=(float)phase.ClickPulse;
        var moving=phase.Phase is "moving" or "dragging";
        var peak=moving?1.12f:1f;
        using (var cyan=new SolidBrush(Color.FromArgb((int)(32*breathe*peak),40,204,255)))
        using (var violet=new SolidBrush(Color.FromArgb((int)(48*breathe*peak),145,105,252)))
        using (var amber=new SolidBrush(Color.FromArgb((int)(65*breathe*peak),255,190,65)))
        using (var mint=new SolidBrush(Color.FromArgb((int)(88*breathe*peak),85,245,215)))
        {
            e.Graphics.FillEllipse(cyan,Anchor-24,Anchor-24,54,54);
            e.Graphics.FillEllipse(violet,Anchor-19,Anchor-19,40,40);
            e.Graphics.FillEllipse(amber,Anchor-12,Anchor-12,27,27);
            e.Graphics.FillEllipse(mint,Anchor-6,Anchor-6,14,14);
        }
        if(click>0)
        {
            var radius=18f+(1-click)*23f;
            using var ring=new Pen(Color.FromArgb((int)(190*click),255,198,78),1.2f+1.5f*click);
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
