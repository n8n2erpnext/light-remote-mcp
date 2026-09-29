using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

namespace GptOperator.RealRemoteV2;

internal sealed record UiChangeEvent(
    string Kind,
    long Hwnd,
    string Title,
    int ObjectId,
    int ChildId,
    long At
);

internal sealed record UiPoint(double X,double Y);
internal sealed record UiRect(double X,double Y,double Width,double Height);

internal sealed record SemanticNodeData(
    int Index,
    int Parent,
    int Depth,
    string Role,
    string Name,
    string AutomationId,
    string ClassName,
    string FrameworkId,
    int ProcessId,
    int NativeWindowHandle,
    bool Enabled,
    bool Offscreen,
    bool Focused,
    bool Password,
    UiRect Bounds,
    UiPoint Center,
    string[] Patterns
);

internal sealed record SemanticSnapshotData(
    long RootHwnd,
    string RootTitle,
    SemanticNodeData[] Nodes,
    bool Truncated,
    long CapturedAt
);

internal sealed class UiSensor : IDisposable
{
    private const uint WINEVENT_OUTOFCONTEXT=0x0000;
    private const uint WINEVENT_SKIPOWNPROCESS=0x0002;
    private const uint EVENT_SYSTEM_FOREGROUND=0x0003;
    private const uint EVENT_OBJECT_SHOW=0x8002;
    private const uint EVENT_OBJECT_HIDE=0x8003;
    private const uint EVENT_OBJECT_FOCUS=0x8005;
    private const uint EVENT_OBJECT_NAMECHANGE=0x800C;
    private const uint GA_ROOT=2;

    private readonly WinEventDelegate _callback;
    private readonly List<nint> _hooks=new();

    public event Action<UiChangeEvent>? Changed;

    public UiSensor()
    {
        _callback=OnWinEvent;
        Hook(EVENT_SYSTEM_FOREGROUND,EVENT_SYSTEM_FOREGROUND);
        Hook(EVENT_OBJECT_SHOW,EVENT_OBJECT_NAMECHANGE);
    }

    [DllImport("user32.dll")] private static extern nint SetWinEventHook(uint eventMin,uint eventMax,nint module,WinEventDelegate callback,uint process,uint thread,uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(nint hook);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetWindowText(nint hwnd,StringBuilder text,int count);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint hwnd,uint flags);
    private delegate void WinEventDelegate(nint hook,uint evt,nint hwnd,int objectId,int childId,uint thread,uint time);

    private void Hook(uint min,uint max)
    {
        var h=SetWinEventHook(min,max,0,_callback,0,0,WINEVENT_OUTOFCONTEXT|WINEVENT_SKIPOWNPROCESS);
        if(h!=0) _hooks.Add(h);
    }

    private void OnWinEvent(nint hook,uint evt,nint hwnd,int objectId,int childId,uint thread,uint time)
    {
        if(hwnd==0) return;
        Changed?.Invoke(new UiChangeEvent(
            evt switch {
                EVENT_SYSTEM_FOREGROUND=>"foreground",
                EVENT_OBJECT_FOCUS=>"focus",
                EVENT_OBJECT_SHOW=>"show",
                EVENT_OBJECT_HIDE=>"hide",
                EVENT_OBJECT_NAMECHANGE=>"name",
                _=>"window"
            },
            hwnd.ToInt64(),
            ReadWindowTitle(hwnd),
            objectId,
            childId,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        ));
    }

    public bool IsWithinRoot(long hwnd,long rootHwnd)
    {
        if(hwnd==0||rootHwnd==0) return false;
        if(hwnd==rootHwnd) return true;
        try
        {
            var root=GetAncestor(new nint(hwnd),GA_ROOT);
            return root!=0 && root.ToInt64()==rootHwnd;
        }
        catch
        {
            return false;
        }
    }

    public object Snapshot(int maxDepth=4,int maxNodes=250)
    {
        maxDepth=Math.Clamp(maxDepth,0,8);
        maxNodes=Math.Clamp(maxNodes,1,600);
        var fg=NativeInput.ReadForeground();
        if(fg.Hwnd==0) return new { foreground=fg, nodes=Array.Empty<object>() };
        AutomationElement root;
        try { root=AutomationElement.FromHandle(new nint(fg.Hwnd)); }
        catch { return new { foreground=fg, nodes=Array.Empty<object>() }; }

        var nodes=new List<object>(Math.Min(maxNodes,256));
        var q=new Queue<(AutomationElement El,int Parent,int Depth)>();
        q.Enqueue((root,-1,0));
        var walker=TreeWalker.ControlViewWalker;
        while(q.Count>0 && nodes.Count<maxNodes)
        {
            var item=q.Dequeue();
            var index=nodes.Count;
            try
            {
                var c=item.El.Current;
                var r=c.BoundingRectangle;
                var bounds=SafeRect(r.X,r.Y,r.Width,r.Height);
                nodes.Add(new {
                    index,
                    parent=item.Parent,
                    depth=item.Depth,
                    name=c.Name??"",
                    automationId=c.AutomationId??"",
                    className=c.ClassName??"",
                    controlType=c.ControlType?.ProgrammaticName??"",
                    enabled=c.IsEnabled,
                    offscreen=c.IsOffscreen,
                    focused=c.HasKeyboardFocus,
                    bounds=new { x=bounds.X,y=bounds.Y,width=bounds.Width,height=bounds.Height }
                });
            }
            catch { continue; }

            if(item.Depth>=maxDepth) continue;
            AutomationElement? child=null;
            try { child=walker.GetFirstChild(item.El); } catch {}
            while(child is not null && q.Count+nodes.Count<maxNodes)
            {
                q.Enqueue((child,index,item.Depth+1));
                try { child=walker.GetNextSibling(child); } catch { child=null; }
            }
        }
        return new { foreground=fg, nodes, truncated=q.Count>0, capturedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
    }

