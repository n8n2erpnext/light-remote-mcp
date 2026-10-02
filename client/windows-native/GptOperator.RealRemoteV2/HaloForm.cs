using System.Drawing;
using System.Drawing.Drawing2D;

namespace GptOperator.RealRemoteV2;

internal sealed class HaloForm : Form
{
    private const int SizePx = 48;

    public HaloForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        Width = SizePx;
        Height = SizePx;
        BackColor = Color.Magenta;
        TransparencyKey = Color.Magenta;
        StartPosition = FormStartPosition.Manual;
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            const int WS_EX_TRANSPARENT = 0x20;
            const int WS_EX_TOOLWINDOW = 0x80;
            const int WS_EX_NOACTIVATE = 0x08000000;
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    public void FollowCursor()
    {
        var p = Cursor.Position;
        Location = new Point(p.X - Width / 2, p.Y - Height / 2);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;

        using var glowOuter = new Pen(Color.FromArgb(168, 126, 0), 1.2f);
        using var glowInner = new Pen(Color.FromArgb(232, 176, 0), 1.8f);
        using var halo = new Pen(Color.FromArgb(248, 191, 10), 3.0f);
        using var shine = new Pen(Color.FromArgb(255, 239, 161), 1.8f)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round
        };

        e.Graphics.DrawEllipse(glowOuter, 3, 3, Width - 7, Height - 7);
        e.Graphics.DrawEllipse(glowInner, 5, 5, Width - 11, Height - 11);
        e.Graphics.DrawEllipse(halo, 7, 7, Width - 15, Height - 15);
        e.Graphics.DrawArc(shine, 7, 7, Width - 15, Height - 15, 200, 70);
    }
}
