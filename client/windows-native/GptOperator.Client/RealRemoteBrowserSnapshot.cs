using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GptOperator.Client;

internal static partial class RealRemoteHelper
{
    private sealed class BrowserDomInfo
    {
        public long BackendNodeId { get; init; }
        public string Tag { get; init; } = "";
        public string? HtmlId { get; init; }
        public string? ClassName { get; init; }
        public string? InputType { get; init; }
        public double X { get; init; }
        public double Y { get; init; }
        public double Width { get; init; }
        public double Height { get; init; }
        public int? PaintOrder { get; init; }
        public bool HasBounds { get; init; }
    }

    private sealed class BrowserViewportInfo
    {
        public double PageX { get; init; }
        public double PageY { get; init; }
        public double ClientWidth { get; init; }
        public double ClientHeight { get; init; }
        public double Scale { get; init; } = 1;
        public bool HasWindow { get; init; }
        public double WindowX { get; init; }
        public double WindowY { get; init; }
        public double WindowWidth { get; init; }
        public double WindowHeight { get; init; }
    }

    private static object BrowserSemanticSnapshotCore(BrowserSemanticSession session, bool attached)
    {
        var ax = BrowserCdpCommand(session, "Accessibility.getFullAXTree", new { depth = session.MaxDepth });
        var dom = default(JsonElement);
        try
        {
            dom = BrowserCdpCommand(session, "DOMSnapshot.captureSnapshot", new
            {
                computedStyles = Array.Empty<string>(),
                includePaintOrder = true,
                includeDOMRects = true
            });
        }
        catch { }
        var domMap = dom.ValueKind == JsonValueKind.Object ? BrowserDomMap(dom) : new Dictionary<long, BrowserDomInfo>();
        var viewport = BrowserViewport(session);
        var rows = BrowserAxRows(session, ax, domMap, viewport, out var truncated);
        BrowserRefreshTargetMetadata(session);

        long stateSeq;
        string targetTitle;
        string targetUrl;
        lock (session.Gate)
        {
            stateSeq = ++session.StateSeq;
            targetTitle = session.TargetTitle;
            targetUrl = session.TargetUrl;
        }
        return new
        {
            protocolVersion = ProtocolVersion,
            provider = "browser-cdp",
            semanticSessionId = session.Id,
            epoch = session.Epoch,
            stateSeq,
            attached,
            attachedAt = session.AttachedAt,
            capturedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            scope = "page",
            maxDepth = session.MaxDepth,
            maxNodes = session.MaxNodes,
            nodeCount = rows.Count,
            truncated,
            target = new { id = session.TargetId, title = targetTitle, url = targetUrl },
            viewport = new
            {
                pageX = RoundInt(viewport.PageX),
                pageY = RoundInt(viewport.PageY),
                clientWidth = RoundInt(viewport.ClientWidth),
                clientHeight = RoundInt(viewport.ClientHeight),
                scale = viewport.Scale,
                screenEstimateAvailable = viewport.HasWindow
            },
            eventsAvailable = session.EventsAvailable,
            subscriptions = new { accessibility = true, dom = true, page = true },
            droppedBeforeSeq = session.DroppedBeforeSeq,
            scopeChanged = session.ScopeChanged,
            nodes = rows
        };
    }

    private static void BrowserRefreshTargetMetadata(BrowserSemanticSession session)
    {
        try
        {
            var history = BrowserCdpCommand(session, "Page.getNavigationHistory");
            if (history.ValueKind != JsonValueKind.Object ||
                !history.TryGetProperty("currentIndex", out var currentNode) ||
                !currentNode.TryGetInt32(out var currentIndex) ||
                currentIndex < 0 ||
                !history.TryGetProperty("entries", out var entries) ||
                entries.ValueKind != JsonValueKind.Array)
                return;

            var index = 0;
            foreach (var entry in entries.EnumerateArray())
            {
                if (index++ != currentIndex) continue;
                if (entry.ValueKind != JsonValueKind.Object ||
                    !entry.TryGetProperty("url", out var urlNode) ||
                    urlNode.ValueKind != JsonValueKind.String)
                    return;

                var url = LimitSemanticText(urlNode.GetString(), 2048);
                if (string.IsNullOrWhiteSpace(url)) return;
                var title = entry.TryGetProperty("title", out var titleNode) && titleNode.ValueKind == JsonValueKind.String
                    ? LimitSemanticText(titleNode.GetString(), 512)
                    : "";

                lock (session.Gate)
                {
                    session.TargetUrl = url;
                    session.TargetTitle = title;
                }
                return;
            }
        }
        catch
        {
            // Target metadata is observational. Keep the last known values if CDP history is unavailable.
        }
    }

