using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace GptOperator.Client;

internal static partial class RealRemoteHelper
{
    private const int ProtocolVersion = 1;
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public static int Run()
    {
        using var input = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8, false, 4096, leaveOpen: true);
        using var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false), 4096, leaveOpen: true) { AutoFlush = true };
        string? line;
        while ((line = input.ReadLine()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            string id = "";
            try
            {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                id = root.TryGetProperty("id", out var idNode) ? idNode.GetString() ?? "" : "";
                var op = root.TryGetProperty("op", out var opNode) ? opNode.GetString() ?? "" : "";
                var args = root.TryGetProperty("args", out var argsNode) ? argsNode : default;
                object result = op switch
                {
                    "status" => Status(),
                    "windows" => Windows(Limit(args)),
                    "frame" => Frame(args),
                    "input" => Input(args),
                    "semantic-attach" => SemanticAttach(args),
                    "semantic-snapshot" => SemanticSnapshot(args),
                    "semantic-detach" => SemanticDetach(args),
                    _ => throw new InvalidOperationException($"desktop_operation_unsupported:{op}")
                };
                output.WriteLine(JsonSerializer.Serialize(new { id, ok = true, result }));
            }
            catch (Exception ex)
            {
                output.WriteLine(JsonSerializer.Serialize(new { id, ok = false, error = ex.Message }));
            }
        }
        return 0;
    }

    private static int Limit(JsonElement args)
    {
        if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("limit", out var node) && node.TryGetInt32(out var value))
            return Math.Clamp(value, 1, 200);
        return 100;
    }

    private static object Status()
    {
        var foreground = WindowInfo(GetForegroundWindow());
        var cursor = GetCursorPos(out var point) ? new { x = point.X, y = point.Y } : null;
        var virtualScreen = SystemInformation.VirtualScreen;
        var screens = Screen.AllScreens.Select(screen => new
        {
            name = screen.DeviceName,
            primary = screen.Primary,
            bounds = Box(screen.Bounds.Left, screen.Bounds.Top, screen.Bounds.Width, screen.Bounds.Height),
            workingArea = Box(screen.WorkingArea.Left, screen.WorkingArea.Top, screen.WorkingArea.Width, screen.WorkingArea.Height)
        }).ToArray();

        return new
        {
            protocolVersion = ProtocolVersion,
            platform = "win32",
            interactive = Environment.UserInteractive,
            user = Environment.UserName,
            sessionId = Process.GetCurrentProcess().SessionId,
            processId = Environment.ProcessId,
            cursor,
            virtualScreen = Box(virtualScreen.Left, virtualScreen.Top, virtualScreen.Width, virtualScreen.Height),
            screens,
            foreground
        };
    }

    private static object Frame(JsonElement args)
    {
        if (!Environment.UserInteractive) throw new InvalidOperationException("desktop_session_not_interactive");
        var screens = Screen.AllScreens;
        if (screens.Length == 0) throw new InvalidOperationException("desktop_screen_unavailable");

        var requestedScreen = IntArg(args, "screen", -1, -1, Math.Max(0, screens.Length - 1));
        Screen screen;
        if (requestedScreen >= 0)
        {
            if (requestedScreen >= screens.Length) throw new InvalidOperationException("desktop_screen_out_of_range");
            screen = screens[requestedScreen];
        }
        else screen = Screen.PrimaryScreen ?? screens[0];

        var maxWidth = IntArg(args, "maxWidth", 960, 320, 1280);
        var maxHeight = IntArg(args, "maxHeight", 540, 180, 720);
        var quality = IntArg(args, "quality", 50, 25, 70);
        var bounds = screen.Bounds;
        if (bounds.Width <= 0 || bounds.Height <= 0) throw new InvalidOperationException("desktop_screen_invalid");

        using var source = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(source))
            graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);

        var scale = Math.Min(1d, Math.Min((double)maxWidth / bounds.Width, (double)maxHeight / bounds.Height));
        var width = Math.Max(1, (int)Math.Round(bounds.Width * scale));
        var height = Math.Max(1, (int)Math.Round(bounds.Height * scale));
        using var frame = width == source.Width && height == source.Height
            ? new Bitmap(source)
            : Resize(source, width, height);

        var jpeg = ImageCodecInfo.GetImageEncoders().First(codec => codec.FormatID == ImageFormat.Jpeg.Guid);
        byte[]? bytes = null;
        var qualities = new[] { quality, Math.Min(quality, 40), 30, 25 }.Distinct().ToArray();
        foreach (var candidate in qualities)
        {
            using var stream = new MemoryStream();
            using var parameters = new EncoderParameters(1);
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)candidate);
            frame.Save(stream, jpeg, parameters);
            bytes = stream.ToArray();
            if (bytes.Length <= 650 * 1024) break;
        }
        if (bytes is null || bytes.Length > 650 * 1024) throw new InvalidOperationException("desktop_frame_too_large");

        return new
        {
            protocolVersion = ProtocolVersion,
            capturedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            mime = "image/jpeg",
            encoding = "base64",
            width,
            height,
            bytes = bytes.Length,
            screen = new { name = screen.DeviceName, primary = screen.Primary, bounds = Box(bounds.Left, bounds.Top, bounds.Width, bounds.Height) },
            data = Convert.ToBase64String(bytes)
        };
    }

    private static Bitmap Resize(Bitmap source, int width, int height)
    {
        var result = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using var graphics = Graphics.FromImage(result);
        graphics.CompositingMode = CompositingMode.SourceCopy;
        graphics.CompositingQuality = CompositingQuality.HighSpeed;
        graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
        graphics.SmoothingMode = SmoothingMode.None;
        graphics.PixelOffsetMode = PixelOffsetMode.HighSpeed;
        graphics.DrawImage(source, new Rectangle(0, 0, width, height), 0, 0, source.Width, source.Height, GraphicsUnit.Pixel);
        return result;
    }

    private static int IntArg(JsonElement args, string name, int fallback, int min, int max)
    {
        if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var node) && node.TryGetInt32(out var value))
            return Math.Clamp(value, min, max);
        return fallback;
    }

    private static object Windows(int limit)
    {
        var foreground = GetForegroundWindow();
        var rows = new List<object>();
        EnumWindows((hWnd, _) =>
        {
            if (rows.Count >= limit || !IsWindowVisible(hWnd)) return rows.Count < limit;
            var title = WindowText(hWnd);
            if (string.IsNullOrWhiteSpace(title)) return true;
            var info = WindowInfo(hWnd, foreground);
            if (info is not null) rows.Add(info);
            return rows.Count < limit;
        }, IntPtr.Zero);
        return new { protocolVersion = ProtocolVersion, count = rows.Count, windows = rows };
    }

    private static object? WindowInfo(IntPtr hWnd, IntPtr? foreground = null)
    {
        if (hWnd == IntPtr.Zero || !GetWindowRect(hWnd, out var rect)) return null;
        _ = GetWindowThreadProcessId(hWnd, out var pid);
        var className = new StringBuilder(256);
        _ = GetClassName(hWnd, className, className.Capacity);
        return new
        {
            handle = $"0x{hWnd.ToInt64():X}",
            pid,
            title = WindowText(hWnd),
            className = className.ToString(),
            foreground = hWnd == (foreground ?? GetForegroundWindow()),
            bounds = Box(rect.Left, rect.Top, Math.Max(0, rect.Right - rect.Left), Math.Max(0, rect.Bottom - rect.Top))
        };
    }

    private static string WindowText(IntPtr hWnd)
    {
        var length = Math.Clamp(GetWindowTextLength(hWnd) + 1, 2, 32768);
        var text = new StringBuilder(length);
        _ = GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }

    private static object Box(int x, int y, int width, int height) => new { x, y, width, height };
}
