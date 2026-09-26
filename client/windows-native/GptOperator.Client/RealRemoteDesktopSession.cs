using System.Text.Json;
using System.Windows.Forms;

namespace GptOperator.Client;

internal static partial class RealRemoteHelper
{
    private sealed class DesktopSession
    {
        public required string Id { get; init; }
        public required string Epoch { get; init; }
        public required string DisplayTopologyId { get; init; }
        public required int Screen { get; init; }
        public required int MaxWidth { get; init; }
        public required int MaxHeight { get; init; }
        public required int Quality { get; init; }
        public required int MinIntervalMs { get; init; }
        public required bool OmitUnchanged { get; init; }
        public required long AttachedAt { get; init; }
        public object Gate { get; } = new();
        public long FrameSeq;
        public long ContentSeq;
        public long LastCapturedAt;
        public string LastFrameSha256 = "";
    }

    private const int DesktopSessionLimit = 8;
    private static readonly object DesktopSessionLock = new();
    private static readonly Dictionary<string, DesktopSession> DesktopSessions = new(StringComparer.Ordinal);

    private static object DesktopAttach(JsonElement args)
    {
        if (!Environment.UserInteractive) throw new InvalidOperationException("desktop_session_not_interactive");
        var screens = Screen.AllScreens;
        if (screens.Length == 0) throw new InvalidOperationException("desktop_screen_unavailable");

        var screenIndex = DesktopRequestedScreen(args, screens);
        var session = new DesktopSession
        {
            Id = "desk_" + Guid.NewGuid().ToString("N"),
            Epoch = "dep_" + Guid.NewGuid().ToString("N"),
            DisplayTopologyId = DisplayTopologyId(screens),
            Screen = screenIndex,
            MaxWidth = IntArg(args, "maxWidth", 960, 320, 1280),
            MaxHeight = IntArg(args, "maxHeight", 540, 180, 720),
            Quality = IntArg(args, "quality", 50, 25, 70),
            MinIntervalMs = IntArg(args, "minIntervalMs", 250, 0, 5000),
            OmitUnchanged = DesktopBoolArg(args, "omitUnchanged", true),
            AttachedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        lock (DesktopSessionLock)
        {
            if (DesktopSessions.Count >= DesktopSessionLimit) throw new InvalidOperationException("desktop_session_limit");
            DesktopSessions[session.Id] = session;
        }
        return DesktopSessionView(session, "attached");
    }

    private static object DesktopResume(JsonElement args)
    {
        var session = DesktopSessionRequired(args);
        ValidateDesktopSessionTopology(session);
        return DesktopSessionView(session, "resumed");
    }

    private static object DesktopDetach(JsonElement args)
    {
        var id = DesktopSessionId(args);
        DesktopSession session;
        lock (DesktopSessionLock)
        {
            if (!DesktopSessions.Remove(id, out session!))
                throw new InvalidOperationException("desktop_session_not_found");
        }
        return new
        {
            protocolVersion = ProtocolVersion,
            desktopSessionId = session.Id,
            epoch = session.Epoch,
            displayTopologyId = session.DisplayTopologyId,
            screen = session.Screen,
            frameSeq = Interlocked.Read(ref session.FrameSeq),
            contentSeq = Interlocked.Read(ref session.ContentSeq),
            lastCapturedAt = Interlocked.Read(ref session.LastCapturedAt),
            lastFrameSha256 = session.LastFrameSha256,
            attachedAt = session.AttachedAt,
            detached = true
        };
    }

    private static DesktopSession? DesktopFrameSession(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty("desktopSessionId", out _)) return null;
        var session = DesktopSessionRequired(args);
        ValidateDesktopSessionTopology(session);
        return session;
    }

    private static object DesktopSessionView(DesktopSession session, string state)
    {
        var screens = Screen.AllScreens;
        if (session.Screen < 0 || session.Screen >= screens.Length) throw new InvalidOperationException("desktop_session_stale_topology");
        var screen = screens[session.Screen];
        var dpi = ScreenDpi(screen);
        return new
        {
            protocolVersion = ProtocolVersion,
            desktopSessionId = session.Id,
            epoch = session.Epoch,
            state,
            attachedAt = session.AttachedAt,
            displayTopologyId = session.DisplayTopologyId,
            frameSeq = Interlocked.Read(ref session.FrameSeq),
            contentSeq = Interlocked.Read(ref session.ContentSeq),
            lastCapturedAt = Interlocked.Read(ref session.LastCapturedAt),
            lastFrameSha256 = session.LastFrameSha256,
            frame = new { maxWidth = session.MaxWidth, maxHeight = session.MaxHeight, quality = session.Quality, minIntervalMs = session.MinIntervalMs, omitUnchanged = session.OmitUnchanged },
            screen = new
            {
                index = session.Screen,
                name = screen.DeviceName,
                primary = screen.Primary,
                bounds = Box(screen.Bounds.Left, screen.Bounds.Top, screen.Bounds.Width, screen.Bounds.Height),
                dpi = new { x = dpi.X, y = dpi.Y, scaleX = dpi.X / 96d, scaleY = dpi.Y / 96d }
            }
        };
    }

