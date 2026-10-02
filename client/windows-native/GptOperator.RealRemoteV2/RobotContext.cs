using System.Drawing;
using System.Diagnostics;
using System.Text.Json;

namespace GptOperator.RealRemoteV2;

internal sealed class RobotContext : ApplicationContext
{
    private readonly AgentCursorForm _cursor=new();
    private readonly NotifyIcon _tray;
    private readonly UiSensor _sensor=new();
    private readonly SemanticSessionManager _semantic;
    private readonly VisualSessionManager _visual;
    private readonly BrowserSemanticProvider _browser;
    private readonly RobotRpcServer _rpc;
    private readonly Stopwatch _uptime=Stopwatch.StartNew();
    private bool _closing;

    private static Icon LoadAppIcon()
    {
        try
        {
            var path=Environment.ProcessPath ?? Application.ExecutablePath;
            using var icon=Icon.ExtractAssociatedIcon(path);
            return icon is null ? (Icon)SystemIcons.Application.Clone() : (Icon)icon.Clone();
        }
        catch { return (Icon)SystemIcons.Application.Clone(); }
    }

    public RobotContext(string pipeName)
    {
        _tray=new NotifyIcon{Visible=true,Text="Agent Remote Active",Icon=LoadAppIcon()};
        SystemCursorOverride.Acquire();

        _rpc=new RobotRpcServer(pipeName,HandleAsync,OnPipeDisconnected);
        _semantic=new SemanticSessionManager(_sensor);
        _visual=new VisualSessionManager();
        _browser=new BrowserSemanticProvider();
        _sensor.Changed+=value=>{
            if(!_semantic.HasSessions) _rpc.PublishEvent("ui.changed",value);
        };
        _semantic.Changed+=value=>_rpc.PublishEvent("semantic.changed",value);
        _browser.Changed+=value=>_rpc.PublishEvent("browser.semantic.changed",value);
        _=Task.Run(_rpc.RunAsync);
    }

    private async Task<object?> HandleAsync(JsonElement request)
    {
        var op=Text(request,"op");
        object? result=op switch {
            "ping" => new {pong=true,pid=Environment.ProcessId},
            "status" or "desktop.status" => Status(),
            "desktop.windows" => DesktopVisual.ListWindows(Int(request,"maxWindows",100)),
            "desktop.frame" => DesktopVisual.Capture(Int(request,"screen",0),Int(request,"maxWidth",960),Int(request,"maxHeight",540),Int(request,"quality",50)),
            "cursor.move" => Move(request),
            "cursor.click" => Click(request),
            "cursor.wheel" => Wheel(request),
            "cursor.drag" => Drag(request),
            "text.write" => WriteText(request),
            "text.delete" => DeleteText(request),
            "key.press" => PressKey(request),
            "key.hotkey" => Hotkey(request),
            "uia.snapshot" => _sensor.Snapshot(Int(request,"maxDepth",4),Int(request,"maxNodes",250)),
            "desktop.semantic.attach" or "desktop-semantic-attach" => _semantic.Attach(Text(request,"scope","foreground"),Int(request,"maxDepth",6),Int(request,"maxNodes",500)),
            "desktop.semantic.snapshot" or "desktop-semantic-snapshot" => _semantic.Snapshot(Text(request,"semanticSessionId")),
            "desktop.semantic.events" or "desktop-semantic-events" => _semantic.Events(Text(request,"semanticSessionId"),Long(request,"afterSeq",0),Int(request,"limit",100)),
            "desktop.semantic.detach" or "desktop-semantic-detach" => _semantic.Detach(Text(request,"semanticSessionId")),
            "desktop.browser.attach" or "desktop-browser-attach" => _browser.Attach(
                Text(request,"cdpEndpoint"), Text(request,"targetId"), Text(request,"urlMatch"),
                Int(request,"maxDepth",8), Int(request,"maxNodes",600)
            ),
            "desktop.browser.snapshot" or "desktop-browser-snapshot" => _browser.Snapshot(Text(request,"browserSessionId")),
            "desktop.browser.events" or "desktop-browser-events" => _browser.Events(
                Text(request,"browserSessionId"), Long(request,"afterSeq",0), Int(request,"limit",100)
            ),
            "desktop.browser.detach" or "desktop-browser-detach" => _browser.Detach(Text(request,"browserSessionId")),
            "desktop.visual.attach" or "desktop-visual-attach" => _visual.Attach(
                Int(request,"screen",0),
                Int(request,"maxWidth",960),
                Int(request,"maxHeight",540),
                Int(request,"quality",50),
                Int(request,"leaseMs",30_000),
                Text(request,"owner","")
            ),
            "desktop.visual.resume" or "desktop-visual-resume" => _visual.Resume(
                Text(request,"visualSessionId"),
                Text(request,"leaseToken"),
                Int(request,"leaseMs",0)
            ),
            "desktop.visual.keepalive" or "desktop-visual-keepalive" => _visual.KeepAlive(
                Text(request,"visualSessionId"),
                Text(request,"leaseToken"),
                Int(request,"leaseMs",0)
            ),
            "desktop.visual.frame" or "desktop-visual-frame" => _visual.Frame(
                Text(request,"visualSessionId"),
                Text(request,"leaseToken")
            ),
            "desktop.visual.detach" or "desktop-visual-detach" => _visual.Detach(
                Text(request,"visualSessionId"),
                Text(request,"leaseToken")
            ),
            "batch.run" => RunBatch(request,32),
            "desktop.run" => await RunPlanAsync(request),
            "desktop.input" => DesktopInput(request),
            "session.close" => CloseSession(),
            _ => throw new InvalidOperationException("operation_not_supported")
        };
        return result;
    }

