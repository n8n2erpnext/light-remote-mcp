using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace GptOperator.RealRemoteV2;

internal enum AgentCursorPhase
{
    Active,
    Moving,
    Clicking,
    Dragging,
    Scrolling
}

internal sealed record AgentCursorSnapshot(
    string Phase,
    double ClickPulse,
    string Button,
    int ClickCount
);

internal sealed class AgentCursorVisualState
{
    private readonly object _sync = new();
    private AgentCursorPhase _phase = AgentCursorPhase.Active;
    private long _phaseUntil;
    private long _clickStarted;
    private string _button = "left";
    private int _clickCount;

    public void MarkMove(int durationMs)
        => MarkPhase(AgentCursorPhase.Moving, Math.Clamp(durationMs + 110, 110, 700));

    public void MarkClick(string button, int count)
    {
        lock (_sync)
        {
            var now = Environment.TickCount64;
            _phase = AgentCursorPhase.Clicking;
            _phaseUntil = now + 250;
            _clickStarted = now;
            _button = String.IsNullOrWhiteSpace(button) ? "left" : button.ToLowerInvariant();
            _clickCount = Math.Clamp(count, 1, 3);
        }
    }

    public void MarkDrag(int durationMs)
        => MarkPhase(AgentCursorPhase.Dragging, Math.Clamp(durationMs + 140, 180, 5_200));

    public void MarkScroll()
        => MarkPhase(AgentCursorPhase.Scrolling, 180);

    private void MarkPhase(AgentCursorPhase phase, int durationMs)
    {
        lock (_sync)
        {
            _phase = phase;
            _phaseUntil = Environment.TickCount64 + Math.Max(1, durationMs);
        }
    }

    public AgentCursorSnapshot Snapshot(long now)
    {
        lock (_sync)
        {
            if (_phase != AgentCursorPhase.Active && now >= _phaseUntil)
                _phase = AgentCursorPhase.Active;

            var pulse = 0d;
            if (_clickStarted > 0)
            {
                var elapsed = now - _clickStarted;
                if (elapsed is >= 0 and < 260)
                    pulse = 1d - Math.Clamp(elapsed / 260d, 0d, 1d);
            }

            return new AgentCursorSnapshot(
                _phase.ToString().ToLowerInvariant(),
                pulse,
                _button,
                _clickCount
            );
        }
    }

    internal static bool SelfTest()
    {
        var state = new AgentCursorVisualState();
        var now = Environment.TickCount64;

        state.MarkMove(90);
        if (state.Snapshot(now).Phase != "moving") return false;

        state.MarkClick("left", 2);
        var click = state.Snapshot(Environment.TickCount64);
        if (click.Phase != "clicking" || click.ClickCount != 2 || click.Button != "left" || click.ClickPulse <= 0d)
            return false;

        state.MarkDrag(250);
        if (state.Snapshot(Environment.TickCount64).Phase != "dragging") return false;

        state.MarkScroll();
        if (state.Snapshot(Environment.TickCount64).Phase != "scrolling") return false;

        return true;
    }
}

internal sealed class AgentCursorForm : Form
{
    private const int CanvasSize = 64;
    private const int TipX = 18;
    private const int TipY = 20;

    private readonly AgentCursorVisualState _state = new();
    private Point _lastCursor = new(Int32.MinValue, Int32.MinValue);
    private string _lastPhase = "";
    private int _lastPulseBucket = -1;

    public AgentCursorForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Width = CanvasSize;
        Height = CanvasSize;
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            const int WS_EX_LAYERED = 0x00080000;
            const int WS_EX_TRANSPARENT = 0x00000020;
            const int WS_EX_TOOLWINDOW = 0x00000080;
            const int WS_EX_NOACTIVATE = 0x08000000;
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    public void MarkMove(int durationMs) => _state.MarkMove(durationMs);
    public void MarkClick(string button, int count) => _state.MarkClick(button, count);
    public void MarkDrag(int durationMs) => _state.MarkDrag(durationMs);
    public void MarkScroll() => _state.MarkScroll();

