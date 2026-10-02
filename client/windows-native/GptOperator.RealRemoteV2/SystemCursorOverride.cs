using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Linq;
using System.Runtime.InteropServices;

namespace GptOperator.RealRemoteV2;

internal static class SystemCursorOverride
{
    private const uint SPI_SETCURSORS = 0x0057;
    private const int SM_CXCURSOR = 13;
    private const int SM_CYCURSOR = 14;

    private const uint OCR_NORMAL = 32512;
    private const uint OCR_IBEAM = 32513;
    private const uint OCR_WAIT = 32514;
    private const uint OCR_CROSS = 32515;
    private const uint OCR_UP = 32516;
    private const uint OCR_SIZENWSE = 32642;
    private const uint OCR_SIZENESW = 32643;
    private const uint OCR_SIZEWE = 32644;
    private const uint OCR_SIZENS = 32645;
    private const uint OCR_SIZEALL = 32646;
    private const uint OCR_NO = 32648;
    private const uint OCR_HAND = 32649;
    private const uint OCR_APPSTARTING = 32650;
    private const uint OCR_HELP = 32651;

    private static readonly uint[] CursorIds =
    {
        OCR_NORMAL,
        OCR_IBEAM,
        OCR_WAIT,
        OCR_CROSS,
        OCR_UP,
        OCR_SIZENWSE,
        OCR_SIZENESW,
        OCR_SIZEWE,
        OCR_SIZENS,
        OCR_SIZEALL,
        OCR_NO,
        OCR_HAND,
        OCR_APPSTARTING,
        OCR_HELP
    };

    private static readonly object Sync = new();
    private static int _leases;
    private static bool _installed;

    public static bool IsActive
    {
        get
        {
            lock (Sync) return _installed;
        }
    }

    public static void Acquire()
    {
        lock (Sync)
        {
            _leases++;
            if (_installed) return;

            try
            {
                RestoreCore();

                foreach (var cursorId in CursorIds)
                {
                    var cursor = CreateCodexCursor();
                    if (cursor == IntPtr.Zero)
                        throw new InvalidOperationException("codex_cursor_create_failed");

                    if (!SetSystemCursor(cursor, cursorId))
                    {
                        _ = DestroyCursor(cursor);
                        throw new InvalidOperationException(
                            $"codex_cursor_install_failed:{cursorId}:{Marshal.GetLastWin32Error()}"
                        );
                    }
                }

                _installed = true;
            }
            catch
            {
                _leases = 0;
                _installed = false;
                RestoreCore();
                throw;
            }
        }
    }

    public static void Release()
    {
        lock (Sync)
        {
            if (_leases > 0) _leases--;
            if (_leases > 0) return;
            if (!_installed) return;

            RestoreCore();
            _installed = false;
        }
    }

    public static void ForceRestore()
    {
        lock (Sync)
        {
            _leases = 0;
            RestoreCore();
            _installed = false;
        }
    }

    internal static bool SelfTest()
    {
        if (CursorIds.Length < 10) return false;
        if (CursorIds.Distinct().Count() != CursorIds.Length) return false;

        using var bitmap = RenderCodexCursorBitmap(48, 48);
        var visible = 0;
        var minX = 48;
        var minY = 48;
        var maxX = -1;
        var maxY = -1;

        for (var y = 0; y < bitmap.Height; y++)
        {
            for (var x = 0; x < bitmap.Width; x++)
            {
                if (bitmap.GetPixel(x, y).A == 0) continue;
                visible++;
                minX = Math.Min(minX, x);
                minY = Math.Min(minY, y);
                maxX = Math.Max(maxX, x);
                maxY = Math.Max(maxY, y);
            }
        }

        return visible > 120
            && minX >= 1
            && minY >= 1
            && maxX <= 46
            && maxY <= 46;
    }

    private static void RestoreCore()
    {
        _ = SystemParametersInfo(SPI_SETCURSORS, 0, IntPtr.Zero, 0);
    }

