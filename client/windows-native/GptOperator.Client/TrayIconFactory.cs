using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace GptOperator.Client;

internal static class TrayIconFactory
{
    public static Icon Create(bool connected, bool enrolled)
    {
        using var bitmap = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            var baseColor = connected ? UiTheme.Accent : enrolled ? UiTheme.Warning : UiTheme.Muted;
            using var fill = new SolidBrush(baseColor);
            using var path = new GraphicsPath();
            path.AddPolygon(new[] {
                new Point(6, 6), new Point(18, 6), new Point(12, 15),
                new Point(25, 15), new Point(14, 26), new Point(14, 18),
                new Point(6, 18)
            });
            g.FillPath(fill, path);
            using var dot = new SolidBrush(Color.White);
            g.FillEllipse(dot, 22, 5, 5, 5);
        }
        var handle = bitmap.GetHicon();
        try
        {
            using var temp = Icon.FromHandle(handle);
            return (Icon)temp.Clone();
        }
        finally { _ = DestroyIcon(handle); }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);
}
