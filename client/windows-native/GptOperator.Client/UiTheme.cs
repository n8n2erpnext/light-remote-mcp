using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace GptOperator.Client;

internal static class UiTheme
{

    // Windows system preference, not a separate Light Remote account setting.
    // Missing/invalid registry state uses the Windows light default.
    public static bool IsDark
    {
        get
        {
            try
            {
                var pref = Registry.GetValue(
                    @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                    "AppsUseLightTheme", 1);
                return Convert.ToInt32(pref) == 0;
            }
            catch { return false; }
        }
    }

    // Light colors are matched to Figma's tray-v2/v3 light surfaces;
    // dark colors derive from the Figma tray-v3 core-state palette.
    public static Color Background => IsDark ? Color.FromArgb(13,17,23) : Color.FromArgb(247,249,252);
    public static Color Surface => IsDark ? Color.FromArgb(20,26,35) : Color.White;
    public static Color SurfaceAlt => IsDark ? Color.FromArgb(27,34,46) : Color.White;
    public static Color Border => IsDark ? Color.FromArgb(52,64,80) : Color.FromArgb(226,234,242);
    public static Color Text => IsDark ? Color.FromArgb(238,243,247) : Color.FromArgb(30,48,75);
    public static Color Muted => IsDark ? Color.FromArgb(155,168,185) : Color.FromArgb(100,117,139);
    public static Color Accent => IsDark ? Color.FromArgb(92,153,250) : Color.FromArgb(32,93,197);
    public static Color Success => IsDark ? Color.FromArgb(42,211,139) : Color.FromArgb(21,118,79);
    public static Color Warning => IsDark ? Color.FromArgb(248,167,55) : Color.FromArgb(164,106,32);
    public static Color Danger => IsDark ? Color.FromArgb(245,103,110) : Color.FromArgb(232,59,74);

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
        menu.Padding = new Padding(7);
        menu.MinimumSize = new Size(330, 0);
        menu.ImageScalingSize = new Size(20, 20);
        menu.Renderer = new DarkMenuRenderer();
    }

    public static void ApplyDarkTitleBar(Form form)
    {
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            var enabled = IsDark ? 1 : 0;
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
        e.TextColor = e.Item.Tag is TrayVisualState state ? state switch
        {
            TrayVisualState.Connected => UiTheme.Success,
            TrayVisualState.Disconnected => UiTheme.Danger,
            TrayVisualState.Dormant => UiTheme.Warning,
            _ => UiTheme.Muted
        } : (e.Item.Enabled ? UiTheme.Text : UiTheme.Muted);
        base.OnRenderItemText(e);
    }
}

internal sealed class DarkMenuColors : ProfessionalColorTable
{
    public override Color ToolStripDropDownBackground => UiTheme.SurfaceAlt;
    public override Color MenuItemSelected => UiTheme.IsDark ? Color.FromArgb(42, 49, 58) : Color.FromArgb(234, 241, 255);
    public override Color MenuItemBorder => UiTheme.Border;
    public override Color ImageMarginGradientBegin => UiTheme.SurfaceAlt;
    public override Color ImageMarginGradientMiddle => UiTheme.SurfaceAlt;
    public override Color ImageMarginGradientEnd => UiTheme.SurfaceAlt;
    public override Color SeparatorDark => UiTheme.Border;
    public override Color SeparatorLight => UiTheme.Border;
}