    private static List<Dictionary<string, object?>> BrowserAxRows(
        BrowserSemanticSession session,
        JsonElement ax,
        Dictionary<long, BrowserDomInfo> domMap,
        BrowserViewportInfo viewport,
        out bool truncated)
    {
        truncated = false;
        var rows = new List<Dictionary<string, object?>>(Math.Min(session.MaxNodes, 600));
        if (ax.ValueKind != JsonValueKind.Object || !ax.TryGetProperty("nodes", out var nodes) || nodes.ValueKind != JsonValueKind.Array)
            return rows;

        var raw = nodes.EnumerateArray().Select(x => x.Clone()).ToList();
        var parent = new Dictionary<string, string?>(StringComparer.Ordinal);
        var ids = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var node in raw)
        {
            var rawId = BrowserJsonString(node, "nodeId");
            if (string.IsNullOrEmpty(rawId)) continue;
            parent[rawId] = node.TryGetProperty("parentId", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
            ids[rawId] = BrowserSemanticId(session.Epoch, session.TargetId, rawId);
        }

        foreach (var node in raw)
        {
            if (rows.Count >= session.MaxNodes) { truncated = true; break; }
            var rawId = BrowserJsonString(node, "nodeId");
            if (string.IsNullOrEmpty(rawId)) continue;
            var depth = BrowserAxDepth(rawId, parent);
            if (depth > session.MaxDepth) continue;
            rows.Add(BrowserAxNode(session, node, depth, ids, domMap, viewport));
        }
        return rows;
    }

