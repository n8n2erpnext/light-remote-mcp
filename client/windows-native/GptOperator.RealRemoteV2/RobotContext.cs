using System.Drawing;
using System.Diagnostics;
using System.Text.Json;

namespace GptOperator.RealRemoteV2;

internal sealed class RobotContext : ApplicationContext
{
    private readonly HaloForm _halo=new();
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _haloTimer=new(){Interval=16};
    private readonly UiSensor _sensor=new();
    private readonly SemanticSessionManager _semantic;
    private readonly RobotRpcServer _rpc;
    private readonly Stopwatch _uptime=Stopwatch.StartNew();
    private bool _closing;

    public RobotContext(string pipeName)
    {
        _tray=new NotifyIcon{Visible=true,Text="Light Remote - Agent remote active",Icon=SystemIcons.Application};
        _tray.ShowBalloonTip(2500,"Light Remote","Agent remote session active",ToolTipIcon.Info);
        _haloTimer.Tick+=(_,_)=>_halo.FollowCursor();
        _halo.FollowCursor();
        _halo.Show();
        _haloTimer.Start();

        _rpc=new RobotRpcServer(pipeName,HandleAsync,OnPipeDisconnected);
        _semantic=new SemanticSessionManager(_sensor);
        _sensor.Changed+=value=>{
            if(!_semantic.HasSessions) _rpc.PublishEvent("ui.changed",value);
        };
        _semantic.Changed+=value=>_rpc.PublishEvent("semantic.changed",value);
        _=Task.Run(_rpc.RunAsync);
    }

    private Task<object?> HandleAsync(JsonElement request)
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
            "desktop.semantic.attach" or "desktop-semantic-attach" => _semantic.Attach(Int(request,"maxDepth",6),Int(request,"maxNodes",500)),
            "desktop.semantic.snapshot" or "desktop-semantic-snapshot" => _semantic.Snapshot(Text(request,"semanticSessionId")),
            "desktop.semantic.events" or "desktop-semantic-events" => _semantic.Events(Text(request,"semanticSessionId"),Long(request,"afterSeq",0),Int(request,"limit",100)),
            "desktop.semantic.detach" or "desktop-semantic-detach" => _semantic.Detach(Text(request,"semanticSessionId")),
            "batch.run" => RunBatch(request,32),
            "desktop.input" => DesktopInput(request),
            "session.close" => CloseSession(),
            _ => throw new InvalidOperationException("operation_not_supported")
        };
        return Task.FromResult<object?>(result);
    }

    private object Status() => new {
        runtime="real-remote-v2",
        pid=Environment.ProcessId,
        uptimeMs=_uptime.ElapsedMilliseconds,
        native=NativeInput.ReadStatus(),
        topology=DesktopVisual.ReadTopology()
    };

    private static object Move(JsonElement r)
    {
        NativeInput.Move(Int(r,"x"),Int(r,"y"));
        return new {applied=true,native=NativeInput.ReadStatus()};
    }

    private static object Click(JsonElement r)
    {
        NativeInput.Click(Text(r,"button","left"),Int(r,"count",1));
        return new {applied=true,native=NativeInput.ReadStatus()};
    }

    private static object Wheel(JsonElement r)
    {
        var delta=Int(r,"delta",0);
        var horizontal=Bool(r,"horizontal",false);
        NativeInput.Wheel(delta,horizontal);
        return new {applied=true,delta,horizontal,native=NativeInput.ReadStatus()};
    }

    private static object Drag(JsonElement r)
    {
        NativeInput.Drag(
            Int(r,"fromX"),Int(r,"fromY"),Int(r,"toX"),Int(r,"toY"),
            Text(r,"button","left"),Int(r,"durationMs",250),Int(r,"steps",12)
        );
        return new {applied=true,native=NativeInput.ReadStatus()};
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
        var semanticSessionId=Text(r,"semanticSessionId","");
        if(semanticSessionId.Length==0) return RunBatch(r,64);

        var afterSeq=Long(r,"afterSeq",0);
        var settleMs=Math.Clamp(Int(r,"settleMs",90),0,250);
        _semantic.ValidateInput(semanticSessionId,afterSeq);
        var mutation=RunBatch(r,64);
        return _semantic.AcknowledgeInput(semanticSessionId,afterSeq,settleMs,mutation);
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
            if(_halo.IsHandleCreated) _halo.BeginInvoke(new Action(ExitThread));
            else ExitThread();
        }
        catch { ExitThread(); }
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
        _haloTimer.Stop();
        _haloTimer.Dispose();
        _semantic.Dispose();
        _sensor.Dispose();
        _rpc.Dispose();
        _tray.Visible=false;
        _tray.Icon?.Dispose();
        _tray.Dispose();
        _halo.Close();
        _halo.Dispose();
        base.ExitThreadCore();
    }
}
