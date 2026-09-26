using System.Collections.Concurrent;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace GptOperator.Client;

internal static partial class RealRemoteHelper
{
    private const int BrowserSemanticJournalLimit = 512;

    private sealed class BrowserSemanticSession : IDisposable
    {
        public required string Id { get; init; }
        public required string Epoch { get; init; }
        public required Uri Endpoint { get; init; }
        public required string TargetId { get; set; }
        public required string TargetTitle { get; set; }
        public required string TargetUrl { get; set; }
        public required int MaxDepth { get; init; }
        public required int MaxNodes { get; init; }
        public required long AttachedAt { get; init; }
        public required ClientWebSocket Socket { get; set; }
        public object Gate { get; } = new();
        public SemaphoreSlim SendGate { get; } = new(1, 1);
        public SemaphoreSlim OperationGate { get; } = new(1, 1);
        public ConcurrentDictionary<long, TaskCompletionSource<JsonElement>> Pending { get; } = new();
        public CancellationTokenSource Cancellation { get; } = new();
        public List<BrowserSemanticEventRecord> Journal { get; } = new();
        public HashSet<string> KnownTargetIds { get; } = new(StringComparer.Ordinal);
        public List<string> TargetHistory { get; } = new();
        public Task? Receiver { get; set; }
        public long ConnectionGeneration;
        public long NextCommandId;
        public long StateSeq;
        public long InputSeq;
        public long DroppedBeforeSeq;
        public bool ScopeChanged;
        public bool EventsAvailable;

        public void Dispose()
        {
            try { Cancellation.Cancel(); } catch { }
            foreach (var pending in Pending.Values)
                pending.TrySetException(new InvalidOperationException("browser_cdp_closed"));
            Pending.Clear();
            try
            {
                if (Socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                    Socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "detach", CancellationToken.None).GetAwaiter().GetResult();
            }
            catch { }
            try { Socket.Dispose(); } catch { }
            try { Cancellation.Dispose(); } catch { }
            try { SendGate.Dispose(); } catch { }
            try { OperationGate.Dispose(); } catch { }
        }
    }

    private sealed class BrowserSemanticEventRecord
    {
        public required long Seq { get; init; }
        public required long Timestamp { get; init; }
        public required string Kind { get; init; }
        public string? Property { get; init; }
        public string? Change { get; init; }
        public bool ResyncRecommended { get; init; }
    }

    private sealed record BrowserTarget(string Id, string Type, string Title, string Url, Uri WebSocketUrl);

    private static readonly Dictionary<string, BrowserSemanticSession> BrowserSemanticSessions = new(StringComparer.Ordinal);

    private static bool BrowserSemanticHas(string id)
    {
        lock (SemanticLock) return BrowserSemanticSessions.ContainsKey(id);
    }

    private static object BrowserSemanticAttach(JsonElement args)
    {
        EnsureSemanticInteractive();
        var endpoint = BrowserCdpEndpoint(args);
        var target = BrowserSelectTarget(endpoint, args);
        var socket = BrowserConnectSocket(target.WebSocketUrl);

        var session = new BrowserSemanticSession
        {
            Id = "sem_browser_" + Guid.NewGuid().ToString("N"),
            Epoch = "ep_" + Guid.NewGuid().ToString("N"),
            Endpoint = endpoint,
            TargetId = target.Id,
            TargetTitle = target.Title,
            TargetUrl = target.Url,
            MaxDepth = SemanticInt(args, "maxDepth", 8, 0, 12),
            MaxNodes = SemanticInt(args, "maxNodes", 600, 1, 1500),
            AttachedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Socket = socket,
            ConnectionGeneration = 1
        };
        session.KnownTargetIds.Add(target.Id);
        try
        {
            foreach (var knownTarget in BrowserListTargets(endpoint))
                session.KnownTargetIds.Add(knownTarget.Id);
        }
        catch { }
        session.Receiver = Task.Run(() => BrowserReceiveLoop(session, socket, session.ConnectionGeneration));

        try
        {
            BrowserEnableDomains(session);
            session.EventsAvailable = true;
            lock (SemanticLock) BrowserSemanticSessions[session.Id] = session;
            return BrowserSemanticSnapshotCore(session, true);
        }
        catch
        {
            lock (SemanticLock) BrowserSemanticSessions.Remove(session.Id);
            session.Dispose();
            throw;
        }
    }

