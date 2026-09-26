using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;

namespace GptOperator.Client;

internal static partial class RealRemoteHelper
{
    private sealed class SemanticSession
    {
        public required string Id { get; init; }
        public required string Epoch { get; init; }
        public required string Scope { get; init; }
        public required int MaxDepth { get; init; }
        public required int MaxNodes { get; init; }
        public required long AttachedAt { get; init; }
        public required AutomationElement Root { get; set; }
        public required IntPtr RootHwnd { get; set; }
        public object Gate { get; } = new();
        public List<SemanticEventRecord> Journal { get; } = new();
        public Dictionary<string, AutomationElement> NodeIndex { get; } = new(StringComparer.Ordinal);
        public long StateSeq;
        public long InputSeq;
        public long DroppedBeforeSeq;
        public bool ScopeChanged;
        public bool FocusSubscribed;
        public bool StructureSubscribed;
        public bool PropertySubscribed;
        public AutomationFocusChangedEventHandler? FocusHandler;
        public StructureChangedEventHandler? StructureHandler;
        public AutomationPropertyChangedEventHandler? PropertyHandler;
    }

    private static readonly object SemanticLock = new();
    private static readonly Dictionary<string, SemanticSession> SemanticSessions = new(StringComparer.Ordinal);

    private static object SemanticAttach(JsonElement args)
    {
        var provider = SemanticProvider(args);
        if (provider == "browser-cdp") return BrowserSemanticAttach(args);
        EnsureSemanticInteractive();
        var scope = SemanticScope(args);
        var root = SemanticRoot(scope, out var rootHwnd);
        var session = new SemanticSession
        {
            Id = "sem_" + Guid.NewGuid().ToString("N"),
            Epoch = "ep_" + Guid.NewGuid().ToString("N"),
            Scope = scope,
            MaxDepth = SemanticInt(args, "maxDepth", 6, 0, 12),
            MaxNodes = SemanticInt(args, "maxNodes", 400, 1, 1500),
            AttachedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Root = root,
            RootHwnd = rootHwnd
        };
        lock (SemanticLock) SemanticSessions[session.Id] = session;
        SubscribeSemantic(session);
        return SemanticSnapshotCore(session, true);
    }

    private static object SemanticSnapshot(JsonElement args)
    {
        EnsureSemanticInteractive();
        var id = SemanticSessionId(args);
        if (BrowserSemanticHas(id)) return BrowserSemanticSnapshot(args);
        SemanticSession session;
        lock (SemanticLock)
        {
            if (!SemanticSessions.TryGetValue(id, out session!))
                throw new InvalidOperationException("semantic_session_not_found");
        }
        return SemanticSnapshotCore(session, false);
    }

    private static object SemanticDetach(JsonElement args)
    {
        var id = SemanticSessionId(args);
        if (BrowserSemanticHas(id)) return BrowserSemanticDetach(args);
        SemanticSession session;
        lock (SemanticLock)
        {
            if (!SemanticSessions.Remove(id, out session!))
                throw new InvalidOperationException("semantic_session_not_found");
        }
        UnsubscribeSemantic(session);
        return new
        {
            protocolVersion = ProtocolVersion,
            provider = "windows-uia",
            semanticSessionId = session.Id,
            epoch = session.Epoch,
            stateSeq = session.StateSeq,
            detached = true
        };
    }

    private static object SemanticSnapshotCore(SemanticSession session, bool attached)
    {
        _ = RefreshSemanticForegroundRoot(session);
        var rows = new List<Dictionary<string, object?>>(Math.Min(session.MaxNodes, 512));
        var truncated = false;
        long stateSeq;
        bool scopeChanged;
        lock (session.Gate)
        {
            session.NodeIndex.Clear();
            WalkSemantic(session.Root, null, 0, "0", session, rows, ref truncated);
            stateSeq = ++session.StateSeq;
            scopeChanged = session.ScopeChanged;
            session.ScopeChanged = false;
        }
        var cursor = GetCursorPos(out var point) ? new { x = point.X, y = point.Y } : null;
        return new
        {
            protocolVersion = ProtocolVersion,
            provider = "windows-uia",
            semanticSessionId = session.Id,
            epoch = session.Epoch,
            stateSeq,
            attached,
            attachedAt = session.AttachedAt,
            capturedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            scope = session.Scope,
            maxDepth = session.MaxDepth,
            maxNodes = session.MaxNodes,
            nodeCount = rows.Count,
            truncated,
            cursor,
            foreground = WindowInfo(GetForegroundWindow()),
            eventsAvailable = session.FocusSubscribed || session.StructureSubscribed || session.PropertySubscribed,
            subscriptions = new { focus = session.FocusSubscribed, structure = session.StructureSubscribed, property = session.PropertySubscribed },
            droppedBeforeSeq = session.DroppedBeforeSeq,
            scopeChanged,
            nodes = rows
        };
    }