    public AgentCursorSnapshot Status()
        => _state.Snapshot(Environment.TickCount64);

    public void FollowCursor(bool force = false)
    {
        if (IsDisposed || !IsHandleCreated) return;

        ReassertTopMost();

        var cursor = Cursor.Position;
        var state = _state.Snapshot(Environment.TickCount64);
        var pulseBucket = (int)Math.Round(state.ClickPulse * 12d);

        if (!force && cursor == _lastCursor && state.Phase == _lastPhase && pulseBucket == _lastPulseBucket)
            return;

        _lastCursor = cursor;
        _lastPhase = state.Phase;
        _lastPulseBucket = pulseBucket;
        Render(cursor, state);
    }

    private void Render(Point cursor, AgentCursorSnapshot state)
    {
        using var bitmap = new Bitmap(CanvasSize, CanvasSize, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.Clear(Color.Transparent);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;

            var intensity = state.Phase switch
            {
                "dragging" => 1.18f,
                "clicking" => 1.12f,
                "moving" => 1.04f,
                _ => 1.0f
            };

            DrawCodexGlow(g, intensity);
            DrawPointer(g, state.Phase);
            if (state.ClickPulse > 0d)
                DrawClickPulse(g, state.ClickPulse);
        }

        UpdateLayered(cursor, bitmap);
        ReassertTopMost();
    }

    private static void DrawCodexGlow(Graphics g, float intensity)
    {
        static int A(float baseAlpha, float scale)
            => Math.Clamp((int)Math.Round(baseAlpha * scale), 0, 255);

        var glow = Color.FromArgb(A(36, intensity), 76, 255, 144);
        var glowMid = Color.FromArgb(A(54, intensity), 85, 255, 151);
        var glowCore = Color.FromArgb(A(76, intensity), 111, 255, 169);

        using var outer = new SolidBrush(glow);
        using var middle = new SolidBrush(glowMid);
        using var core = new SolidBrush(glowCore);

        g.FillEllipse(outer, TipX - 16, TipY - 16, 32, 32);
        g.FillEllipse(middle, TipX - 11, TipY - 11, 22, 22);
        g.FillEllipse(core, TipX - 7, TipY - 7, 14, 14);
    }

    private static void DrawPointer(Graphics g, string phase)
    {
        var path = new GraphicsPath();
        path.AddPolygon(new[]
        {
            new PointF(TipX, TipY),
            new PointF(TipX + 3.2f, TipY + 27.0f),
            new PointF(TipX + 9.8f, TipY + 21.2f),
            new PointF(TipX + 16.1f, TipY + 33.4f),
            new PointF(TipX + 21.2f, TipY + 31.0f),
            new PointF(TipX + 14.5f, TipY + 18.8f),
            new PointF(TipX + 24.2f, TipY + 18.2f)
        });
        path.CloseFigure();

        using var shadowPath = (GraphicsPath)path.Clone();
        using var shift = new Matrix();
        shift.Translate(2.0f, 2.4f);
        shadowPath.Transform(shift);

        using var shadow = new SolidBrush(Color.FromArgb(115, 0, 0, 0));
        using var accent = new Pen(Color.FromArgb(180, 104, 255, 162), phase == "dragging" ? 3.4f : 2.6f)
        {
            LineJoin = LineJoin.Round
        };
        using var edge = new Pen(Color.FromArgb(245, 244, 247, 246), 1.15f)
        {
            LineJoin = LineJoin.Round
        };
        using var fill = new SolidBrush(Color.FromArgb(248, 14, 16, 18));

        g.FillPath(shadow, shadowPath);
        g.DrawPath(accent, path);
        g.FillPath(fill, path);
        g.DrawPath(edge, path);
    }