    private static object BrowserSemanticSnapshot(JsonElement args)
    {
        EnsureSemanticInteractive();
        var session = BrowserSemanticSessionFromArgs(args);
        return BrowserSemanticSnapshotCore(session, false);
    }

    private static object BrowserSemanticDetach(JsonElement args)
    {
        var id = SemanticSessionId(args);
        BrowserSemanticSession session;
        lock (SemanticLock)
        {
            if (!BrowserSemanticSessions.Remove(id, out session!))
                throw new InvalidOperationException("semantic_session_not_found");
        }
        long stateSeq;
        lock (session.Gate) stateSeq = session.StateSeq;
        session.Dispose();
        return new
        {
            protocolVersion = ProtocolVersion,
            provider = "browser-cdp",
            semanticSessionId = session.Id,
            epoch = session.Epoch,
            stateSeq,
            detached = true
        };
    }

    private static object BrowserSemanticEvents(JsonElement args)
    {
        var session = BrowserSemanticSessionFromArgs(args);
        var afterSeq = SemanticAfterSeq(args);
        var limit = SemanticInt(args, "limit", 100, 1, 200);
        lock (session.Gate)
        {
            var events = new List<object>(Math.Min(limit, session.Journal.Count));
            var remaining = 0;
            var eventResyncRecommended = false;
            foreach (var item in session.Journal)
            {
                if (item.Seq <= afterSeq) continue;
                if (item.ResyncRecommended) eventResyncRecommended = true;
                if (events.Count >= limit) { remaining++; continue; }
                events.Add(new
                {
                    seq = item.Seq,
                    timestamp = item.Timestamp,
                    kind = item.Kind,
                    property = item.Property,
                    change = item.Change,
                    element = (object?)null,
                    resyncRecommended = item.ResyncRecommended,
                    coalesced = 1
                });
            }
            var oldestAvailableSeq = session.Journal.Count > 0 ? session.Journal[0].Seq : session.StateSeq + 1;
            var gap = session.DroppedBeforeSeq > 0 && afterSeq < session.DroppedBeforeSeq;
            return new
            {
                protocolVersion = ProtocolVersion,
                provider = "browser-cdp",
                semanticSessionId = session.Id,
                epoch = session.Epoch,
                afterSeq,
                stateSeq = session.StateSeq,
                oldestAvailableSeq,
                droppedBeforeSeq = session.DroppedBeforeSeq,
                gap,
                scopeChanged = session.ScopeChanged,
                resyncRecommended = gap || session.ScopeChanged || eventResyncRecommended,
                eventsAvailable = session.EventsAvailable,
                subscriptions = new { accessibility = true, dom = true, page = true },
                hasMore = remaining > 0,
                events
            };
        }
    }

    private static BrowserSemanticSession BrowserSemanticSessionFromArgs(JsonElement args)
    {
        var id = SemanticSessionId(args);
        lock (SemanticLock)
        {
            if (!BrowserSemanticSessions.TryGetValue(id, out var session))
                throw new InvalidOperationException("semantic_session_not_found");
            return session;
        }
    }

    private static async Task BrowserReceiveLoop(BrowserSemanticSession session, ClientWebSocket socket, long generation)
    {
        var buffer = new byte[64 * 1024];
        try
        {
            while (!session.Cancellation.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                using var stream = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), session.Cancellation.Token);
                    if (result.MessageType == WebSocketMessageType.Close) throw new InvalidOperationException("browser_cdp_closed");
                    if (result.Count > 0) stream.Write(buffer, 0, result.Count);
                    if (stream.Length > 4 * 1024 * 1024) throw new InvalidOperationException("browser_cdp_message_too_large");
                }
                while (!result.EndOfMessage);