    public SemanticSnapshotData SemanticSnapshot(long rootHwnd,int maxDepth=6,int maxNodes=500)
    {
        maxDepth=Math.Clamp(maxDepth,0,12);
        maxNodes=Math.Clamp(maxNodes,1,1500);
        if(rootHwnd==0) throw new InvalidOperationException("semantic_root_missing");

        AutomationElement root;
        try { root=AutomationElement.FromHandle(new nint(rootHwnd)); }
        catch { throw new InvalidOperationException("semantic_root_unavailable"); }

        var nodes=new List<SemanticNodeData>(Math.Min(maxNodes,512));
        var q=new Queue<(AutomationElement El,int Parent,int Depth)>();
        q.Enqueue((root,-1,0));
        var walker=TreeWalker.ControlViewWalker;

        while(q.Count>0 && nodes.Count<maxNodes)
        {
            var item=q.Dequeue();
            var index=nodes.Count;
            SemanticNodeData? node;
            try { node=ReadSemanticNode(item.El,index,item.Parent,item.Depth); }
            catch { node=null; }
            if(node is null) continue;
            nodes.Add(node);

            if(item.Depth>=maxDepth) continue;
            AutomationElement? child=null;
            try { child=walker.GetFirstChild(item.El); } catch {}
            while(child is not null && q.Count+nodes.Count<maxNodes)
            {
                q.Enqueue((child,index,item.Depth+1));
                try { child=walker.GetNextSibling(child); } catch { child=null; }
            }
        }

        return new SemanticSnapshotData(
            rootHwnd,
            ReadWindowTitle(new nint(rootHwnd)),
            nodes.ToArray(),
            q.Count>0,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        );
    }

    public SemanticNodeData? FocusedSemantic()
    {
        try
        {
            var focused=AutomationElement.FocusedElement;
            return focused is null?null:ReadSemanticNode(focused,-1,-1,0);
        }
        catch
        {
            return null;
        }
    }

    private static SemanticNodeData ReadSemanticNode(AutomationElement el,int index,int parent,int depth)
    {
        var c=el.Current;
        var r=c.BoundingRectangle;
        var bounds=SafeRect(r.X,r.Y,r.Width,r.Height);
        string[] patterns;
        try
        {
            patterns=el.GetSupportedPatterns()
                .Select(p=>p.ProgrammaticName??"")
                .Where(x=>x.Length>0)
                .Take(32)
                .ToArray();
        }
        catch
        {
            patterns=Array.Empty<string>();
        }

        var role=(c.ControlType?.ProgrammaticName??"").Replace("ControlType.","",StringComparison.Ordinal);
        return new SemanticNodeData(
            index,
            parent,
            depth,
            role,
            c.Name??"",
            c.AutomationId??"",
            c.ClassName??"",
            c.FrameworkId??"",
            c.ProcessId,
            c.NativeWindowHandle,
            c.IsEnabled,
            c.IsOffscreen,
            c.HasKeyboardFocus,
            c.IsPassword,
            bounds,
            SafeCenter(bounds),
            patterns
        );
    }

    private static UiRect SafeRect(double x,double y,double width,double height)
    {
        if(!double.IsFinite(x)||!double.IsFinite(y)||!double.IsFinite(width)||!double.IsFinite(height))
            return new UiRect(0d,0d,0d,0d);
        return new UiRect(x,y,Math.Max(0d,width),Math.Max(0d,height));
    }

    private static UiPoint SafeCenter(UiRect bounds)
    {
        var x=bounds.X+bounds.Width/2d;
        var y=bounds.Y+bounds.Height/2d;
        return new UiPoint(double.IsFinite(x)?x:0d,double.IsFinite(y)?y:0d);
    }

    internal static bool RectSanitizationSelfTest()
    {
        var empty=SafeRect(double.PositiveInfinity,double.PositiveInfinity,double.NegativeInfinity,double.NegativeInfinity);
        var normal=SafeRect(10d,20d,100d,40d);
        var center=SafeCenter(normal);
        return empty==new UiRect(0d,0d,0d,0d)
            && normal==new UiRect(10d,20d,100d,40d)
            && center==new UiPoint(60d,40d);
    }

    private static string ReadWindowTitle(nint hwnd)
    {
        if(hwnd==0) return "";
        var b=new StringBuilder(384);
        try { _=GetWindowText(hwnd,b,b.Capacity); } catch {}
        return b.ToString();
    }

    public void Dispose()
    {
        foreach(var h in _hooks) try { _=UnhookWinEvent(h); } catch {}
        _hooks.Clear();
    }
}