    private object Status() => new {
        runtime="real-remote-v2",
        pid=Environment.ProcessId,
        uptimeMs=_uptime.ElapsedMilliseconds,
        native=NativeInput.ReadStatus(),
        topology=DesktopVisual.ReadTopology(),
        visualSessions=_visual.ActiveSessions,
        cursorVisual=_cursor.Status(),
        osCursorHidden=false,
        osCursorOverridden=SystemCursorOverride.IsActive,
        cursorRenderer="native-system"
    };

    private object Move(JsonElement r)
    {
        var durationMs=Int(r,"durationMs",90);
        var point=InputPoint(r,"x","y","screen");
        _cursor.MarkMove(durationMs);
        NativeInput.Move(point.X,point.Y,durationMs,Int(r,"steps",8));
        return new {applied=true,native=NativeInput.ReadStatus(),cursorVisual=_cursor.Status()};
    }

    private object Click(JsonElement r)
    {
        var button=Text(r,"button","left");
        var count=Int(r,"count",1);
        _cursor.MarkClick(button,count);
        NativeInput.Click(button,count);
        return new {applied=true,native=NativeInput.ReadStatus(),cursorVisual=_cursor.Status()};
    }

    private object Wheel(JsonElement r)
    {
        var delta=Int(r,"delta",0);
        var horizontal=Bool(r,"horizontal",false);
        _cursor.MarkScroll();
        NativeInput.Wheel(delta,horizontal);
        return new {applied=true,delta,horizontal,native=NativeInput.ReadStatus(),cursorVisual=_cursor.Status()};
    }

    private object Drag(JsonElement r)
    {
        var durationMs=Int(r,"durationMs",250);
        var sourceScreen=OptionalInt(r,"screen");
        var from=InputPoint(r,"fromX","fromY","screen");
        var to=InputPoint(r,"toX","toY","toScreen",sourceScreen);
        _cursor.MarkDrag(durationMs);
        NativeInput.Drag(
            from.X,from.Y,to.X,to.Y,
            Text(r,"button","left"),durationMs,Int(r,"steps",12)
        );
        return new {applied=true,native=NativeInput.ReadStatus(),cursorVisual=_cursor.Status()};
    }

    private static object WriteText(JsonElement r)
    {
        var text=Text(r,"text");
        NativeInput.WriteText(text,Int(r,"intervalMs",0));
        return new {applied=true,characters=text.Length,native=NativeInput.ReadStatus()};
    }

    private static object DeleteText(JsonElement r)
    {
        var count=Int(r,"count",1);
        NativeInput.DeleteText(count);
        return new {applied=true,count,native=NativeInput.ReadStatus()};
    }

    private static object PressKey(JsonElement r)
    {
        var key=Text(r,"key");
        NativeInput.PressKey(key);
        return new {applied=true,key,native=NativeInput.ReadStatus()};
    }

    private static object Hotkey(JsonElement r)
    {
        var key=Text(r,"key");
        var modifiers=Strings(r,"modifiers");
        NativeInput.Hotkey(modifiers,key);
        return new {applied=true,key,modifiers,native=NativeInput.ReadStatus()};
    }

