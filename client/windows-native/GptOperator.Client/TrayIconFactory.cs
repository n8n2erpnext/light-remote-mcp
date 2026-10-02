using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace GptOperator.Client;

internal enum TrayVisualState
{
    Stopped,
    Unlinked,
    Disconnected,
    Dormant,
    Connected
}

internal static class TrayIconFactory
{
    public static Icon Create(TrayVisualState visual)
    {
        using var bitmap = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);

            var gray = visual is TrayVisualState.Stopped or TrayVisualState.Unlinked;
            if (gray)
            {
                using var attrs = new ImageAttributes();
                attrs.SetColorMatrix(new ColorMatrix(new[]
                {
                    new[] { .30f, .30f, .30f, 0f, 0f },
                    new[] { .59f, .59f, .59f, 0f, 0f },
                    new[] { .11f, .11f, .11f, 0f, 0f },
                    new[] { 0f, 0f, 0f, .72f, 0f },
                    new[] { 0f, 0f, 0f, 0f, 1f }
                }));
                g.DrawImage(
                    BrandAssets.Mark,
                    new Rectangle(1, 1, 30, 30),
                    0, 0, BrandAssets.Mark.Width, BrandAssets.Mark.Height,
                    GraphicsUnit.Pixel,
                    attrs
                );
            }
            else
            {
                g.DrawImage(BrandAssets.Mark, new Rectangle(1, 1, 30, 30));
            }

            Color? state = visual switch
            {
                TrayVisualState.Connected => UiTheme.Success,
                TrayVisualState.Dormant => Color.FromArgb(255, 221, 166, 48),
                TrayVisualState.Disconnected => Color.FromArgb(255, 232, 72, 85),
                _ => null
            };

            if (state is not null)
            {
                using var border = new SolidBrush(Color.FromArgb(245, 8, 10, 12));
                using var fill = new SolidBrush(state.Value);
                g.FillEllipse(border, 19, 19, 13, 13);
                g.FillEllipse(fill, 21, 21, 9, 9);
            }
        }

        var handle = bitmap.GetHicon();
        try
        {
            using var temp = Icon.FromHandle(handle);
            return (Icon)temp.Clone();
        }
        finally { _ = DestroyIcon(handle); }
    }

    internal static bool SelfTest()
    {
        foreach (var state in Enum.GetValues<TrayVisualState>())
        {
            using var icon = Create(state);
            if (icon.Handle == IntPtr.Zero) return false;
        }
        return true;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);
}
