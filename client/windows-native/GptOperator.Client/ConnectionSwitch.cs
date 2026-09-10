using System.Drawing.Drawing2D;

namespace GptOperator.Client;

internal sealed class ConnectionSwitch : Control
{
    private bool _checked;
    private bool _busy;

    public bool Checked
    {
        get => _checked;
        set { if (_checked == value) return; _checked = value; Invalidate(); }
    }

    public bool Busy
    {
        get => _busy;
        set { if (_busy == value) return; _busy = value; Invalidate(); }
    }

    public event Action<bool>? ToggleRequested;

    public ConnectionSwitch()
    {
        Size = new Size(104, 60);
        Cursor = Cursors.Hand;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
        AccessibleRole = AccessibleRole.CheckButton;
        TabStop = true;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var track = new Rectangle(8, 9, Width - 16, Height - 18);
        var radius = track.Height / 2f;
        using var trackPath = Capsule(track, radius);
        var baseColor = Checked ? UiTheme.Accent : Color.FromArgb(63, 70, 79);
        if (!Enabled) baseColor = Color.FromArgb(49, 55, 62);
        if (Busy) baseColor = Color.FromArgb(baseColor.R, baseColor.G, Math.Min(255, baseColor.B + 10));
        using var trackBrush = new SolidBrush(baseColor);
        e.Graphics.FillPath(trackBrush, trackPath);

        var knobSize = track.Height - 10;
        var knobX = Checked ? track.Right - knobSize - 5 : track.Left + 5;
        var knob = new Rectangle(knobX, track.Top + 5, knobSize, knobSize);
        using var shadow = new SolidBrush(Color.FromArgb(45, 0, 0, 0));
        e.Graphics.FillEllipse(shadow, knob.X + 1, knob.Y + 2, knob.Width, knob.Height);
        using var knobBrush = new SolidBrush(Color.White);
        e.Graphics.FillEllipse(knobBrush, knob);

        if (Focused)
        {
            using var pen = new Pen(UiTheme.Accent, 2);
            pen.DashStyle = DashStyle.Dot;
            e.Graphics.DrawRectangle(pen, 3, 4, Width - 7, Height - 9);
        }
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button == MouseButtons.Left && Enabled && ClientRectangle.Contains(e.Location))
            ToggleRequested?.Invoke(!Checked);
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (!Enabled) return;
        if (e.KeyCode is Keys.Space or Keys.Enter)
        {
            e.Handled = true;
            ToggleRequested?.Invoke(!Checked);
        }
    }

    private static GraphicsPath Capsule(Rectangle rect, float radius)
    {
        var path = new GraphicsPath();
        var diameter = radius * 2;
        path.AddArc(rect.X, rect.Y, diameter, diameter, 90, 180);
        path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 180);
        path.CloseFigure();
        return path;
    }
}
