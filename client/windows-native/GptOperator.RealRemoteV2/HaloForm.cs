using System.Drawing;
using System.Drawing.Drawing2D;

namespace GptOperator.RealRemoteV2;

internal sealed class HaloForm : Form
{
    private const int SizePx = 42;

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
        using var pen = new Pen(Color.FromArgb(225, 0, 210, 255), 3f);
        e.Graphics.DrawEllipse(pen, 4, 4, Width - 9, Height - 9);
    }
}