    private static Dictionary<string, object?> BrowserAxNode(
        BrowserSemanticSession session,
        JsonElement node,
        int depth,
        Dictionary<string, string> ids,
        Dictionary<long, BrowserDomInfo> domMap,
        BrowserViewportInfo viewport)
    {
        var rawId = BrowserJsonString(node, "nodeId");
        var parentRaw = node.TryGetProperty("parentId", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
        var backendId = node.TryGetProperty("backendDOMNodeId", out var backendNode) && backendNode.TryGetInt64(out var backend) ? backend : 0;
        domMap.TryGetValue(backendId, out var dom);

        var role = BrowserAxValue(node, "role");
        var name = LimitSemanticText(BrowserAxValue(node, "name"), 512);
        var description = LimitSemanticText(BrowserAxValue(node, "description"), 512);
        var ignored = node.TryGetProperty("ignored", out var ignoredNode) && ignoredNode.ValueKind == JsonValueKind.True;
        var disabled = BrowserAxBool(node, "disabled");
        var focusable = BrowserAxBool(node, "focusable");
        var focused = BrowserAxBool(node, "focused");
        var hidden = BrowserAxBool(node, "hidden");
        var selected = BrowserAxNullableBool(node, "selected");
        var checkedState = BrowserAxText(node, "checked");
        var expanded = BrowserAxNullableBool(node, "expanded");
        var pressed = BrowserAxText(node, "pressed");
        var required = BrowserAxNullableBool(node, "required");
        var editable = BrowserAxText(node, "editable");
        var readOnly = BrowserAxNullableBool(node, "readonly");
        var password = string.Equals(dom?.InputType, "password", StringComparison.OrdinalIgnoreCase);

        object? viewportBounds = null;
        object? screenBoundsEstimate = null;
        object? bounds = null;
        object? center = null;
        var coordinateSpace = "none";
        var offscreen = hidden;
        if (dom is { HasBounds: true })
        {
            var vx = dom.X - viewport.PageX;
            var vy = dom.Y - viewport.PageY;
            viewportBounds = BrowserBox(vx, vy, dom.Width, dom.Height);
            offscreen = hidden || dom.Width <= 0 || dom.Height <= 0 ||
                vx + dom.Width <= 0 || vy + dom.Height <= 0 ||
                vx >= viewport.ClientWidth || vy >= viewport.ClientHeight;
            if (viewport.HasWindow)
            {
                var sideInset = Math.Max(0, (viewport.WindowWidth - viewport.ClientWidth) / 2d);
                var topInset = Math.Max(0, viewport.WindowHeight - viewport.ClientHeight - sideInset);
                var sx = viewport.WindowX + sideInset + vx;
                var sy = viewport.WindowY + topInset + vy;
                screenBoundsEstimate = BrowserBox(sx, sy, dom.Width, dom.Height);
                bounds = screenBoundsEstimate;
                center = new { x = RoundInt(sx + dom.Width / 2d), y = RoundInt(sy + dom.Height / 2d) };
                coordinateSpace = "screen-dip-estimate";
            }
            else
            {
                bounds = viewportBounds;
                center = new { x = RoundInt(vx + dom.Width / 2d), y = RoundInt(vy + dom.Height / 2d) };
                coordinateSpace = "css-viewport";
            }
        }

        var patterns = BrowserPatterns(role, focusable, editable, checkedState, selected, expanded);
        var states = new Dictionary<string, object?>
        {
            ["ignored"] = ignored,
            ["selected"] = selected,
            ["checked"] = checkedState,
            ["expanded"] = expanded,
            ["pressed"] = pressed,
            ["required"] = required,
            ["editable"] = editable,
            ["readOnly"] = readOnly
        };

        return new Dictionary<string, object?>
        {
            ["id"] = ids[rawId],
            ["parentId"] = parentRaw is not null && ids.TryGetValue(parentRaw, out var parentId) ? parentId : null,
            ["depth"] = depth,
            ["role"] = string.IsNullOrWhiteSpace(role) ? "unknown" : role,
            ["name"] = name,
            ["description"] = description,
            ["automationId"] = dom?.HtmlId,
            ["className"] = dom?.ClassName,
            ["frameworkId"] = "chromium-cdp",
            ["processId"] = null,
            ["hwnd"] = null,
            ["enabled"] = !disabled,
            ["offscreen"] = offscreen,
            ["focused"] = focused,
            ["keyboardFocusable"] = focusable,
            ["password"] = password,
            ["bounds"] = bounds,
            ["center"] = center,
            ["coordinateSpace"] = coordinateSpace,
            ["viewportBounds"] = viewportBounds,
            ["screenBoundsEstimate"] = screenBoundsEstimate,
            ["screenEstimate"] = viewport.HasWindow,
            ["patterns"] = patterns,
            ["states"] = states,
            ["runtimeId"] = rawId,
            ["backendDOMNodeId"] = backendId == 0 ? null : backendId,
            ["htmlTag"] = dom?.Tag,
            ["paintOrder"] = dom?.PaintOrder,
            ["targetId"] = session.TargetId
        };
    }

    private static Dictionary<long, BrowserDomInfo> BrowserDomMap(JsonElement result)
    {
        var map = new Dictionary<long, BrowserDomInfo>();
        if (!result.TryGetProperty("strings", out var strings) || strings.ValueKind != JsonValueKind.Array) return map;
        if (!result.TryGetProperty("documents", out var documents) || documents.ValueKind != JsonValueKind.Array || documents.GetArrayLength() < 1) return map;
        var document = documents[0];
        if (!document.TryGetProperty("nodes", out var nodes) || !document.TryGetProperty("layout", out var layout)) return map;
        if (!nodes.TryGetProperty("backendNodeId", out var backendIds) || backendIds.ValueKind != JsonValueKind.Array) return map;
        if (!layout.TryGetProperty("nodeIndex", out var nodeIndexes) || nodeIndexes.ValueKind != JsonValueKind.Array) return map;
        var bounds = layout.TryGetProperty("bounds", out var boundsNode) && boundsNode.ValueKind == JsonValueKind.Array ? boundsNode : default;
        var paint = layout.TryGetProperty("paintOrders", out var paintNode) && paintNode.ValueKind == JsonValueKind.Array ? paintNode : default;
        var nodeNames = nodes.TryGetProperty("nodeName", out var nodeNameNode) && nodeNameNode.ValueKind == JsonValueKind.Array ? nodeNameNode : default;
        var attributes = nodes.TryGetProperty("attributes", out var attrNode) && attrNode.ValueKind == JsonValueKind.Array ? attrNode : default;

        var count = nodeIndexes.GetArrayLength();
        for (var i = 0; i < count; i++)
        {
            if (!nodeIndexes[i].TryGetInt32(out var nodeIndex) || nodeIndex < 0 || nodeIndex >= backendIds.GetArrayLength()) continue;
            if (!backendIds[nodeIndex].TryGetInt64(out var backendId) || backendId == 0) continue;
            var attr = BrowserDomAttributes(strings, attributes, nodeIndex);
            var tag = "";
            if (nodeNames.ValueKind == JsonValueKind.Array && nodeIndex < nodeNames.GetArrayLength() && nodeNames[nodeIndex].TryGetInt32(out var nameIndex))
                tag = BrowserStringAt(strings, nameIndex);
            var hasBounds = bounds.ValueKind == JsonValueKind.Array && i < bounds.GetArrayLength() && bounds[i].ValueKind == JsonValueKind.Array && bounds[i].GetArrayLength() >= 4;
            double x = 0, y = 0, width = 0, height = 0;
            if (hasBounds)
            {
                x = BrowserNumber(bounds[i][0]);
                y = BrowserNumber(bounds[i][1]);
                width = BrowserNumber(bounds[i][2]);
                height = BrowserNumber(bounds[i][3]);
            }
            int? paintOrder = null;
            if (paint.ValueKind == JsonValueKind.Array && i < paint.GetArrayLength() && paint[i].TryGetInt32(out var po)) paintOrder = po;
            map[backendId] = new BrowserDomInfo
            {
                BackendNodeId = backendId,
                Tag = LimitSemanticText(tag, 64) ?? "",
                HtmlId = attr.TryGetValue("id", out var htmlId) ? LimitSemanticText(htmlId, 256) : null,
                ClassName = attr.TryGetValue("class", out var cls) ? LimitSemanticText(cls, 256) : null,
                InputType = attr.TryGetValue("type", out var inputType) ? LimitSemanticText(inputType, 64) : null,
                X = x,
                Y = y,
                Width = width,
                Height = height,
                PaintOrder = paintOrder,
                HasBounds = hasBounds
            };
        }
        return map;
    }

    private static Dictionary<string, string> BrowserDomAttributes(JsonElement strings, JsonElement attributes, int nodeIndex)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (attributes.ValueKind != JsonValueKind.Array || nodeIndex >= attributes.GetArrayLength()) return result;
        var row = attributes[nodeIndex];
        if (row.ValueKind != JsonValueKind.Array) return result;
        for (var i = 0; i + 1 < row.GetArrayLength(); i += 2)
        {
            if (!row[i].TryGetInt32(out var nameIndex) || !row[i + 1].TryGetInt32(out var valueIndex)) continue;
            result[BrowserStringAt(strings, nameIndex)] = BrowserStringAt(strings, valueIndex);
        }
        return result;
    }