    private static IntPtr CreateCodexCursor()
    {
        var width = Math.Clamp(GetSystemMetrics(SM_CXCURSOR), 32, 64);
        var height = Math.Clamp(GetSystemMetrics(SM_CYCURSOR), 32, 64);

        using var bitmap = RenderCodexCursorBitmap(width, height);
        using var mask = new Bitmap(width, height, PixelFormat.Format1bppIndexed);

        var hbmColor = bitmap.GetHbitmap(Color.FromArgb(0));
        var hbmMask = mask.GetHbitmap();

        try
        {
            var scaleX = width / 48f;
            var scaleY = height / 48f;
            var iconInfo = new IconInfo
            {
                fIcon = false,
                xHotspot = (uint)Math.Round(12f * scaleX),
                yHotspot = (uint)Math.Round(14f * scaleY),
                hbmMask = hbmMask,
                hbmColor = hbmColor
            };

            return CreateIconIndirect(ref iconInfo);
        }
        finally
        {
            _ = DeleteObject(hbmColor);
            _ = DeleteObject(hbmMask);
        }
    }

    private static Bitmap RenderCodexCursorBitmap(int width, int height)
    {
        var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);

        using var g = Graphics.FromImage(bitmap);
        g.Clear(Color.Transparent);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.CompositingQuality = CompositingQuality.HighQuality;

        g.ScaleTransform(width / 48f, height / 48f);

        const float tipX = 12f;
        const float tipY = 14f;

        using (var outer = new SolidBrush(Color.FromArgb(32, 76, 255, 144)))
        using (var middle = new SolidBrush(Color.FromArgb(52, 85, 255, 151)))
        using (var core = new SolidBrush(Color.FromArgb(72, 111, 255, 169)))
        {
            g.FillEllipse(outer, tipX - 10f, tipY - 10f, 20f, 20f);
            g.FillEllipse(middle, tipX - 7f, tipY - 7f, 14f, 14f);
            g.FillEllipse(core, tipX - 4.5f, tipY - 4.5f, 9f, 9f);
        }

        using var path = new GraphicsPath();
        path.AddPolygon(new[]
        {
            new PointF(tipX, tipY),
            new PointF(tipX + 2.4f, tipY + 20.25f),
            new PointF(tipX + 7.35f, tipY + 15.9f),
            new PointF(tipX + 12.1f, tipY + 25.05f),
            new PointF(tipX + 15.9f, tipY + 23.25f),
            new PointF(tipX + 10.9f, tipY + 14.1f),
            new PointF(tipX + 18.15f, tipY + 13.65f)
        });
        path.CloseFigure();

        using var shadowPath = (GraphicsPath)path.Clone();
        using var shift = new Matrix();
        shift.Translate(1.5f, 1.8f);
        shadowPath.Transform(shift);

        using var shadow = new SolidBrush(Color.FromArgb(108, 0, 0, 0));
        using var accent = new Pen(Color.FromArgb(168, 104, 255, 162), 2.1f)
        {
            LineJoin = LineJoin.Round
        };
        using var edge = new Pen(Color.FromArgb(245, 244, 247, 246), 0.9f)
        {
            LineJoin = LineJoin.Round
        };
        using var fill = new SolidBrush(Color.FromArgb(248, 14, 16, 18));

        g.FillPath(shadow, shadowPath);
        g.DrawPath(accent, path);
        g.FillPath(fill, path);
        g.DrawPath(edge, path);

        return bitmap;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IconInfo
    {
        [MarshalAs(UnmanagedType.Bool)]
        public bool fIcon;
        public uint xHotspot;
        public uint yHotspot;
        public IntPtr hbmMask;
        public IntPtr hbmColor;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreateIconIndirect(ref IconInfo iconInfo);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetSystemCursor(IntPtr hcur, uint id);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyCursor(IntPtr hCursor);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SystemParametersInfo(
        uint uiAction,
        uint uiParam,
        IntPtr pvParam,
        uint fWinIni
    );

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr handle);
}
