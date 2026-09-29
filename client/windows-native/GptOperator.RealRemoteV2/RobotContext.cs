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
        _sensor.Changed+=value=>_rpc.PublishEvent(value);
        _=Task.Run(_rpc.RunAsync);
    }

    private Task<object?> HandleAsync(JsonElement request)
    {
        var op=Text(request,"op");
        object? result=op switch {
            "ping" => new {pong=true,pid=Environment.ProcessId},
            "status" => Status(),
            "cursor.move" => Move(request),
            "cursor.click" => Click(request),
            "text.write" => WriteText(request),
            "text.delete" => DeleteText(request),
            "key.press" => PressKey(request),
            "uia.snapshot" => _sensor.Snapshot(Int(request,"maxDepth",4),Int(request,"maxNodes",250)),
            "batch.run" => RunBatch(request),
            "session.close" => CloseSession(),
            _ => throw new InvalidOperationException("operation_not_supported")
        };
        return Task.FromResult<object?>(result);
    }

    private object Status() => new {
        runtime="real-remote-v2",
        pid=Environment.ProcessId,
        uptimeMs=_uptime.ElapsedMilliseconds,
        native=NativeInput.ReadStatus()
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

    private object RunBatch(JsonElement r)
    {
        if(!r.TryGetProperty("actions",out var actions)||actions.ValueKind!=JsonValueKind.Array)
            throw new InvalidOperationException("actions_required");
        var count=actions.GetArrayLength();
        if(count<1||count>32) throw new InvalidOperationException("actions_count_invalid");
        var applied=0;
        foreach(var action in actions.EnumerateArray())
        {
            var guard=Text(action,"guardTitleContains","");
            if(guard.Length>0&&!NativeInput.ReadForeground().Title.Contains(guard,StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("guard_foreground_mismatch");
            var op=Text(action,"op");
            _=op switch {
                "cursor.move" => Move(action),
                "cursor.click" => Click(action),
                "text.write" => WriteText(action),
                "text.delete" => DeleteText(action),
                "key.press" => PressKey(action),
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

    private static string Text(JsonElement node,string name,string fallback="")
        => node.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.String?value.GetString()??fallback:fallback;

    protected override void ExitThreadCore()
    {
        _closing=true;
        _haloTimer.Stop();
        _haloTimer.Dispose();
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
