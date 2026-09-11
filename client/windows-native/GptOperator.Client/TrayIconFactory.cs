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
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);
            g.DrawImage(BrandAssets.Mark, new Rectangle(1, 1, 30, 30));

            var state = connected ? UiTheme.Success : enrolled ? UiTheme.Warning : UiTheme.Muted;
            using var border = new SolidBrush(Color.FromArgb(235, 8, 10, 12));
            using var fill = new SolidBrush(state);
            g.FillEllipse(border, 21, 21, 11, 11);
            g.FillEllipse(fill, 23, 23, 7, 7);
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