    private object DesktopInput(JsonElement r)
    {
        ValidateDisplayTopology(r);        var visualSessionId=Text(r,"visualSessionId","");
        object? visualReceipt=null;
        if(visualSessionId.Length>0)
            visualReceipt=_visual.ValidateInput(visualSessionId,Text(r,"leaseToken"));

        var semanticSessionId=Text(r,"semanticSessionId","");
        if(semanticSessionId.Length==0)
        {
            var mutation=RunBatch(r,64);
            return visualReceipt is null?mutation:new {visual=visualReceipt,mutation};
        }

        var afterSeq=Long(r,"afterSeq",0);
        var settleMs=Math.Clamp(Int(r,"settleMs",90),0,250);
        _semantic.ValidateInput(semanticSessionId,afterSeq);
        var semanticMutation=RunBatch(r,64);
        var semanticAck=_semantic.AcknowledgeInput(semanticSessionId,afterSeq,settleMs,semanticMutation);
        return visualReceipt is null?semanticAck:new {visual=visualReceipt,semantic=semanticAck};
    }

    private object RunBatch(JsonElement r,int maxCount)
    {
        JsonElement actions;
        if(r.TryGetProperty("actions",out var a) && a.ValueKind==JsonValueKind.Array) actions=a;
        else if(r.TryGetProperty("events",out var e) && e.ValueKind==JsonValueKind.Array) actions=e;
        else throw new InvalidOperationException("actions_required");
        var count=actions.GetArrayLength();
        if(count<1||count>maxCount) throw new InvalidOperationException("actions_count_invalid");
        var applied=0;
        foreach(var action in actions.EnumerateArray())
        {
            var guard=Text(action,"guardTitleContains","");
            if(guard.Length>0&&!NativeInput.ReadForeground().Title.Contains(guard,StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("guard_foreground_mismatch");
            var op=Text(action,"op");
            _=op switch {
                "cursor.move" or "move" => Move(action),
                "cursor.click" or "click" => Click(action),
                "cursor.wheel" or "wheel" => Wheel(action),
                "cursor.drag" or "drag" => Drag(action),
                "text.write" or "text" => WriteText(action),
                "text.delete" or "delete" => DeleteText(action),
                "key.press" or "key" => PressKey(action),
                "key.hotkey" or "hotkey" => Hotkey(action),
                _ => throw new InvalidOperationException("batch_operation_not_supported")
            };
            applied++;
            var delay=Math.Clamp(Int(action,"delayMs",0),0,2000);
            if(delay>0) Thread.Sleep(delay);
        }
        return new {applied,native=NativeInput.ReadStatus()};
    }

    private async Task<object> RunPlanAsync(JsonElement r)
    {
        ValidateDisplayTopology(r);
        var semanticSessionId=Text(r,"semanticSessionId","");
        var afterSeq=Long(r,"afterSeq",0);
        var settleMs=Math.Clamp(Int(r,"settleMs",90),0,250);        if(semanticSessionId.Length>0) _semantic.ValidateInput(semanticSessionId,afterSeq);

        var mutation=RunBatch(r,64);
        object waitReceipt=new {matched=true,waited=false,elapsedMs=0L,foreground=NativeInput.ReadForeground(),focused=_sensor.FocusedSemantic()};
        if(r.TryGetProperty("await",out var waitNode) && waitNode.ValueKind==JsonValueKind.Object)
            waitReceipt=await AwaitUiAsync(waitNode);

        if(semanticSessionId.Length==0)
            return new {mutation,wait=waitReceipt};

        var semantic=_semantic.AcknowledgeInput(semanticSessionId,afterSeq,settleMs,mutation);
        return new {mutation,wait=waitReceipt,semantic};
    }

    private async Task<object> AwaitUiAsync(JsonElement node)
    {
        var foregroundTitleContains=Text(node,"foregroundTitleContains","");
        var foregroundTitleEquals=Text(node,"foregroundTitleEquals","");
        var focusedNameContains=Text(node,"focusedNameContains","");
        if(foregroundTitleContains.Length==0 && foregroundTitleEquals.Length==0 && focusedNameContains.Length==0)
            throw new InvalidOperationException("await_condition_required");

        var timeoutMs=Math.Clamp(Int(node,"timeoutMs",3000),50,15000);
        var started=Stopwatch.StartNew();
        bool Matches()
        {
            var fg=NativeInput.ReadForeground();
            var focused=_sensor.FocusedSemantic();
            if(foregroundTitleContains.Length>0 && !fg.Title.Contains(foregroundTitleContains,StringComparison.OrdinalIgnoreCase)) return false;
            if(foregroundTitleEquals.Length>0 && !String.Equals(fg.Title,foregroundTitleEquals,StringComparison.OrdinalIgnoreCase)) return false;
            if(focusedNameContains.Length>0 && !(focused?.Name??"").Contains(focusedNameContains,StringComparison.OrdinalIgnoreCase)) return false;
            return true;
        }

        object Receipt(bool matched)=>new {
            matched,
            waited=started.ElapsedMilliseconds>0,
            timedOut=!matched,
            elapsedMs=started.ElapsedMilliseconds,
            foreground=NativeInput.ReadForeground(),
            focused=_sensor.FocusedSemantic()
        };

        if(Matches()) return Receipt(true);

        var signal=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void OnChanged(UiChangeEvent _)
        {
            try { if(Matches()) signal.TrySetResult(true); } catch {}
        }

        _sensor.Changed+=OnChanged;
        try
        {
            if(Matches()) return Receipt(true);
            var completed=await Task.WhenAny(signal.Task,Task.Delay(timeoutMs));
            return Receipt(completed==signal.Task && signal.Task.IsCompletedSuccessfully && signal.Task.Result);
        }
        finally
        {
            _sensor.Changed-=OnChanged;
        }
    }
    private object CloseSession()
    {
        if(!_closing)
        {
            _closing=true;
            _=Task.Run(async()=>{await Task.Delay(40);TryExit();});
        }
        return new {closing=true};
    }

    private void OnPipeDisconnected()
    {
        if(_closing) return;
        _closing=true;
        TryExit();
    }

    private void TryExit()
    {
        try
        {
            if(_cursor.IsHandleCreated) _cursor.BeginInvoke(new Action(ExitThread));
            else ExitThread();
        }
        catch { ExitThread(); }
    }

    private static int? OptionalInt(JsonElement node,string name)
    {
        if(!node.TryGetProperty(name,out var value)) return null;
        if(!value.TryGetInt32(out var result)) throw new InvalidOperationException("screen_invalid");
        return result;
    }

    private static (int X,int Y) InputPoint(JsonElement node,string xName,string yName,string screenName,int? fallbackScreen=null)
    {
        var x=Int(node,xName);
        var y=Int(node,yName);
        var screen=OptionalInt(node,screenName)??fallbackScreen;
        return screen.HasValue?DesktopVisual.LocalToVirtualPoint(screen.Value,x,y):(x,y);
    }

    private static void ValidateDisplayTopology(JsonElement node)
    {
        var expected=Text(node,"displayTopologyId","").Trim();
        if(expected.Length==0) return;
        if(!String.Equals(expected,DesktopVisual.ReadTopologyId(),StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("display_topology_mismatch");
    }

    private static int Int(JsonElement node,string name,int fallback=0)
        => node.TryGetProperty(name,out var value)&&value.TryGetInt32(out var n)?n:fallback;

    private static long Long(JsonElement node,string name,long fallback=0)
        => node.TryGetProperty(name,out var value)&&value.TryGetInt64(out var n)?n:fallback;

    private static bool Bool(JsonElement node,string name,bool fallback=false)
        => node.TryGetProperty(name,out var value)&&value.ValueKind is JsonValueKind.True or JsonValueKind.False?value.GetBoolean():fallback;

    private static string stringText(JsonElement node,string fallback="")
        => node.ValueKind==JsonValueKind.String?node.GetString()??fallback:fallback;

    private static string[] Strings(JsonElement node,string name)
    {
        if(!node.TryGetProperty(name,out var value)||value.ValueKind!=JsonValueKind.Array) return Array.Empty<string>();
        return value.EnumerateArray().Select(v=>stringText(v)).Where(s=>s.Length>0).Take(4).ToArray();
    }

    private static string Text(JsonElement node,string name,string fallback="")
        => node.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.String?value.GetString()??fallback:fallback;

    protected override void ExitThreadCore()
    {
        _closing=true;
        _visual.Dispose();
        _browser.Dispose();
        _semantic.Dispose();
        _sensor.Dispose();
        _rpc.Dispose();
        _tray.Visible=false;
        _tray.Icon?.Dispose();
        _tray.Dispose();
        _cursor.Close();
        _cursor.Dispose();
        SystemCursorOverride.Release();
        base.ExitThreadCore();
    }
}
