using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
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

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(POINT point, uint flags);

    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(IntPtr monitor, int dpiType, out uint dpiX, out uint dpiY);

    private const uint MonitorDefaultToNearest = 2;
    private const int MonitorDpiEffective = 0;

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
                    "attach" => DesktopAttach(args),
                    "resume" => DesktopResume(args),
                    "detach" => DesktopDetach(args),
                    "windows" => Windows(Limit(args)),
                    "frame" => Frame(args),
                    "input" => Input(args),
                    "observe" => Observe(args),
                    "act" => Act(args),
                    "semantic-attach" => SemanticAttach(args),
                    "semantic-snapshot" => SemanticSnapshot(args),
                    "semantic-events" => SemanticEvents(args),
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

    private static (uint X,uint Y) ScreenDpi(Screen screen)
    {
        try
        {
            var bounds=screen.Bounds;
            var point=new POINT { X=bounds.Left+Math.Max(0,bounds.Width/2), Y=bounds.Top+Math.Max(0,bounds.Height/2) };
            var monitor=MonitorFromPoint(point,MonitorDefaultToNearest);
            if(monitor!=IntPtr.Zero&&GetDpiForMonitor(monitor,MonitorDpiEffective,out var x,out var y)==0&&x>0&&y>0)
                return (x,y);
        }
        catch { }
        return (96,96);
    }

    private static string DisplayTopologyId(Screen[] screens)
    {
        var text=new StringBuilder();
        for(var i=0;i<screens.Length;i++)
        {
            var screen=screens[i];
            var bounds=screen.Bounds; var work=screen.WorkingArea; var dpi=ScreenDpi(screen);
            text.Append(i).Append('|').Append(screen.DeviceName).Append('|').Append(screen.Primary?1:0).Append('|')
                .Append(bounds.Left).Append(',').Append(bounds.Top).Append(',').Append(bounds.Width).Append(',').Append(bounds.Height).Append('|')
                .Append(work.Left).Append(',').Append(work.Top).Append(',').Append(work.Width).Append(',').Append(work.Height).Append('|')
                .Append(dpi.X).Append(',').Append(dpi.Y).Append(';');
        }
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text.ToString()))).ToLowerInvariant();
    }

    private static object Status()
    {
        var foreground = WindowInfo(GetForegroundWindow());
        var cursor = GetCursorPos(out var point) ? new { x = point.X, y = point.Y } : null;
        var virtualScreen = SystemInformation.VirtualScreen;
        var allScreens = Screen.AllScreens;
        var displayTopologyId = DisplayTopologyId(allScreens);
        var screens = allScreens.Select((screen, index) =>
        {
            var dpi=ScreenDpi(screen);
            return new
            {
                index,
                name = screen.DeviceName,
                primary = screen.Primary,
                bounds = Box(screen.Bounds.Left, screen.Bounds.Top, screen.Bounds.Width, screen.Bounds.Height),
                workingArea = Box(screen.WorkingArea.Left, screen.WorkingArea.Top, screen.WorkingArea.Width, screen.WorkingArea.Height),
                dpi = new { x = dpi.X, y = dpi.Y, scaleX = dpi.X / 96d, scaleY = dpi.Y / 96d }
            };
        }).ToArray();

        return new
        {
            protocolVersion = ProtocolVersion,
            platform = "win32",
            dpiAwareness = "PerMonitorV2",
            displayTopologyId,
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
        var desktopSession = DesktopFrameSession(args);
        if (desktopSession is not null)
        {
            var retryAfterMs = DesktopFrameRetryAfter(desktopSession);
            if (retryAfterMs > 0) return DesktopFrameThrottled(desktopSession, retryAfterMs);
        }
        var screens = Screen.AllScreens;
        if (screens.Length == 0) throw new InvalidOperationException("desktop_screen_unavailable");
        var displayTopologyId = DisplayTopologyId(screens);

        var requestedScreen = desktopSession is null
            ? IntArg(args, "screen", -1, -1, Math.Max(0, screens.Length - 1))
            : desktopSession.Screen;
        Screen screen;
        int screenIndex;
        if (requestedScreen >= 0)
        {
            if (requestedScreen >= screens.Length) throw new InvalidOperationException("desktop_screen_out_of_range");
            screenIndex = requestedScreen;
            screen = screens[screenIndex];
        }
        else
        {
            screen = Screen.PrimaryScreen ?? screens[0];
            screenIndex = Array.FindIndex(screens, candidate => string.Equals(candidate.DeviceName, screen.DeviceName, StringComparison.OrdinalIgnoreCase));
            if (screenIndex < 0) screenIndex = 0;
        }

        var maxWidth = desktopSession?.MaxWidth ?? IntArg(args, "maxWidth", 960, 320, 1280);
        var maxHeight = desktopSession?.MaxHeight ?? IntArg(args, "maxHeight", 540, 180, 720);
        var quality = desktopSession?.Quality ?? IntArg(args, "quality", 50, 25, 70);
        var bounds = screen.Bounds;
        var screenDpi = ScreenDpi(screen);
        if (bounds.Width <= 0 || bounds.Height <= 0) throw new InvalidOperationException("desktop_screen_invalid");

        using var source = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(source))
            graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);

        var scale = Math.Min(1d, Math.Min((double)maxWidth / bounds.Width, (double)maxHeight / bounds.Height));
        var width = Math.Max(1, (int)Math.Round(bounds.Width * scale));
        var height = Math.Max(1, (int)Math.Round(bounds.Height * scale));
        var inputScaleX = width > 1 && bounds.Width > 1 ? (bounds.Width - 1d) / (width - 1d) : 0d;
        var inputScaleY = height > 1 && bounds.Height > 1 ? (bounds.Height - 1d) / (height - 1d) : 0d;
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
        var frameSha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        (long FrameSeq, long ContentSeq, bool Unchanged, long CapturedAt)? sessionFrame =
            desktopSession is null ? null : RecordDesktopFrame(desktopSession, frameSha256);
        var omitData = desktopSession is not null && desktopSession.OmitUnchanged && sessionFrame?.Unchanged == true;
        var capturedAt = sessionFrame?.CapturedAt ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        return new
        {
            protocolVersion = ProtocolVersion,
            desktopSessionId = desktopSession?.Id,
            desktopEpoch = desktopSession?.Epoch,
            frameSeq = sessionFrame?.FrameSeq,
            contentSeq = sessionFrame?.ContentSeq,
            unchanged = sessionFrame?.Unchanged ?? false,
            throttled = false,
            retryAfterMs = 0,
            frameSha256,
            displayTopologyId,
            capturedAt,
            mime = "image/jpeg",
            encoding = "base64",
            width,
            height,
            bytes = bytes.Length,
            screen = new
            {
                index = screenIndex,
                name = screen.DeviceName,
                primary = screen.Primary,
                bounds = Box(bounds.Left, bounds.Top, bounds.Width, bounds.Height),
                dpi = new { x = screenDpi.X, y = screenDpi.Y, scaleX = screenDpi.X / 96d, scaleY = screenDpi.Y / 96d }
            },
            inputMapping = new
            {
                coordinateSpace = "screen-local",
                screen = screenIndex,
                displayTopologyId,
                frameWidth = width,
                frameHeight = height,
                screenWidth = bounds.Width,
                screenHeight = bounds.Height,
                xScale = inputScaleX,
                yScale = inputScaleY,
                rounding = "nearest"
            },
            dataBytes = omitData ? 0 : bytes.Length,
            data = omitData ? null : Convert.ToBase64String(bytes)
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