    private static AutomationElement SemanticRoot(string scope, out IntPtr hwnd)
    {
        if (scope == "desktop")
        {
            hwnd = IntPtr.Zero;
            return AutomationElement.RootElement;
        }
        hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("semantic_foreground_unavailable");
        return AutomationElement.FromHandle(hwnd);
    }

    private static bool RefreshSemanticForegroundRoot(SemanticSession session)
    {
        if (session.Scope != "foreground") return false;
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("semantic_foreground_unavailable");

        IntPtr oldHwnd;
        lock (session.Gate) oldHwnd = session.RootHwnd;
        if (oldHwnd == hwnd) return false;

        var root = AutomationElement.FromHandle(hwnd);
        UnsubscribeSemantic(session);
        lock (session.Gate)
        {
            session.Root = root;
            session.RootHwnd = hwnd;
            session.NodeIndex.Clear();
            session.ScopeChanged = true;
        }
        SubscribeSemantic(session);
        EnqueueSemantic(session, "scope", root, null, $"foreground_handoff:0x{oldHwnd.ToInt64():X}->0x{hwnd.ToInt64():X}", true);
        return true;
    }

    private static void WalkSemantic(AutomationElement element, string? parentId, int depth, string path, SemanticSession session, List<Dictionary<string, object?>> rows, ref bool truncated)
    {
        if (rows.Count >= session.MaxNodes) { truncated = true; return; }
        Dictionary<string, object?> node;
        try { node = SemanticNode(element, parentId, depth, path, session.Epoch); }
        catch (ElementNotAvailableException) { return; }
        catch (InvalidOperationException) { return; }
        rows.Add(node);
        session.NodeIndex[(string)node["id"]!] = element;
        if (depth >= session.MaxDepth) return;

        AutomationElement? child;
        try { child = TreeWalker.ControlViewWalker.GetFirstChild(element); }
        catch (ElementNotAvailableException) { return; }
        var index = 0;
        while (child is not null)
        {
            WalkSemantic(child, (string)node["id"]!, depth + 1, path + "." + index, session, rows, ref truncated);
            if (rows.Count >= session.MaxNodes) { truncated = true; return; }
            try { child = TreeWalker.ControlViewWalker.GetNextSibling(child); }
            catch (ElementNotAvailableException) { return; }
            index++;
        }
    }

