using System.Text.Json;
using System.Windows.Automation;

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
            SettleMs = SemanticInt(args, "settleMs", 90, 0, 250)
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

        return CompleteSemanticInputLocked(context, applied, sent, cursor, focused, focusOutsideScope);
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

        lock (session.Gate)
        {
            inputSeq = ++session.InputSeq;
            stateSeq = session.StateSeq;
            var remaining = 0;
            foreach (var item in session.Journal)
            {
                if (item.Seq <= context.AfterSeq) continue;
                if (events.Count >= 100) { remaining++; continue; }
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
        }

        return new
        {
            protocolVersion = ProtocolVersion,
            provider = "browser-cdp",
            appliedEvents = applied,
            sentInputs = sent,
            inputSeq,
            semanticSessionId = session.Id,
            epoch = session.Epoch,
            afterSeq = context.AfterSeq,
            stateSeq,
            ackAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            settleMs = context.SettleMs,
            cursor,
            foreground = WindowInfo(GetForegroundWindow()),
            target = new { id = session.TargetId, title = session.TargetTitle, url = session.TargetUrl },
            oldestAvailableSeq,
            droppedBeforeSeq,
            gap,
            scopeChanged,
            resyncRecommended = gap || scopeChanged,
            eventsAvailable,
            observation = "cdp-snapshot+journal",
            hasMore,
            events
        };
    }

    private static object CompleteSemanticInputLocked(
        SemanticInputContext context,
        int applied,
        int sent,
        object? cursor,
        Dictionary<string, object?>? focused,
        bool focusOutsideScope)
    {
        var session = context.Session!;
        var events = new List<object>(100);
        long inputSeq;
        long stateSeq;
        long oldestAvailableSeq;
        long droppedBeforeSeq;
        bool gap;
        bool scopeChanged;
        bool hasMore;

        lock (session.Gate)
        {
            inputSeq = ++session.InputSeq;
            stateSeq = session.StateSeq;
            var remaining = 0;
            foreach (var item in session.Journal)
            {
                if (item.Seq <= context.AfterSeq) continue;
                if (events.Count >= 100) { remaining++; continue; }
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
            oldestAvailableSeq = session.Journal.Count > 0 ? session.Journal[0].Seq : stateSeq + 1;
            droppedBeforeSeq = session.DroppedBeforeSeq;
            gap = droppedBeforeSeq > 0 && context.AfterSeq < droppedBeforeSeq;
            scopeChanged = session.ScopeChanged;
            hasMore = remaining > 0;
        }

        return new
        {
            protocolVersion = ProtocolVersion,
            appliedEvents = applied,
            sentInputs = sent,
            inputSeq,
            semanticSessionId = session.Id,
            epoch = session.Epoch,
            afterSeq = context.AfterSeq,
            stateSeq,
            ackAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            settleMs = context.SettleMs,
            cursor,
            foreground = WindowInfo(GetForegroundWindow()),
            focused,
            focusOutsideScope,
            oldestAvailableSeq,
            droppedBeforeSeq,
            gap,
            scopeChanged,
            resyncRecommended = gap || scopeChanged || focusOutsideScope,
            hasMore,
            events
        };
    }
}
