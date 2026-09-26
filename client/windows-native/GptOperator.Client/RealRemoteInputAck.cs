using System.Text.Json;
using System.Windows.Automation;
using System.Windows.Forms;

namespace GptOperator.Client;

internal static partial class RealRemoteHelper
{
    private sealed class SemanticInputContext
    {
        public SemanticSession? Session { get; init; }
        public BrowserSemanticSession? BrowserSession { get; init; }
        public required string Provider { get; init; }
        public required long AfterSeq { get; init; }
        public required int SettleMs { get; init; }
        public required long StartedAt { get; init; }
    }

    private static SemanticInputContext? BeginSemanticInput(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty("semanticSessionId", out _))
            return null;

        var id = SemanticSessionId(args);
        SemanticSession? session = null;
        BrowserSemanticSession? browserSession = null;
        lock (SemanticLock)
        {
            if (!SemanticSessions.TryGetValue(id, out session))
                BrowserSemanticSessions.TryGetValue(id, out browserSession);
            if (session is null && browserSession is null)
                throw new InvalidOperationException("semantic_session_not_found");
        }

        long currentSeq;
        if (browserSession is not null)
        {
            lock (browserSession.Gate) currentSeq = browserSession.StateSeq;
        }
        else
        {
            lock (session!.Gate) currentSeq = session.StateSeq;
        }

        var afterSeq = currentSeq;
        if (args.TryGetProperty("afterSeq", out var afterNode))
        {
            if (!afterNode.TryGetInt64(out afterSeq) || afterSeq < 0)
                throw new InvalidOperationException("desktop_input_after_seq_invalid");
            if (afterSeq > currentSeq)
                throw new InvalidOperationException("desktop_input_after_seq_ahead");
        }

        return new SemanticInputContext
        {
            Session = session,
            BrowserSession = browserSession,
            Provider = browserSession is null ? "windows-uia" : "browser-cdp",
            AfterSeq = afterSeq,
            SettleMs = SemanticInt(args, "settleMs", 90, 0, 250),
            StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
    }

    private static object CompleteSemanticInput(SemanticInputContext? context, int applied, int sent)
    {
        var cursor = GetCursorPos(out var point) ? new { x = point.X, y = point.Y } : null;
        if (context is null)
            return new { protocolVersion = ProtocolVersion, appliedEvents = applied, sentInputs = sent, cursor };

        if (context.SettleMs > 0)
            System.Threading.Thread.Sleep(context.SettleMs);

        if (context.BrowserSession is not null)
            return CompleteBrowserSemanticInput(context, applied, sent, cursor);

        var session = context.Session!;
        // Refresh the bounded semantic tree locally after input. This updates NodeIndex
        // for newly-created controls and produces a compact diff against the previous
        // snapshot without another Agent round trip.
        var capture = CaptureSemanticState(session);
        Dictionary<string, object?>? focused = null;
        var focusOutsideScope = false;
        try
        {
            var focus = AutomationElement.FocusedElement;
            if (focus is not null)
            {
                if (SemanticContains(session, focus)) focused = SafeSemanticEventNode(session, focus);
                else focusOutsideScope = true;
            }
        }
        catch (ElementNotAvailableException) { }
        catch (InvalidOperationException) { }

        return CompleteSemanticInputLocked(context, applied, sent, cursor, focused, focusOutsideScope, capture);
    }

    private static object CompleteBrowserSemanticInput(
        SemanticInputContext context,
        int applied,
        int sent,
        object? cursor)
    {
        var session = context.BrowserSession ?? throw new InvalidOperationException("semantic_session_not_found");

        // Observation only: CDP refreshes semantic state after OS SendInput. It never injects input.
        _ = BrowserSemanticSnapshotCore(session, false);

        var events = new List<object>(100);
        long inputSeq;
        long stateSeq;
        long oldestAvailableSeq;
        long droppedBeforeSeq;
        bool gap;
        bool scopeChanged;
        bool hasMore;
        bool eventsAvailable;
        bool eventResyncRecommended;
        long lastReturnedSeq;
        string targetId;
        string targetTitle;
        string targetUrl;