    private static BrowserViewportInfo BrowserViewport(BrowserSemanticSession session)
    {
        double pageX = 0, pageY = 0, clientWidth = 0, clientHeight = 0, scale = 1;
        try
        {
            var metrics = BrowserCdpCommand(session, "Page.getLayoutMetrics");
            var visual = metrics.TryGetProperty("cssVisualViewport", out var css) ? css :
                metrics.TryGetProperty("visualViewport", out var legacy) ? legacy : default;
            if (visual.ValueKind == JsonValueKind.Object)
            {
                pageX = BrowserJsonNumber(visual, "pageX");
                pageY = BrowserJsonNumber(visual, "pageY");
                clientWidth = BrowserJsonNumber(visual, "clientWidth");
                clientHeight = BrowserJsonNumber(visual, "clientHeight");
                scale = BrowserJsonNumber(visual, "scale", 1);
            }
        }
        catch { }

        try
        {
            var window = BrowserCdpCommand(session, "Browser.getWindowForTarget", new { targetId = session.TargetId });
            if (window.TryGetProperty("bounds", out var bounds) && bounds.ValueKind == JsonValueKind.Object)
            {
                return new BrowserViewportInfo
                {
                    PageX = pageX,
                    PageY = pageY,
                    ClientWidth = clientWidth,
                    ClientHeight = clientHeight,
                    Scale = scale <= 0 ? 1 : scale,
                    HasWindow = true,
                    WindowX = BrowserJsonNumber(bounds, "left"),
                    WindowY = BrowserJsonNumber(bounds, "top"),
                    WindowWidth = BrowserJsonNumber(bounds, "width"),
                    WindowHeight = BrowserJsonNumber(bounds, "height")
                };
            }
        }
        catch { }

        return new BrowserViewportInfo
        {
            PageX = pageX,
            PageY = pageY,
            ClientWidth = clientWidth,
            ClientHeight = clientHeight,
            Scale = scale <= 0 ? 1 : scale
        };
    }

