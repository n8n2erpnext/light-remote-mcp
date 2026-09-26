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
        public required long AttachedAt { get; init; }
        public long FrameSeq;
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

    private static long NextDesktopFrameSeq(DesktopSession session) => Interlocked.Increment(ref session.FrameSeq);

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
            frame = new { maxWidth = session.MaxWidth, maxHeight = session.MaxHeight, quality = session.Quality },
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
