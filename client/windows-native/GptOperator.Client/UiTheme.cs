using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace GptOperator.Client;

internal static class UiTheme
{
    public static readonly Color Background = Color.FromArgb(17, 20, 24);
    public static readonly Color Surface = Color.FromArgb(24, 28, 33);
    public static readonly Color SurfaceAlt = Color.FromArgb(29, 34, 40);
    public static readonly Color Border = Color.FromArgb(47, 54, 63);
    public static readonly Color Text = Color.FromArgb(239, 243, 247);
    public static readonly Color Muted = Color.FromArgb(145, 156, 170);
    public static readonly Color Accent = Color.FromArgb(84, 166, 255);
    public static readonly Color Success = Color.FromArgb(75, 201, 136);
    public static readonly Color Warning = Color.FromArgb(245, 181, 73);
    public static readonly Color Danger = Color.FromArgb(240, 103, 103);

    public static Font Font(float size, FontStyle style = FontStyle.Regular)
        => new("Segoe UI", size, style, GraphicsUnit.Point);

    public static void StyleButton(Button button, bool primary = false)
    {
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = primary ? 0 : 1;
        button.FlatAppearance.BorderColor = Border;
        button.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(98, 176, 255) : SurfaceAlt;
        button.FlatAppearance.MouseDownBackColor = primary ? Color.FromArgb(66, 146, 231) : Color.FromArgb(35, 41, 48);
        button.BackColor = primary ? Accent : SurfaceAlt;
        button.ForeColor = primary ? Color.White : Text;
        button.Font = Font(9.5f, FontStyle.Bold);
        button.Cursor = Cursors.Hand;
        button.UseVisualStyleBackColor = false;
    }

    public static void StyleMenu(ContextMenuStrip menu)
    {
        menu.BackColor = SurfaceAlt;
        menu.ForeColor = Text;
        menu.Font = Font(9.5f);
        menu.ShowImageMargin = true;
        menu.Padding = new Padding(6);
        menu.Renderer = new DarkMenuRenderer();
    }

    public static void ApplyDarkTitleBar(Form form)
    {
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            var enabled = 1;
            var value = Marshal.AllocHGlobal(sizeof(int));
            try
            {
                Marshal.WriteInt32(value, enabled);
                _ = DwmSetWindowAttribute(form.Handle, 20, value, sizeof(int));
                _ = DwmSetWindowAttribute(form.Handle, 19, value, sizeof(int));
            }
            finally { Marshal.FreeHGlobal(value); }
        }
        catch { }
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, IntPtr value, int size);
}

internal sealed class RoundedPanel : Panel
{
    public int Radius { get; set; } = 18;
    public Color BorderColor { get; set; } = UiTheme.Border;

    public RoundedPanel()
    {
        DoubleBuffered = true;
        BackColor = UiTheme.Surface;
        Padding = new Padding(18);
        Resize += (_, _) => UpdateRegion();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = RoundedRect(ClientRectangle, Radius);
        using var fill = new SolidBrush(BackColor);
        using var pen = new Pen(BorderColor);
        e.Graphics.FillPath(fill, path);
        e.Graphics.DrawPath(pen, path);
        base.OnPaint(e);
    }

    protected override void OnPaintBackground(PaintEventArgs e) { }

    private void UpdateRegion()
    {
        if (Width <= 0 || Height <= 0) return;
        using var path = RoundedRect(ClientRectangle, Radius);
        Region = new Region(path);
    }

    private static GraphicsPath RoundedRect(Rectangle bounds, int radius)
    {
        var path = new GraphicsPath();
        if (bounds.Width <= 1 || bounds.Height <= 1) return path;
        var diameter = Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height));
        var arc = new Rectangle(bounds.X, bounds.Y, diameter, diameter);
        path.AddArc(arc, 180, 90);
        arc.X = bounds.Right - diameter - 1; path.AddArc(arc, 270, 90);
        arc.Y = bounds.Bottom - diameter - 1; path.AddArc(arc, 0, 90);
        arc.X = bounds.Left; path.AddArc(arc, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal sealed class DarkMenuRenderer : ToolStripProfessionalRenderer
{
    public DarkMenuRenderer() : base(new DarkMenuColors()) { RoundedEdges = true; }

    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        e.TextColor = e.Item.Enabled ? UiTheme.Text : UiTheme.Muted;
        base.OnRenderItemText(e);
    }
}

internal sealed class DarkMenuColors : ProfessionalColorTable
{
    public override Color ToolStripDropDownBackground => UiTheme.SurfaceAlt;
    public override Color MenuItemSelected => Color.FromArgb(42, 49, 58);
    public override Color MenuItemBorder => UiTheme.Border;
    public override Color ImageMarginGradientBegin => UiTheme.SurfaceAlt;
    public override Color ImageMarginGradientMiddle => UiTheme.SurfaceAlt;
    public override Color ImageMarginGradientEnd => UiTheme.SurfaceAlt;
    public override Color SeparatorDark => UiTheme.Border;
    public override Color SeparatorLight => UiTheme.Border;
}
