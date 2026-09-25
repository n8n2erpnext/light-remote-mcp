using System.Text.Json;
using System.Windows.Automation;

namespace GptOperator.Client;

internal static partial class RealRemoteHelper
{
    private const int SemanticJournalLimit = 512;
    private const long SemanticCoalesceMs = 75;

    private sealed class SemanticEventRecord
    {
        public required long Seq { get; init; }
        public required long Timestamp { get; set; }
        public required string Key { get; init; }
        public required string Kind { get; init; }
        public string? Property { get; init; }
        public string? Change { get; init; }
        public Dictionary<string, object?>? Element { get; set; }
        public bool ResyncRecommended { get; init; }
        public int Coalesced { get; set; } = 1;
    }

    private static void SubscribeSemantic(SemanticSession session)
    {
        session.FocusHandler = (sender, _) =>
        {
            if (sender is not AutomationElement element) return;
            if (!SemanticContains(session, element))
            {
                if (session.Scope == "foreground")
                {
                    lock (session.Gate) session.ScopeChanged = true;
                    EnqueueSemantic(session, "scope", null, "focus_outside_attached_root", null, true);
                }
                return;
            }
            EnqueueSemantic(session, "focus", element, null, null, false);
        };
        try
        {
            Automation.AddAutomationFocusChangedEventHandler(session.FocusHandler);
            session.FocusSubscribed = true;
        }
        catch (InvalidOperationException) { }
        catch (ElementNotAvailableException) { }

        session.StructureHandler = (sender, args) =>
        {
            if (sender is not AutomationElement element) return;
            EnqueueSemantic(session, "structure", element, null, args.StructureChangeType.ToString(), false);
        };
        try
        {
            Automation.AddStructureChangedEventHandler(session.Root, TreeScope.Subtree, session.StructureHandler);
            session.StructureSubscribed = true;
        }
        catch (InvalidOperationException) { }
        catch (ElementNotAvailableException) { }

        session.PropertyHandler = (sender, args) =>
        {
            if (sender is not AutomationElement element) return;
            EnqueueSemantic(session, "property", element, args.Property.ProgrammaticName, null, false);
        };
        try
        {
            Automation.AddAutomationPropertyChangedEventHandler(
                session.Root,
                TreeScope.Subtree,
                session.PropertyHandler,
                AutomationElement.NameProperty,
                AutomationElement.AutomationIdProperty,
                AutomationElement.BoundingRectangleProperty,
                AutomationElement.IsEnabledProperty,
                AutomationElement.IsOffscreenProperty,
                AutomationElement.HasKeyboardFocusProperty);
            session.PropertySubscribed = true;
        }
        catch (InvalidOperationException) { }
        catch (ElementNotAvailableException) { }
    }

    private static void UnsubscribeSemantic(SemanticSession session)
    {
        if (session.FocusSubscribed && session.FocusHandler is not null)
        {
            try { Automation.RemoveAutomationFocusChangedEventHandler(session.FocusHandler); } catch { }
            session.FocusSubscribed = false;
        }
        if (session.StructureSubscribed && session.StructureHandler is not null)
        {
            try { Automation.RemoveStructureChangedEventHandler(session.Root, session.StructureHandler); } catch { }
            session.StructureSubscribed = false;
        }
        if (session.PropertySubscribed && session.PropertyHandler is not null)
        {
            try { Automation.RemoveAutomationPropertyChangedEventHandler(session.Root, session.PropertyHandler); } catch { }
            session.PropertySubscribed = false;
        }
    }

    private static bool SemanticContains(SemanticSession session, AutomationElement element)
    {
        if (session.Scope == "desktop") return true;
        try
        {
            AutomationElement? current = element;
            for (var depth = 0; current is not null && depth < 96; depth++)
            {
                if (Automation.Compare(session.Root, current)) return true;
                current = TreeWalker.ControlViewWalker.GetParent(current);
            }
        }
        catch (ElementNotAvailableException) { }
        catch (InvalidOperationException) { }
        return false;
    }

    private static Dictionary<string, object?>? SafeSemanticEventNode(SemanticSession session, AutomationElement element)
    {
        try { return SemanticNode(element, null, -1, "event", session.Epoch); }
        catch (ElementNotAvailableException) { return null; }
        catch (InvalidOperationException) { return null; }
    }

    private static void EnqueueSemantic(SemanticSession session, string kind, AutomationElement? element, string? property, string? change, bool resyncRecommended)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var metadata = element is null ? null : SafeSemanticEventNode(session, element);
        var elementId = metadata is not null && metadata.TryGetValue("id", out var rawId) ? Convert.ToString(rawId) : null;
        var key = $"{kind}|{elementId ?? "-"}|{property ?? "-"}|{change ?? "-"}";

        lock (session.Gate)
        {
            if (session.Journal.Count > 0)
            {
                var last = session.Journal[^1];
                if (last.Key == key && now - last.Timestamp <= SemanticCoalesceMs)
                {
                    last.Timestamp = now;
                    last.Element = metadata ?? last.Element;
                    last.Coalesced++;
                    return;
                }
            }

            var record = new SemanticEventRecord
            {
                Seq = ++session.StateSeq,
                Timestamp = now,
                Key = key,
                Kind = kind,
                Property = property,
                Change = change,
                Element = metadata,
                ResyncRecommended = resyncRecommended
            };
            session.Journal.Add(record);
            while (session.Journal.Count > SemanticJournalLimit)
            {
                session.DroppedBeforeSeq = Math.Max(session.DroppedBeforeSeq, session.Journal[0].Seq);
                session.Journal.RemoveAt(0);
            }
        }
    }

    private static object SemanticEvents(JsonElement args)
    {
        var id = SemanticSessionId(args);
        if (BrowserSemanticHas(id)) return BrowserSemanticEvents(args);
        var afterSeq = SemanticAfterSeq(args);
        var limit = SemanticInt(args, "limit", 100, 1, 200);
        SemanticSession session;
        lock (SemanticLock)
        {
            if (!SemanticSessions.TryGetValue(id, out session!))
                throw new InvalidOperationException("semantic_session_not_found");
        }

        lock (session.Gate)
        {
            var events = new List<object>(Math.Min(limit, session.Journal.Count));
            var remaining = 0;
            foreach (var item in session.Journal)
            {
                if (item.Seq <= afterSeq) continue;
                if (events.Count >= limit) { remaining++; continue; }
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

            var oldestAvailableSeq = session.Journal.Count > 0 ? session.Journal[0].Seq : session.StateSeq + 1;
            var gap = session.DroppedBeforeSeq > 0 && afterSeq < session.DroppedBeforeSeq;
            return new
            {
                protocolVersion = ProtocolVersion,
                provider = "windows-uia",
                semanticSessionId = session.Id,
                epoch = session.Epoch,
                afterSeq,
                stateSeq = session.StateSeq,
                oldestAvailableSeq,
                droppedBeforeSeq = session.DroppedBeforeSeq,
                gap,
                scopeChanged = session.ScopeChanged,
                resyncRecommended = gap || session.ScopeChanged,
                eventsAvailable = session.FocusSubscribed || session.StructureSubscribed || session.PropertySubscribed,
                subscriptions = new { focus = session.FocusSubscribed, structure = session.StructureSubscribed, property = session.PropertySubscribed },
                hasMore = remaining > 0,
                events
            };
        }
    }

    private static long SemanticAfterSeq(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty("afterSeq", out var node)) return 0;
        if (!node.TryGetInt64(out var value) || value < 0) throw new InvalidOperationException("semantic_after_seq_invalid");
        return value;
    }
}
