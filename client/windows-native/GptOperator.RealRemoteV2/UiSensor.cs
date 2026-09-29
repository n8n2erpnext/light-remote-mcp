using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

namespace GptOperator.RealRemoteV2;

internal sealed class UiSensor : IDisposable
{
    private const uint WINEVENT_OUTOFCONTEXT=0x0000;
    private const uint WINEVENT_SKIPOWNPROCESS=0x0002;
    private const uint EVENT_SYSTEM_FOREGROUND=0x0003;
    private const uint EVENT_OBJECT_SHOW=0x8002;
    private const uint EVENT_OBJECT_HIDE=0x8003;
    private const uint EVENT_OBJECT_FOCUS=0x8005;
    private const uint EVENT_OBJECT_NAMECHANGE=0x800C;
    private readonly WinEventDelegate _callback;
    private readonly List<nint> _hooks=new();

    public event Action<object>? Changed;

    public UiSensor()
    {
        _callback=OnWinEvent;
        Hook(EVENT_SYSTEM_FOREGROUND,EVENT_SYSTEM_FOREGROUND);
        Hook(EVENT_OBJECT_SHOW,EVENT_OBJECT_NAMECHANGE);
    }

    [DllImport("user32.dll")] private static extern nint SetWinEventHook(uint eventMin,uint eventMax,nint module,WinEventDelegate callback,uint process,uint thread,uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(nint hook);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetWindowText(nint hwnd,StringBuilder text,int count);
    private delegate void WinEventDelegate(nint hook,uint evt,nint hwnd,int objectId,int childId,uint thread,uint time);

    private void Hook(uint min,uint max)
    {
        var h=SetWinEventHook(min,max,0,_callback,0,0,WINEVENT_OUTOFCONTEXT|WINEVENT_SKIPOWNPROCESS);
        if(h!=0) _hooks.Add(h);
    }

    private void OnWinEvent(nint hook,uint evt,nint hwnd,int objectId,int childId,uint thread,uint time)
    {
        if(hwnd==0) return;
        var b=new StringBuilder(384);
        _=GetWindowText(hwnd,b,b.Capacity);
        Changed?.Invoke(new {
            kind=evt switch {
                EVENT_SYSTEM_FOREGROUND=>"foreground",
                EVENT_OBJECT_FOCUS=>"focus",
                EVENT_OBJECT_SHOW=>"show",
                EVENT_OBJECT_HIDE=>"hide",
                EVENT_OBJECT_NAMECHANGE=>"name",
                _=>"window"
            },
            hwnd=hwnd.ToInt64(),
            title=b.ToString(),
            objectId,
            childId,
            at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
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
                    bounds=new { x=r.X,y=r.Y,width=r.Width,height=r.Height }
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

    public void Dispose()
    {
        foreach(var h in _hooks) try { _=UnhookWinEvent(h); } catch {}
        _hooks.Clear();
    }
}