    private static int BrowserAxDepth(string id, Dictionary<string, string?> parents)
    {
        var depth = 0;
        var current = id;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        while (parents.TryGetValue(current, out var p) && !string.IsNullOrEmpty(p) && seen.Add(current) && depth < 64)
        {
            depth++;
            current = p;
        }
        return depth;
    }

    private static string BrowserSemanticId(string epoch, string targetId, string rawId)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{epoch}|{targetId}|{rawId}"));
        return "cdp_" + Convert.ToHexString(hash.AsSpan(0, 10)).ToLowerInvariant();
    }

    private static string BrowserAxValue(JsonElement node, string name)
    {
        if (!node.TryGetProperty(name, out var item) || item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("value", out var value)) return "";
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? "",
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Number => value.GetRawText(),
            _ => ""
        };
    }

    private static bool BrowserAxBool(JsonElement node, string name) => BrowserAxNullableBool(node, name) == true;

    private static bool? BrowserAxNullableBool(JsonElement node, string name)
    {
        if (!node.TryGetProperty("properties", out var props) || props.ValueKind != JsonValueKind.Array) return null;
        foreach (var prop in props.EnumerateArray())
        {
            if (!string.Equals(BrowserJsonString(prop, "name"), name, StringComparison.OrdinalIgnoreCase)) continue;
            if (!prop.TryGetProperty("value", out var wrapper) || wrapper.ValueKind != JsonValueKind.Object || !wrapper.TryGetProperty("value", out var value)) return null;
            if (value.ValueKind == JsonValueKind.True) return true;
            if (value.ValueKind == JsonValueKind.False) return false;
            if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed)) return parsed;
            return null;
        }
        return null;
    }

    private static string? BrowserAxText(JsonElement node, string name)
    {
        if (!node.TryGetProperty("properties", out var props) || props.ValueKind != JsonValueKind.Array) return null;
        foreach (var prop in props.EnumerateArray())
        {
            if (!string.Equals(BrowserJsonString(prop, "name"), name, StringComparison.OrdinalIgnoreCase)) continue;
            if (!prop.TryGetProperty("value", out var wrapper) || wrapper.ValueKind != JsonValueKind.Object || !wrapper.TryGetProperty("value", out var value)) return null;
            return value.ValueKind switch
            {
                JsonValueKind.String => LimitSemanticText(value.GetString(), 128),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                JsonValueKind.Number => value.GetRawText(),
                _ => null
            };
        }
        return null;
    }

    private static List<string> BrowserPatterns(string role, bool focusable, string? editable, string? checkedState, bool? selected, bool? expanded)
    {
        var result = new List<string>(6);
        if (focusable) result.Add("focus");
        if (role is "button" or "link" or "menuitem" or "tab") result.Add("invoke");
        if (!string.IsNullOrEmpty(editable) || role is "textbox" or "searchbox" or "combobox") result.Add("value");
        if (!string.IsNullOrEmpty(checkedState)) result.Add("toggle");
        if (selected is not null) result.Add("selectionItem");
        if (expanded is not null) result.Add("expandCollapse");
        return result;
    }

    private static string BrowserStringAt(JsonElement strings, int index)
    {
        if (index < 0 || index >= strings.GetArrayLength()) return "";
        return strings[index].ValueKind == JsonValueKind.String ? strings[index].GetString() ?? "" : "";
    }

    private static double BrowserJsonNumber(JsonElement node, string name, double fallback = 0)
    {
        return node.TryGetProperty(name, out var value) && value.TryGetDouble(out var number) ? number : fallback;
    }

    private static double BrowserNumber(JsonElement node) => node.TryGetDouble(out var value) ? value : 0;

    private static int RoundInt(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value)) return 0;
        return (int)Math.Clamp(Math.Round(value), int.MinValue, int.MaxValue);
    }

    private static object BrowserBox(double x, double y, double width, double height) => new
    {
        x = RoundInt(x),
        y = RoundInt(y),
        width = Math.Max(0, RoundInt(width)),
        height = Math.Max(0, RoundInt(height))
    };
}
