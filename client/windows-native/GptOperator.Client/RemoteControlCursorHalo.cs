using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace GptOperator.Client;

internal sealed class RemoteControlCursorHalo : Form
{
    private const int HaloSize = 34;
    private const int WsExTransparent = 0x00000020;
    private const int WsExToolWindow = 0x00000080;
    private const int WsExLayered = 0x00080000;
    private const int WsExNoActivate = 0x08000000;

    private readonly System.Windows.Forms.Timer _followTimer = new() { Interval = 33 };
    private readonly Color _accent;
    private bool _active;

    public RemoteControlCursorHalo()
    {
        AutoScaleMode = AutoScaleMode.None;
        BackColor = Color.Fuchsia;
        TransparencyKey = Color.Fuchsia;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
        Size = new Size(HaloSize, HaloSize);
        _accent = ReadAccentColor();
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
        _followTimer.Tick += (_, _) => FollowCursor();
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WsExTransparent | WsExToolWindow | WsExLayered | WsExNoActivate;
            return cp;
        }
    }

    public void SetActive(bool active)
    {
        if (_active == active) return;
        _active = active;
        if (active)
        {
            FollowCursor();
            if (!Visible) Show();
            _followTimer.Start();
            Invalidate();
        }
        else
        {
            _followTimer.Stop();
            Hide();
        }
    }

    private void FollowCursor()
    {
        if (!_active) return;
        var point = Cursor.Position;
        var next = new Point(point.X - HaloSize / 2, point.Y - HaloSize / 2);
        if (Location != next) Location = next;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var glow = new Pen(Color.FromArgb(72, _accent), 4f);
        using var ring = new Pen(Color.FromArgb(220, _accent), 1.8f);
        e.Graphics.DrawEllipse(glow, 4, 4, HaloSize - 9, HaloSize - 9);
        e.Graphics.DrawEllipse(ring, 6, 6, HaloSize - 13, HaloSize - 13);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _followTimer.Dispose();
        base.Dispose(disposing);
    }

    private static Color ReadAccentColor()
    {
        try
        {
            if (DwmGetColorizationColor(out var raw, out _) == 0)
            {
                return Color.FromArgb(
                    255,
                    (int)((raw >> 16) & 0xff),
                    (int)((raw >> 8) & 0xff),
                    (int)(raw & 0xff));
            }
        }
        catch
        {
        }
        return SystemColors.Highlight;
    }

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmGetColorizationColor(out uint colorizationColor, out bool opaqueBlend);
}
