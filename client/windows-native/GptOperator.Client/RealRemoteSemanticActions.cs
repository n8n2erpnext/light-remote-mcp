using System.Text.Json;
using System.Windows.Automation;

namespace GptOperator.Client;

internal static partial class RealRemoteHelper
{
    private static object Observe(JsonElement args)
    {
        if (args.ValueKind == JsonValueKind.Object &&
            args.TryGetProperty("semanticSessionId", out var idNode) &&
            idNode.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(idNode.GetString()))
        {
            if (args.TryGetProperty("afterSeq", out _))
                return SemanticEvents(args);
            return SemanticSnapshot(args);
        }

        return SemanticAttach(args);
    }

    private static object Act(JsonElement args)
    {
        if (args.ValueKind == JsonValueKind.Object &&
            args.TryGetProperty("nodeId", out var nodeId) &&
            nodeId.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(nodeId.GetString()))
            return SemanticAct(args);

        return Input(args);
    }

    private static object SemanticAct(JsonElement args)
    {
        EnsureSemanticInteractive();
        var context = BeginSemanticInput(args) ?? throw new InvalidOperationException("semantic_session_id_required");
        if (context.BrowserSession is not null)
            throw new InvalidOperationException("semantic_action_provider_observation_only");

        var session = context.Session ?? throw new InvalidOperationException("semantic_session_not_found");
        _ = RefreshSemanticForegroundRoot(session);

        var nodeId = RequiredSemanticString(args, "nodeId", 128);
        var action = RequiredSemanticString(args, "action", 64).Trim().ToLowerInvariant();

        AutomationElement element;
        lock (session.Gate)
        {
            if (!session.NodeIndex.TryGetValue(nodeId, out element!))
                throw new InvalidOperationException("semantic_node_stale_or_not_found");
        }

        if (!SemanticContains(session, element))
            throw new InvalidOperationException("semantic_node_outside_scope");

        string method;
        try
        {
            method = action switch
            {
                "invoke" => InvokeElement(element),
                "toggle" => ToggleElement(element),
                "set-value" or "value" => SetElementValue(element, RequiredSemanticString(args, "value", 4096)),
                "select" => SelectElement(element),
                "expand" => ExpandElement(element, true),
                "collapse" => ExpandElement(element, false),
                "focus" => FocusElement(element),
                "click" => ClickElement(element),
                _ => throw new InvalidOperationException("semantic_action_unsupported")
            };
        }
        catch (ElementNotAvailableException)
        {
            throw new InvalidOperationException("semantic_node_stale_or_not_found");
        }

        return new
        {
            protocolVersion = ProtocolVersion,
            provider = "windows-uia",
            semanticSessionId = session.Id,
            nodeId,
            action,
            method,
            ack = CompleteSemanticInput(context, 1, action == "click" ? 2 : 0)
        };
    }

    private static string InvokeElement(AutomationElement element)
    {
        if (!element.TryGetCurrentPattern(InvokePattern.Pattern, out var raw) || raw is not InvokePattern pattern)
            throw new InvalidOperationException("semantic_action_pattern_unavailable:invoke");
        pattern.Invoke();
        return "uia.invoke";
    }

    private static string ToggleElement(AutomationElement element)
    {
        if (!element.TryGetCurrentPattern(TogglePattern.Pattern, out var raw) || raw is not TogglePattern pattern)
            throw new InvalidOperationException("semantic_action_pattern_unavailable:toggle");
        pattern.Toggle();
        return "uia.toggle";
    }

    private static string SetElementValue(AutomationElement element, string value)
    {
        if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out var raw) || raw is not ValuePattern pattern)
            throw new InvalidOperationException("semantic_action_pattern_unavailable:value");
        if (pattern.Current.IsReadOnly)
            throw new InvalidOperationException("semantic_action_value_read_only");
        pattern.SetValue(value);
        return "uia.value";
    }

    private static string SelectElement(AutomationElement element)
    {
        if (!element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var raw) || raw is not SelectionItemPattern pattern)
            throw new InvalidOperationException("semantic_action_pattern_unavailable:selectionItem");
        pattern.Select();
        return "uia.selectionItem";
    }

    private static string ExpandElement(AutomationElement element, bool expand)
    {
        if (!element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out var raw) || raw is not ExpandCollapsePattern pattern)
            throw new InvalidOperationException("semantic_action_pattern_unavailable:expandCollapse");
        if (expand) pattern.Expand(); else pattern.Collapse();
        return expand ? "uia.expand" : "uia.collapse";
    }

    private static string FocusElement(AutomationElement element)
    {
        element.SetFocus();
        return "uia.focus";
    }

    private static string ClickElement(AutomationElement element)
    {
        var bounds = element.Current.BoundingRectangle;
        if (bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0)
            throw new InvalidOperationException("semantic_action_click_bounds_unavailable");
        var x = (int)Math.Round(bounds.X + bounds.Width / 2d);
        var y = (int)Math.Round(bounds.Y + bounds.Height / 2d);
        if (!SetCursorPos(x, y))
            throw Win32InputError("desktop_input_cursor_blocked");
        _ = Dispatch(new[] { Mouse(MouseLeftDown, 0), Mouse(MouseLeftUp, 0) });
        return "sendinput.click";
    }

    private static string RequiredSemanticString(JsonElement args, string name, int max)
    {
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty(name, out var node) ||
            node.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException($"semantic_{name}_required");
        var value = node.GetString() ?? "";
        if (value.Length < 1 || value.Length > max)
            throw new InvalidOperationException($"semantic_{name}_invalid");
        return value;
    }
}