    private static Dictionary<string, object?> SemanticNode(AutomationElement element, string? parentId, int depth, string path, string epoch)
    {
        var current = element.Current;
        var bounds = current.BoundingRectangle;
        var runtime = SafeRuntimeId(element);
        var id = SemanticId(epoch, current.ProcessId, current.NativeWindowHandle, runtime, path);
        var role = (current.ControlType?.ProgrammaticName ?? "ControlType.Custom").Replace("ControlType.", "", StringComparison.Ordinal);
        var patterns = new List<string>(6);
        AddPattern(element, InvokePattern.Pattern, "invoke", patterns);
        AddPattern(element, ValuePattern.Pattern, "value", patterns);
        AddPattern(element, TextPattern.Pattern, "text", patterns);
        AddPattern(element, TogglePattern.Pattern, "toggle", patterns);
        AddPattern(element, SelectionItemPattern.Pattern, "selectionItem", patterns);
        AddPattern(element, ExpandCollapsePattern.Pattern, "expandCollapse", patterns);
        object? center = null;
        if (!bounds.IsEmpty && bounds.Width > 0 && bounds.Height > 0)
            center = new { x = (int)Math.Round(bounds.X + bounds.Width / 2d), y = (int)Math.Round(bounds.Y + bounds.Height / 2d) };
        var actions = new List<string>(8);
        if (patterns.Contains("invoke")) actions.Add("invoke");
        if (patterns.Contains("toggle")) actions.Add("toggle");
        if (patterns.Contains("value")) actions.Add("set-value");
        if (patterns.Contains("selectionItem")) actions.Add("select");
        if (patterns.Contains("expandCollapse")) { actions.Add("expand"); actions.Add("collapse"); }
        if (current.IsKeyboardFocusable) actions.Add("focus");
        if (current.IsEnabled && !current.IsOffscreen && center is not null) actions.Add("click");

        return new Dictionary<string, object?>
        {
            ["id"] = id,
            ["parentId"] = parentId,
            ["depth"] = depth,
            ["role"] = role,
            ["name"] = LimitSemanticText(current.Name, 512),
            ["label"] = LimitSemanticText(current.Name, 512),
            ["automationId"] = LimitSemanticText(current.AutomationId, 256),
            ["className"] = LimitSemanticText(current.ClassName, 256),
            ["frameworkId"] = LimitSemanticText(current.FrameworkId, 64),
            ["processId"] = current.ProcessId,
            ["hwnd"] = current.NativeWindowHandle == 0 ? null : $"0x{current.NativeWindowHandle:X}",
            ["enabled"] = current.IsEnabled,
            ["offscreen"] = current.IsOffscreen,
            ["focused"] = current.HasKeyboardFocus,
            ["keyboardFocusable"] = current.IsKeyboardFocusable,
            ["password"] = current.IsPassword,
            ["bounds"] = bounds.IsEmpty ? null : new { x = (int)Math.Round(bounds.X), y = (int)Math.Round(bounds.Y), width = (int)Math.Round(bounds.Width), height = (int)Math.Round(bounds.Height) },
            ["center"] = center,
            ["patterns"] = patterns,
            ["actions"] = actions,
            ["runtimeId"] = runtime
        };
    }

    private static void AddPattern(AutomationElement element, AutomationPattern pattern, string name, List<string> target)
    {
        try { if (element.TryGetCurrentPattern(pattern, out _)) target.Add(name); }
        catch (ElementNotAvailableException) { }
        catch (InvalidOperationException) { }
    }

    private static string? SafeRuntimeId(AutomationElement element)
    {
        try
        {
            var value = element.GetRuntimeId();
            return value is { Length: > 0 } ? string.Join(".", value) : null;
        }
        catch (ElementNotAvailableException) { return null; }
        catch (InvalidOperationException) { return null; }
    }

    private static string SemanticId(string epoch, int processId, int hwnd, string? runtimeId, string path)
    {
        var material = $"{epoch}|{processId}|{hwnd}|{runtimeId ?? path}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        return "uia_" + Convert.ToHexString(hash.AsSpan(0, 10)).ToLowerInvariant();
    }

    private static string LimitSemanticText(string? value, int max)
    {
        var text = value ?? "";
        return text.Length <= max ? text : text[..max];
    }

    private static void EnsureSemanticInteractive()
    {
        if (!Environment.UserInteractive) throw new InvalidOperationException("desktop_session_not_interactive");
    }

    private static string SemanticProvider(JsonElement args)
    {
        var provider = args.ValueKind == JsonValueKind.Object && args.TryGetProperty("provider", out var node)
            ? (node.GetString() ?? "windows-uia").Trim().ToLowerInvariant()
            : "windows-uia";
        return provider switch
        {
            "windows-uia" => provider,
            "browser-cdp" => provider,
            _ => throw new InvalidOperationException("semantic_invalid_provider")
        };
    }

    private static string SemanticScope(JsonElement args)
    {
        var scope = args.ValueKind == JsonValueKind.Object && args.TryGetProperty("scope", out var node)
            ? (node.GetString() ?? "foreground").Trim().ToLowerInvariant()
            : "foreground";
        return scope switch
        {
            "foreground" => scope,
            "desktop" => scope,
            _ => throw new InvalidOperationException("semantic_invalid_scope")
        };
    }

    private static string SemanticSessionId(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty("semanticSessionId", out var node) || node.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException("semantic_session_id_required");
        var id = node.GetString() ?? "";
        if (!id.StartsWith("sem_", StringComparison.Ordinal) || id.Length > 80)
            throw new InvalidOperationException("semantic_session_id_invalid");
        return id;
    }

    private static int SemanticInt(JsonElement args, string name, int fallback, int min, int max)
    {
        if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var node) && node.TryGetInt32(out var value))
            return Math.Clamp(value, min, max);
        return fallback;
    }
}