                using var document = JsonDocument.Parse(stream.ToArray());
                var root = document.RootElement.Clone();
                if (!BrowserConnectionCurrent(session, socket, generation)) continue;
                if (root.TryGetProperty("id", out var idNode) && idNode.TryGetInt64(out var id))
                {
                    if (session.Pending.TryRemove(id, out var pending)) pending.TrySetResult(root);
                    continue;
                }
                if (root.TryGetProperty("method", out var methodNode) && methodNode.ValueKind == JsonValueKind.String)
                    BrowserHandleEvent(session, methodNode.GetString() ?? "", root.TryGetProperty("params", out var p) ? p : default);
            }
        }
        catch (OperationCanceledException) when (session.Cancellation.IsCancellationRequested) { }
        catch (Exception ex)
        {
            if (!BrowserConnectionCurrent(session, socket, generation)) return;
            foreach (var pair in session.Pending)
                if (session.Pending.TryRemove(pair.Key, out var pending)) pending.TrySetException(new InvalidOperationException($"browser_cdp_receive_failed:{ex.Message}"));
            BrowserEnqueueEvent(session, "connection", null, "closed", true);
        }
    }

    private static bool BrowserConnectionCurrent(BrowserSemanticSession session, ClientWebSocket socket, long generation)
    {
        lock (session.Gate)
            return session.ConnectionGeneration == generation && ReferenceEquals(session.Socket, socket);
    }

    private static JsonElement BrowserCdpCommand(BrowserSemanticSession session, string method, object? parameters = null)
    {
        ClientWebSocket socket;
        lock (session.Gate) socket = session.Socket;
        if (socket.State != WebSocketState.Open) throw new InvalidOperationException("browser_cdp_not_connected");
        var id = Interlocked.Increment(ref session.NextCommandId);
        var pending = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!session.Pending.TryAdd(id, pending)) throw new InvalidOperationException("browser_cdp_command_collision");

        object envelope;
        if (parameters is null) envelope = new { id, method };
        else envelope = new { id, method, @params = parameters };
        var payload = JsonSerializer.SerializeToUtf8Bytes(envelope);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(6));
        try
        {
            session.SendGate.Wait(timeout.Token);
            try
            {
                socket.SendAsync(new ArraySegment<byte>(payload), WebSocketMessageType.Text, true, timeout.Token).GetAwaiter().GetResult();
            }
            finally { session.SendGate.Release(); }

            var message = pending.Task.WaitAsync(timeout.Token).GetAwaiter().GetResult();
            if (message.TryGetProperty("error", out var error))
            {
                var code = error.TryGetProperty("code", out var c) && c.TryGetInt32(out var cv) ? cv : 0;
                var text = error.TryGetProperty("message", out var m) ? LimitSemanticText(m.GetString(), 256) : "unknown";
                throw new InvalidOperationException($"browser_cdp_error:{code}:{text}");
            }
            if (!message.TryGetProperty("result", out var result)) throw new InvalidOperationException("browser_cdp_result_missing");
            return result.Clone();
        }
        catch (OperationCanceledException)
        {
            throw new InvalidOperationException("browser_cdp_timeout");
        }
        finally
        {
            session.Pending.TryRemove(id, out _);
        }
    }

    private static void BrowserHandleEvent(BrowserSemanticSession session, string method, JsonElement args)
    {
        switch (method)
        {
            case "Accessibility.nodesUpdated":
                var count = args.ValueKind == JsonValueKind.Object && args.TryGetProperty("nodes", out var nodes) && nodes.ValueKind == JsonValueKind.Array ? nodes.GetArrayLength() : 0;
                BrowserEnqueueEvent(session, "accessibility", "nodes", $"updated:{count}", false);
                break;
            case "Accessibility.loadComplete":
                BrowserEnqueueEvent(session, "accessibility", null, "loadComplete", true);
                break;
            case "DOM.documentUpdated":
                BrowserEnqueueEvent(session, "structure", null, "documentUpdated", true);
                break;
            case "Page.frameNavigated":
                BrowserEnqueueEvent(session, "navigation", null, "frameNavigated", true);
                break;
            case "Page.navigatedWithinDocument":
                BrowserEnqueueEvent(session, "navigation", null, "sameDocument", true);
                break;
            case "Page.lifecycleEvent":
                if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String)
                    BrowserEnqueueEvent(session, "lifecycle", null, LimitSemanticText(name.GetString(), 64), false);
                break;
        }
    }

    private static void BrowserEnqueueEvent(BrowserSemanticSession session, string kind, string? property, string? change, bool resyncRecommended)
    {
        lock (session.Gate)
        {
            var item = new BrowserSemanticEventRecord
            {
                Seq = ++session.StateSeq,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Kind = kind,
                Property = property,
                Change = change,
                ResyncRecommended = resyncRecommended
            };
            session.Journal.Add(item);
            while (session.Journal.Count > BrowserSemanticJournalLimit)
            {
                session.DroppedBeforeSeq = Math.Max(session.DroppedBeforeSeq, session.Journal[0].Seq);
                session.Journal.RemoveAt(0);
            }
        }
    }

    private static Uri BrowserCdpEndpoint(JsonElement args)
    {
        if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("cdpEndpoint", out var node))
        {
            if (node.ValueKind != JsonValueKind.String) throw new InvalidOperationException("browser_cdp_endpoint_invalid");
            return BrowserValidateHttpEndpoint(node.GetString() ?? "");
        }

        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var candidates = new[]
        {
            Path.Combine(local, "Google", "Chrome", "User Data", "DevToolsActivePort"),
            Path.Combine(local, "Microsoft", "Edge", "User Data", "DevToolsActivePort"),
            Path.Combine(local, "Chromium", "User Data", "DevToolsActivePort")
        };
        foreach (var path in candidates)
        {
            try
            {
                if (!File.Exists(path)) continue;
                var first = File.ReadLines(path).FirstOrDefault()?.Trim();
                if (int.TryParse(first, out var port) && port is >= 1024 and <= 65535)
                    return new Uri($"http://127.0.0.1:{port}/");
            }
            catch { }
        }
        throw new InvalidOperationException("browser_cdp_unavailable");
    }

    private static Uri BrowserValidateHttpEndpoint(string raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttp || uri.Port is < 1 or > 65535)
            throw new InvalidOperationException("browser_cdp_endpoint_invalid");
        if (!BrowserLoopbackHost(uri.Host)) throw new InvalidOperationException("browser_cdp_endpoint_not_loopback");
        return new UriBuilder(Uri.UriSchemeHttp, uri.Host, uri.Port, "/").Uri;
    }

    private static Uri BrowserValidateWebSocketEndpoint(string raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri) || uri.Scheme != "ws" || uri.Port is < 1 or > 65535)
            throw new InvalidOperationException("browser_cdp_websocket_invalid");
        if (!BrowserLoopbackHost(uri.Host)) throw new InvalidOperationException("browser_cdp_websocket_not_loopback");
        return uri;
    }

    private static bool BrowserLoopbackHost(string host)
    {
        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)) return true;
        return IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address);
    }

    private static ClientWebSocket BrowserConnectSocket(Uri endpoint)
    {
        var socket = new ClientWebSocket();
        socket.Options.Proxy = null;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        socket.ConnectAsync(endpoint, timeout.Token).GetAwaiter().GetResult();
        return socket;
    }

    private static void BrowserCloseSocket(ClientWebSocket socket)
    {
        try { socket.Abort(); } catch { }
        try { socket.Dispose(); } catch { }
    }

    private static void BrowserEnableDomains(BrowserSemanticSession session)
    {
        _ = BrowserCdpCommand(session, "Accessibility.enable");
        _ = BrowserCdpCommand(session, "DOM.enable");
        _ = BrowserCdpCommand(session, "Page.enable");
        try { _ = BrowserCdpCommand(session, "Page.setLifecycleEventsEnabled", new { enabled = true }); } catch { }
    }

    private static List<BrowserTarget> BrowserListTargets(Uri endpoint)
    {
        var root = BrowserHttpJson(new Uri(endpoint, "/json/list"));
        if (root.ValueKind != JsonValueKind.Array) throw new InvalidOperationException("browser_cdp_target_list_invalid");
        var targets = new List<BrowserTarget>();
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            var type = BrowserJsonString(item, "type");
            var id = BrowserJsonString(item, "id");
            var title = BrowserJsonString(item, "title");
            var url = BrowserJsonString(item, "url");
            var ws = BrowserJsonString(item, "webSocketDebuggerUrl");
            if (!string.Equals(type, "page", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(ws)) continue;
            if (url.StartsWith("devtools://", StringComparison.OrdinalIgnoreCase)) continue;
            targets.Add(new BrowserTarget(id, type, LimitSemanticText(title, 512) ?? "", LimitSemanticText(url, 2048) ?? "", BrowserValidateWebSocketEndpoint(ws)));
        }
        return targets;
    }

    private static bool BrowserTargetTitleMatches(BrowserTarget target, string foregroundTitle) =>
        !string.IsNullOrWhiteSpace(target.Title) &&
        !string.IsNullOrWhiteSpace(foregroundTitle) &&
        (foregroundTitle.Contains(target.Title, StringComparison.OrdinalIgnoreCase) ||
         target.Title.Contains(foregroundTitle, StringComparison.OrdinalIgnoreCase));

    private static BrowserTarget? BrowserForegroundTarget(Uri endpoint)
    {
        var foregroundTitle = WindowText(GetForegroundWindow());
        if (string.IsNullOrWhiteSpace(foregroundTitle)) return null;
        return BrowserListTargets(endpoint).FirstOrDefault(t => BrowserTargetTitleMatches(t, foregroundTitle));
    }

    private static bool BrowserTargetMatchesForegroundWindow(BrowserSemanticSession session, BrowserTarget target, IntPtr foreground)
    {
        if (foreground == IntPtr.Zero || !GetWindowRect(foreground, out var rect)) return false;
        try
        {
            var window = BrowserCdpCommand(session, "Browser.getWindowForTarget", new { targetId = target.Id });
            if (!window.TryGetProperty("bounds", out var bounds) || bounds.ValueKind != JsonValueKind.Object) return false;
            var left = BrowserJsonNumber(bounds, "left");
            var top = BrowserJsonNumber(bounds, "top");
            var width = BrowserJsonNumber(bounds, "width");
            var height = BrowserJsonNumber(bounds, "height");
            if (width <= 0 || height <= 0) return false;

            var fgWidth = Math.Max(1, rect.Right - rect.Left);
            var fgHeight = Math.Max(1, rect.Bottom - rect.Top);
            var fgCenterX = rect.Left + fgWidth / 2d;
            var fgCenterY = rect.Top + fgHeight / 2d;
            var targetCenterX = left + width / 2d;
            var targetCenterY = top + height / 2d;
            var centerToleranceX = Math.Max(96d, fgWidth * 0.18d);
            var centerToleranceY = Math.Max(96d, fgHeight * 0.18d);
            return Math.Abs(targetCenterX - fgCenterX) <= centerToleranceX &&
                   Math.Abs(targetCenterY - fgCenterY) <= centerToleranceY &&
                   Math.Abs(width - fgWidth) <= Math.Max(160d, fgWidth * 0.25d) &&
                   Math.Abs(height - fgHeight) <= Math.Max(160d, fgHeight * 0.25d);
        }
        catch { return false; }
    }

    private static BrowserTarget? BrowserForegroundTarget(BrowserSemanticSession session)
    {
        var targets = BrowserListTargets(session.Endpoint);
        if (targets.Count == 0) return null;

        var foreground = GetForegroundWindow();
        var foregroundTitle = WindowText(foreground);
        string currentId;
        HashSet<string> known;
        string[] history;
        lock (session.Gate)
        {
            currentId = session.TargetId;
            known = new HashSet<string>(session.KnownTargetIds, StringComparer.Ordinal);
            history = session.TargetHistory.ToArray();
        }

        var titleMatches = targets.Where(t => BrowserTargetTitleMatches(t, foregroundTitle)).ToList();
        var currentTarget = targets.FirstOrDefault(t => string.Equals(t.Id, currentId, StringComparison.Ordinal));
        var currentPresent = currentTarget is not null;
        BrowserTarget? selected = null;

        var newlySeen = titleMatches.Where(t => !known.Contains(t.Id)).ToList();
        if (newlySeen.Count == 1) selected = newlySeen[0];

        // Window identity outranks a temporarily stale Win32 caption after page title changes.
        // New-target detection stays first so a newly opened same-title tab in the same HWND can still win.
        if (selected is null && currentTarget is not null && foreground != IntPtr.Zero &&
            BrowserTargetMatchesForegroundWindow(session, currentTarget, foreground))
            selected = currentTarget;

        if (selected is null && titleMatches.Count > 1 && foreground != IntPtr.Zero)
        {
            var windowMatches = titleMatches.Where(t => BrowserTargetMatchesForegroundWindow(session, t, foreground)).ToList();
            if (windowMatches.Count == 1) selected = windowMatches[0];
        }

        if (selected is null && !currentPresent)
        {
            for (var i = history.Length - 1; i >= 0; i--)
            {
                selected = titleMatches.FirstOrDefault(t => string.Equals(t.Id, history[i], StringComparison.Ordinal));
                if (selected is not null) break;
            }
        }

        if (selected is null && titleMatches.Count == 1) selected = titleMatches[0];
        if (selected is null && currentPresent)
            selected = targets.First(t => string.Equals(t.Id, currentId, StringComparison.Ordinal));
        if (selected is null && titleMatches.Count > 0) selected = titleMatches[0];

        lock (session.Gate)
        {
            foreach (var target in targets)
            {
                if (selected is not null &&
                    !string.Equals(selected.Id, currentId, StringComparison.Ordinal) &&
                    string.Equals(target.Id, selected.Id, StringComparison.Ordinal))
                    continue;
                session.KnownTargetIds.Add(target.Id);
            }
        }
        return selected;
    }

    private static bool BrowserMaybeHandoffToForegroundTarget(BrowserSemanticSession session)
    {
        BrowserTarget? target;
        try { target = BrowserForegroundTarget(session); }
        catch { return false; }
        if (target is null) return false;

        string currentId;
        lock (session.Gate) currentId = session.TargetId;
        if (string.Equals(currentId, target.Id, StringComparison.Ordinal)) return false;

        ClientWebSocket newSocket;
        try { newSocket = BrowserConnectSocket(target.WebSocketUrl); }
        catch { return false; }

        ClientWebSocket oldSocket;
        string oldTargetId;
        string oldTargetTitle;
        string oldTargetUrl;
        long oldGeneration;
        long newGeneration;
        lock (session.Gate)
        {
            oldSocket = session.Socket;
            oldTargetId = session.TargetId;
            oldTargetTitle = session.TargetTitle;
            oldTargetUrl = session.TargetUrl;
            oldGeneration = session.ConnectionGeneration;
            session.Socket = newSocket;
            session.TargetId = target.Id;
            session.TargetTitle = target.Title;
            session.TargetUrl = target.Url;
            newGeneration = oldGeneration + 1;
            session.ConnectionGeneration = newGeneration;
        }

        session.Receiver = Task.Run(() => BrowserReceiveLoop(session, newSocket, newGeneration));
        try
        {
            BrowserEnableDomains(session);
        }
        catch
        {
            lock (session.Gate)
            {
                if (ReferenceEquals(session.Socket, newSocket))
                {
                    session.Socket = oldSocket;
                    session.TargetId = oldTargetId;
                    session.TargetTitle = oldTargetTitle;
                    session.TargetUrl = oldTargetUrl;
                    session.ConnectionGeneration = oldGeneration;
                }
            }
            BrowserCloseSocket(newSocket);
            return false;
        }

        lock (session.Gate)
        {
            session.KnownTargetIds.Add(oldTargetId);
            session.KnownTargetIds.Add(target.Id);
            session.TargetHistory.RemoveAll(id => string.Equals(id, oldTargetId, StringComparison.Ordinal));
            session.TargetHistory.Add(oldTargetId);
            while (session.TargetHistory.Count > 16) session.TargetHistory.RemoveAt(0);
        }
        BrowserEnqueueEvent(session, "target", "targetId", $"handoff:{oldTargetId}->{target.Id}", true);
        BrowserCloseSocket(oldSocket);
        return true;
    }

    private static BrowserTarget BrowserSelectTarget(Uri endpoint, JsonElement args)
    {
        var targets = BrowserListTargets(endpoint);
        if (targets.Count == 0) throw new InvalidOperationException("browser_cdp_target_not_found");

        var targetId = BrowserOptionalArg(args, "targetId", 256);
        if (!string.IsNullOrEmpty(targetId))
            return targets.FirstOrDefault(t => string.Equals(t.Id, targetId, StringComparison.Ordinal))
                ?? throw new InvalidOperationException("browser_cdp_target_not_found");

        var urlMatch = BrowserOptionalArg(args, "urlMatch", 512);
        if (!string.IsNullOrEmpty(urlMatch))
            return targets.FirstOrDefault(t => t.Url.Contains(urlMatch, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("browser_cdp_target_not_found");

        return BrowserForegroundTarget(endpoint) ?? targets[0];
    }

    private static JsonElement BrowserHttpJson(Uri uri)
    {
        using var handler = new SocketsHttpHandler { UseProxy = false, AllowAutoRedirect = false };
        using var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(3) };
        using var response = http.GetAsync(uri).GetAwaiter().GetResult();
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"browser_cdp_http_{(int)response.StatusCode}");
        var bytes = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
        if (bytes.Length > 2 * 1024 * 1024) throw new InvalidOperationException("browser_cdp_http_too_large");
        using var document = JsonDocument.Parse(bytes);
        return document.RootElement.Clone();
    }

    private static string BrowserJsonString(JsonElement item, string name) =>
        item.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.String ? node.GetString() ?? "" : "";

    private static string? BrowserOptionalArg(JsonElement args, string name, int max)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty(name, out var node)) return null;
        if (node.ValueKind != JsonValueKind.String) throw new InvalidOperationException($"browser_cdp_{name}_invalid");
        var value = (node.GetString() ?? "").Trim();
        if (value.Length > max) throw new InvalidOperationException($"browser_cdp_{name}_invalid");
        return value;
    }
}