    private static void DrawClickPulse(Graphics g, double pulse)
    {
        var expand = 1d - pulse;
        var radius = 5f + (float)(10d * expand);
        var alpha = Math.Clamp((int)Math.Round(185d * pulse), 0, 255);
        using var pen = new Pen(Color.FromArgb(alpha, 105, 255, 165), 1.7f);
        g.DrawEllipse(pen, TipX - radius, TipY - radius, radius * 2f, radius * 2f);
    }

    private void ReassertTopMost()
    {
        if (!IsHandleCreated || IsDisposed) return;

        const uint SWP_NOSIZE = 0x0001;
        const uint SWP_NOMOVE = 0x0002;
        const uint SWP_NOACTIVATE = 0x0010;
        const uint SWP_SHOWWINDOW = 0x0040;
        var flags = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW;
        _ = SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, flags);
    }
    private void UpdateLayered(Point cursor, Bitmap bitmap)
    {
        var screenDc = GetDC(IntPtr.Zero);
        var memoryDc = CreateCompatibleDC(screenDc);
        var hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
        var oldBitmap = SelectObject(memoryDc, hBitmap);

        try
        {
            var top = new NativePoint(cursor.X - TipX, cursor.Y - TipY);
            var source = new NativePoint(0, 0);
            var size = new NativeSize(CanvasSize, CanvasSize);
            var blend = new BlendFunction
            {
                BlendOp = 0,
                BlendFlags = 0,
                SourceConstantAlpha = 255,
                AlphaFormat = 1
            };

            _ = UpdateLayeredWindow(
                Handle,
                screenDc,
                ref top,
                ref size,
                memoryDc,
                ref source,
                0,
                ref blend,
                2
            );
        }
        finally
        {
            _ = SelectObject(memoryDc, oldBitmap);
            _ = DeleteObject(hBitmap);
            _ = DeleteDC(memoryDc);
            _ = ReleaseDC(IntPtr.Zero, screenDc);
        }
    }

    internal static bool StateSelfTest()
        => AgentCursorVisualState.SelfTest() && GeometrySelfTest();

    private static bool GeometrySelfTest()
    {
        const float margin = 1.0f;

        var glowLeft = TipX - 16f;
        var glowTop = TipY - 16f;
        var glowRight = TipX + 16f;
        var glowBottom = TipY + 16f;

        var pointerRight = TipX + 24.2f + 3.4f;
        var pointerBottom = TipY + 33.4f + 3.4f;

        var pulseLeft = TipX - 15f - 1.7f;
        var pulseTop = TipY - 15f - 1.7f;
        var pulseRight = TipX + 15f + 1.7f;
        var pulseBottom = TipY + 15f + 1.7f;

        return glowLeft >= margin
            && glowTop >= margin
            && glowRight <= CanvasSize - margin
            && glowBottom <= CanvasSize - margin
            && pointerRight <= CanvasSize - margin
            && pointerBottom <= CanvasSize - margin
            && pulseLeft >= margin
            && pulseTop >= margin
            && pulseRight <= CanvasSize - margin
            && pulseBottom <= CanvasSize - margin;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
        public NativePoint(int x, int y) { X = x; Y = y; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeSize
    {
        public int Width;
        public int Height;
        public NativeSize(int width, int height) { Width = width; Height = height; }
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct BlendFunction
    {
        public byte BlendOp;
        public byte BlendFlags;
        public byte SourceConstantAlpha;
        public byte AlphaFormat;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int X,
        int Y,
        int cx,
        int cy,
        uint uFlags
    );
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UpdateLayeredWindow(
        IntPtr hwnd,
        IntPtr hdcDst,
        ref NativePoint pptDst,
        ref NativeSize psize,
        IntPtr hdcSrc,
        ref NativePoint pptSrc,
        int crKey,
        ref BlendFunction pblend,
        int dwFlags
    );

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr dc);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr dc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr dc, IntPtr handle);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr handle);
}