    private static void ValidateDesktopSessionTopology(DesktopSession session)
    {
        var screens = Screen.AllScreens;
        if (!string.Equals(session.DisplayTopologyId, DisplayTopologyId(screens), StringComparison.Ordinal))
            throw new InvalidOperationException("desktop_session_stale_topology");
        if (session.Screen < 0 || session.Screen >= screens.Length)
            throw new InvalidOperationException("desktop_session_stale_topology");
    }

    private static DesktopSession DesktopSessionRequired(JsonElement args)
    {
        var id = DesktopSessionId(args);
        lock (DesktopSessionLock)
        {
            if (!DesktopSessions.TryGetValue(id, out var session))
                throw new InvalidOperationException("desktop_session_not_found");
            return session;
        }
    }

    private static string DesktopSessionId(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty("desktopSessionId", out var node) || node.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException("desktop_session_id_required");
        var id = (node.GetString() ?? "").Trim();
        if (!id.StartsWith("desk_", StringComparison.Ordinal) || id.Length < 20 || id.Length > 80)
            throw new InvalidOperationException("desktop_session_id_invalid");
        return id;
    }

    private static int DesktopFrameRetryAfter(DesktopSession session)
    {
        if (session.MinIntervalMs <= 0) return 0;
        var last = Interlocked.Read(ref session.LastCapturedAt);
        if (last <= 0) return 0;
        var elapsed = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - last;
        return elapsed >= session.MinIntervalMs ? 0 : Math.Max(1, session.MinIntervalMs - (int)Math.Max(0, elapsed));
    }

    private static (long FrameSeq, long ContentSeq, bool Unchanged, long CapturedAt) RecordDesktopFrame(DesktopSession session, string sha256)
    {
        lock (session.Gate)
        {
            var unchanged = !string.IsNullOrEmpty(session.LastFrameSha256) && string.Equals(session.LastFrameSha256, sha256, StringComparison.Ordinal);
            session.FrameSeq++;
            if (!unchanged) session.ContentSeq++;
            session.LastFrameSha256 = sha256;
            session.LastCapturedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return (session.FrameSeq, session.ContentSeq, unchanged, session.LastCapturedAt);
        }
    }

    private static object DesktopFrameThrottled(DesktopSession session, int retryAfterMs)
    {
        return new
        {
            protocolVersion = ProtocolVersion,
            desktopSessionId = session.Id,
            desktopEpoch = session.Epoch,
            displayTopologyId = session.DisplayTopologyId,
            frameSeq = Interlocked.Read(ref session.FrameSeq),
            contentSeq = Interlocked.Read(ref session.ContentSeq),
            lastCapturedAt = Interlocked.Read(ref session.LastCapturedAt),
            lastFrameSha256 = session.LastFrameSha256,
            throttled = true,
            retryAfterMs,
            unchanged = false,
            data = (string?)null
        };
    }

    private static bool DesktopBoolArg(JsonElement args, string name, bool fallback)
    {
        if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var node))
        {
            if (node.ValueKind == JsonValueKind.True) return true;
            if (node.ValueKind == JsonValueKind.False) return false;
        }
        return fallback;
    }

    private static int DesktopRequestedScreen(JsonElement args, Screen[] screens)
    {
        var requested = IntArg(args, "screen", -1, -1, Math.Max(0, screens.Length - 1));
        if (requested >= 0)
        {
            if (requested >= screens.Length) throw new InvalidOperationException("desktop_screen_out_of_range");
            return requested;
        }
        var primary = Screen.PrimaryScreen ?? screens[0];
        var index = Array.FindIndex(screens, candidate => string.Equals(candidate.DeviceName, primary.DeviceName, StringComparison.OrdinalIgnoreCase));
        return index < 0 ? 0 : index;
    }
}