        lock (session.Gate)
        {
            inputSeq = ++session.InputSeq;
            stateSeq = session.StateSeq;
            var remaining = 0;
            eventResyncRecommended = false;
            lastReturnedSeq = context.AfterSeq;
            foreach (var item in session.Journal)
            {
                if (item.Seq <= context.AfterSeq) continue;
                if (item.ResyncRecommended) eventResyncRecommended = true;
                if (events.Count >= 100) { remaining++; continue; }
                lastReturnedSeq = item.Seq;
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
            oldestAvailableSeq = session.Journal.Count > 0 ? session.Journal[0].Seq : stateSeq + 1;
            droppedBeforeSeq = session.DroppedBeforeSeq;
            gap = droppedBeforeSeq > 0 && context.AfterSeq < droppedBeforeSeq;
            scopeChanged = session.ScopeChanged;
            hasMore = remaining > 0;
            eventsAvailable = session.EventsAvailable;
            targetId = session.TargetId;
            targetTitle = session.TargetTitle;
            targetUrl = session.TargetUrl;
        }

        var ackAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var resyncRecommended = gap || scopeChanged || eventResyncRecommended;
        var nextAfterSeq = hasMore ? lastReturnedSeq : stateSeq;
        return new
        {
            protocolVersion = ProtocolVersion,
            displayTopologyId = DisplayTopologyId(Screen.AllScreens),
            provider = "browser-cdp",
            appliedEvents = applied,
            sentInputs = sent,
            inputSeq,
            semanticSessionId = session.Id,
            epoch = session.Epoch,
            afterSeq = context.AfterSeq,
            stateSeq,
            startedAt = context.StartedAt,
            ackAt,
            elapsedMs = Math.Max(0, ackAt - context.StartedAt),
            settleMs = context.SettleMs,
            cursor,
            foreground = WindowInfo(GetForegroundWindow()),
            target = new { id = targetId, title = targetTitle, url = targetUrl },
            oldestAvailableSeq,
            droppedBeforeSeq,
            gap,
            scopeChanged,
            resyncRecommended,
            eventsAvailable,
            observation = "cdp-snapshot+journal",
            hasMore,
            nextObservation = new { mode = resyncRecommended ? "snapshot" : "events", afterSeq = nextAfterSeq, reason = resyncRecommended ? "resync-recommended" : hasMore ? "drain-events" : "continue-events" },
            events
        };
    }

    private static object CompleteSemanticInputLocked(
        SemanticInputContext context,
        int applied,
        int sent,
        object? cursor,
        Dictionary<string, object?>? focused,
        bool focusOutsideScope,
        SemanticCapture capture)
    {
        var session = context.Session!;
        var events = new List<object>(24);
        long inputSeq;
        long oldestAvailableSeq;
        long droppedBeforeSeq;
        bool gap;
        int eventCount;
        bool eventsCompacted;

        lock (session.Gate)
        {
            inputSeq = ++session.InputSeq;
            var eligible = new List<SemanticEventRecord>();
            foreach (var item in session.Journal)
            {
                if (item.Seq <= context.AfterSeq || item.Seq > capture.StateSeq) continue;
                eligible.Add(item);
            }
            eventCount = eligible.Count;
            var start = Math.Max(0, eligible.Count - 24);
            for (var index = start; index < eligible.Count; index++)
            {
                var item = eligible[index];
                events.Add(new
                {
                    seq = item.Seq,
                    timestamp = item.Timestamp,
                    kind = item.Kind,
                    property = item.Property,
                    change = item.Change,
                    element = item.Element,
                    resyncRecommended = item.ResyncRecommended,
                    coalesced = item.Coalesced
                });
            }
            eventsCompacted = eventCount > events.Count;
            oldestAvailableSeq = session.Journal.Count > 0 ? session.Journal[0].Seq : capture.StateSeq + 1;
            droppedBeforeSeq = session.DroppedBeforeSeq;
            gap = droppedBeforeSeq > 0 && context.AfterSeq < droppedBeforeSeq;
        }

        var ackAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var resyncRecommended = gap || capture.ScopeChanged || focusOutsideScope || capture.Patch is null;
        return new
        {
            protocolVersion = ProtocolVersion,
            displayTopologyId = DisplayTopologyId(Screen.AllScreens),
            appliedEvents = applied,
            sentInputs = sent,
            inputSeq,
            semanticSessionId = session.Id,
            epoch = session.Epoch,
            afterSeq = context.AfterSeq,
            stateSeq = capture.StateSeq,
            startedAt = context.StartedAt,
            ackAt,
            elapsedMs = Math.Max(0, ackAt - context.StartedAt),
            settleMs = context.SettleMs,
            cursor,
            foreground = WindowInfo(GetForegroundWindow()),
            focused,
            focusOutsideScope,
            oldestAvailableSeq,
            droppedBeforeSeq,
            gap,
            scopeChanged = capture.ScopeChanged,
            resyncRecommended,
            observation = "local-diff+journal",
            snapshotNodeCount = capture.Rows.Count,
            snapshotTruncated = capture.Truncated,
            patch = capture.Patch,
            eventCount,
            eventsCompacted,
            hasMore = false,
            nextObservation = new { mode = resyncRecommended ? "snapshot" : "events", afterSeq = capture.StateSeq, reason = resyncRecommended ? "resync-recommended" : "patch-applied" },
            events
        };
    }
}
