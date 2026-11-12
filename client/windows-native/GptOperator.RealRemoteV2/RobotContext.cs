using System.Drawing;
using System.Diagnostics;
using System.Text.Json;

namespace GptOperator.RealRemoteV2;

internal sealed class RobotContext : ApplicationContext
{
    private readonly AgentCursorVisualState _cursorState=new();
    private readonly NotifyIcon _tray;
    private readonly CursorGlowOverlay? _ambientGlow;
    private readonly UiSensor _sensor=new();
    private readonly SemanticSessionManager _semantic;
    private readonly VisualSessionManager _visual;
    private readonly BrowserSemanticProvider _browser;
    private readonly RobotRpcServer _rpc;
    private readonly Stopwatch _uptime=Stopwatch.StartNew();
    private readonly object _cursorLeaseGate=new();
    private readonly ControlActivity _activity=new();
    private readonly System.Threading.Timer _passivePreviewTimer;
    private volatile bool _passivePreviewActive;
    private long _passivePreviewExpiresUtcMs;
    private long _passivePreviewDeadline;
    private bool _closing;
    private readonly System.Windows.Threading.Dispatcher _uiDispatcher=System.Windows.Threading.Dispatcher.CurrentDispatcher;

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
        _passivePreviewTimer=new System.Threading.Timer(_=>ExpirePassivePreview(),null,Timeout.Infinite,Timeout.Infinite);
        // Default-on indicator; legacy opt-out now controls only the overlay.
        if(Environment.GetEnvironmentVariable("LIGHT_REMOTE_RM_ANIMATED_GLOW")!="0")
        {
            try { _ambientGlow=new CursorGlowOverlay(_activity); _=_ambientGlow.Handle; }
            catch { _ambientGlow?.Dispose(); _ambientGlow=null; }
        }
        _activity.Changed+=UpdateGlowVisibility;
        NativeInput.Activity=_activity;

        _rpc=new RobotRpcServer(pipeName,HandleAsync,OnPipeDisconnected);
        _semantic=new SemanticSessionManager(_sensor);
        _visual=new VisualSessionManager();
        _activity.HasWorkingSession=()=>_activity.VisualSessionId.Length>0&&_visual.IsActive(_activity.VisualSessionId);
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
        var controlling=op is "cursor.move" or "cursor.click" or "cursor.wheel" or "cursor.drag"
            or "text.write" or "text.type" or "text.delete" or "key.press" or "key.hotkey"
            or "batch.run" or "desktop.run" or "desktop.input" or "desktop.semantic.act" or "desktop-semantic-act";
        var inputVisualId=Text(request,"visualSessionId");
        try {
        if(controlling) {
            // Public Agent input always supplies its owner-checked native lease.
            // Legacy same-user private CLI RPC remains separate, without new authority.
            if(inputVisualId.Length>0)_visual.ValidateInput(inputVisualId,Text(request,"leaseToken"));
            _activity.VisualSessionId=inputVisualId;
            _activity.Begin();
            if(_ambientGlow is not null)_ambientGlow.Dispatcher.Invoke(()=>_ambientGlow.Show(),System.Windows.Threading.DispatcherPriority.Render);
        }
        object? result=op switch {
            "ping" => new {pong=true,pid=Environment.ProcessId},
            "status" or "desktop.status" => Status(),
            "cursor.restore" => RestoreCursors(),
            "cursor.preview.start" => StartPassivePreview(request),
            "cursor.preview.stop" => StopPassivePreview(),
            "desktop.windows" => DesktopVisual.ListWindows(Int(request,"maxWindows",100)),
            "desktop.frame" => DesktopVisual.Capture(Int(request,"screen",0),Int(request,"maxWidth",960),Int(request,"maxHeight",540),Int(request,"quality",50)),
            "cursor.move" => Move(request),
            "cursor.click" => Click(request),
            "cursor.wheel" => Wheel(request),
            "cursor.drag" => Drag(request),
            "text.write" => WriteText(request),
            "text.type" => WriteText(request,true),
            "text.delete" => DeleteText(request),
            "key.press" => PressKey(request),
            "key.hotkey" => Hotkey(request),
            "uia.snapshot" => _sensor.Snapshot(Int(request,"maxDepth",4),Int(request,"maxNodes",250)),
            "desktop.semantic.attach" or "desktop-semantic-attach" => _semantic.Attach(Text(request,"scope","foreground"),Int(request,"maxDepth",6),Int(request,"maxNodes",500)),
            "desktop.semantic.snapshot" or "desktop-semantic-snapshot" => _semantic.Snapshot(Text(request,"semanticSessionId")),
            "desktop.semantic.events" or "desktop-semantic-events" => _semantic.Events(Text(request,"semanticSessionId"),Long(request,"afterSeq",0),Int(request,"limit",100)),
            "desktop.semantic.detach" or "desktop-semantic-detach" => _semantic.Detach(Text(request,"semanticSessionId")),
            "desktop.semantic.act" or "desktop-semantic-act" => SemanticAct(request),
            "desktop.browser.attach" or "desktop-browser-attach" => _browser.Attach(
                Text(request,"cdpEndpoint"), Text(request,"targetId"), Text(request,"urlMatch"),
                Int(request,"maxDepth",8), Int(request,"maxNodes",600)
            ),
            "desktop.browser.snapshot" or "desktop-browser-snapshot" => _browser.Snapshot(Text(request,"browserSessionId")),
            "desktop.browser.events" or "desktop-browser-events" => _browser.Events(
                Text(request,"browserSessionId"), Long(request,"afterSeq",0), Int(request,"limit",100)
            ),
            "desktop.browser.detach" or "desktop-browser-detach" => _browser.Detach(Text(request,"browserSessionId")),
            "desktop.visual.attach" or "desktop-visual-attach" => AttachVisualWithCursor(request),
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
            "desktop.visual.detach" or "desktop-visual-detach" => DetachVisualWithCursor(request),
            "batch.run" => RunBatch(request,32),
            "desktop.run" => await RunPlanAsync(request),
            "desktop.input" => DesktopInput(request),
            "desktop.cancel" => CancelInput(request),
            "session.close" => CloseSession(),
            _ => throw new InvalidOperationException("operation_not_supported")
        };
        return result;
        } catch(OperationCanceledException error) when(error.Message=="remote_input_cancelled") {
            return new {applied=false,state="cancelled",reason="agent_cancelled",sessionRetained=true,
                automaticReplay=false,contentVerification="unverified",verifiedInsertedUnits=(int?)null};
        } catch(OwnerInputPause pause) {
            // Yield this input operation, not the Agent session or background jobs.
            // No automatic replay/refocus: events already sent are not verified text.
            UpdateGlowVisibility();
            return new {applied=false,state="paused",reason="owner_input",sessionRetained=true,
                resumeRequiresObservation=true,automaticReplay=false,contentVerification="unverified",
                requestedUnits=pause.RequestedUnits,sentUnits=pause.SentUnits,verifiedInsertedUnits=(int?)null};
        } finally { if(controlling) {
            NativeInput.ReleaseOwnedInputs();
            if(inputVisualId.Length>0)try{_visual.KeepAlive(inputVisualId,Text(request,"leaseToken"));}catch{_activity.Stop();}
            _activity.End();
        } }
    }

    private object CancelInput(JsonElement request)
    {
        var id=Text(request,"visualSessionId");
        if(id.Length==0)throw new InvalidOperationException("visual_session_required_for_cancel");
        _visual.ValidateInput(id,Text(request,"leaseToken"));
        _rpc.CancelScope(id);
        var running=_activity.CancelScope(id);
        return new {cancelRequested=true,activeInputCancelled=running,queuedInputsFenced=true,
            visualSessionId=id,sessionRetained=true,automaticReplay=false};
    }

    private object RestoreCursors()
    {
        _activity.Stop(); StopPassivePreview();
        var restored=SystemCursorOverride.ForceRestore();
        return new {restored,osCursorOverridden=false,error=restored?0:System.Runtime.InteropServices.Marshal.GetLastWin32Error()};
    }

    private void UpdateGlowVisibility()
    {
        var glow=_ambientGlow;
        if(glow is null||glow.IsDisposed)return;
        glow.BeginInvoke(()=>{
            if(glow.IsDisposed)return;
            glow.SetPreview(_passivePreviewActive?_passivePreviewDeadline:0);
            if(_activity.IndicatorVisible||_passivePreviewActive)glow.Show(); else glow.Hide();
        });
    }

    private object AttachVisualWithCursor(JsonElement request)=>_visual.Attach(
        Int(request,"screen",0),Int(request,"maxWidth",960),Int(request,"maxHeight",540),
        Int(request,"quality",50),Int(request,"leaseMs",30_000),Text(request,"owner",""));

    private object DetachVisualWithCursor(JsonElement request)
    {
        var id=Text(request,"visualSessionId");
        object result;
        try { result=_visual.Detach(id,Text(request,"leaseToken")); }
        catch(InvalidOperationException error) when(error.Message is "visual_session_missing" or "visual_lease_expired")
        { result=new {detached=true,alreadyClosed=true}; }
        _rpc.ForgetScope(id);
        var endedCurrent=_activity.VisualSessionId==id||_visual.ActiveSessions==0;
        if(endedCurrent) {
            _activity.Stop();_activity.VisualSessionId="";
            if(_ambientGlow is not null)_ambientGlow.Dispatcher.Invoke(()=>_ambientGlow.Hide());
        }
        var receipt=System.Text.Json.JsonSerializer.SerializeToNode(result)!.AsObject();
        receipt["scopeClosed"]=true;receipt["controlEndedForSession"]=endedCurrent;
        receipt["indicatorStopped"]=endedCurrent&&_ambientGlow is not {Visible:true};
        receipt["newAttachRequired"]=true;
        return receipt;
    }

    private object StartPassivePreview(JsonElement request)
    {
        if(_ambientGlow is null || _ambientGlow.IsDisposed)
            throw new InvalidOperationException("passive_preview_glow_unavailable");
        var seconds=Math.Clamp(Int(request,"durationSeconds",20),5,30);
        lock(_cursorLeaseGate)
        {
            if(_closing)throw new InvalidOperationException("robot_closing");
            if(_activity.Active)
                throw new InvalidOperationException("passive_preview_requires_idle");
            _passivePreviewExpiresUtcMs=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+seconds*1000L;
            _passivePreviewDeadline=Environment.TickCount64+seconds*1000L;
            _passivePreviewActive=true;
            _passivePreviewTimer.Change(seconds*1000,Timeout.Infinite);
            UpdateGlowVisibility();
        }
        return new {
            active=true,passive=true,durationSeconds=seconds,
            mouseInjection=false,systemCursorReplacement=false,
            ownerMouseControl=true
        };
    }

    private object StopPassivePreview()
    {
        lock(_cursorLeaseGate)
        {
            _passivePreviewActive=false;
            _passivePreviewExpiresUtcMs=0;
            _passivePreviewTimer.Change(Timeout.Infinite,Timeout.Infinite);
            UpdateGlowVisibility();
        }
        return new {active=false,passive=true,mouseInjection=false};
    }

    private void ExpirePassivePreview()
    {
        lock(_cursorLeaseGate) {
            if(_closing||!_passivePreviewActive)return;
            var remaining=_passivePreviewDeadline-Environment.TickCount64;
            // A queued callback from an older preview must not expire its renewal.
            if(remaining>0) { _passivePreviewTimer.Change((int)remaining,Timeout.Infinite); return; }
            StopPassivePreview();
        }
    }
    private void HoldCursorForPhysicalInput(bool keyboard=false) { _activity.Check(); _activity.TargetScreen=keyboard?Screen.FromHandle((nint)NativeInput.ReadForeground().Hwnd).Bounds:Screen.FromPoint(Cursor.Position).Bounds; _activity.Touch(); }

    private object Status() => new {
        runtime="real-remote-v2",
        pid=Environment.ProcessId,
        uptimeMs=_uptime.ElapsedMilliseconds,
        native=NativeInput.ReadStatus(),
        topology=DesktopVisual.ReadTopology(),
        visualSessions=_visual.ActiveSessions,
        cursorVisual=_cursorState.Status(),
        osCursorHidden=false,
        osCursorOverridden=SystemCursorOverride.IsActive,
        cursorRenderer=_ambientGlow is {IsDisposed:false}?"native-system+ai-badge-border":"native-system",
        controlState=_activity.State=="idle"&&_visual.ActiveSessions>0?"observing":_activity.State,
        localInputMonitorAvailable=_activity.Available,
        ownerInputBehavior="yield-current-input-keep-agent-session",
        indicator=_ambientGlow is null?null:_ambientGlow.Dispatcher.Invoke(()=>_ambientGlow.Diagnostics()),
        inputContentVerification="unverified-unless-explicit-readback",
        requestLanes=new {orderedInput=true,independentCapture=true,fastStatusCancel=true,inputQueue=16,captureQueue=2,fastConcurrency=4},
        interactionProfiles=new {defaultProfile="compatibility",supported=new[]{"compatibility","precision","responsive","smooth"},responsiveClickProgrammedMs=17,compatibilityClickProgrammedMs=75,automaticRetry=false},
        ambientGlowActive=_ambientGlow is {IsDisposed:false,Visible:true},
        passivePreviewActive=_passivePreviewActive,
        visualAttachCursorActive=false,
        passivePreviewRemainingMs=_passivePreviewActive
            ?Math.Max(0,System.Threading.Volatile.Read(ref _passivePreviewExpiresUtcMs)
              -DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) : 0,
        ambientGlowPaintCount=_ambientGlow?.PaintCount ?? 0,
        ambientGlowBounds=_ambientGlow?.Bounds
    };

    private object Move(JsonElement r)
    {
        var profile=InteractionProfile.Read(Text(r,"profile","compatibility"));
        var durationMs=Int(r,"durationMs",profile.MoveMs);
        var point=InputPoint(r,"x","y","screen");
        HoldCursorForPhysicalInput();
        _activity.TargetScreen=Screen.FromPoint(new Point(point.X,point.Y)).Bounds;
        _cursorState.MarkMove(durationMs);
        NativeInput.Move(point.X,point.Y,durationMs,Int(r,"steps",profile.MoveSteps));
        return new {applied=true,inputProfile=profile.Name,native=NativeInput.ReadStatus(),cursorVisual=_cursorState.Status()};
    }

    private object Click(JsonElement r)
    {
        var button=Text(r,"button","left");
        var count=Int(r,"count",1);
        HoldCursorForPhysicalInput();
        _cursorState.MarkClick(button,count);
        var profile=InteractionProfile.Read(Text(r,"profile","compatibility"));
        NativeInput.Click(button,count,profile);
        return new {applied=true,inputProfile=profile.Name,native=NativeInput.ReadStatus(),cursorVisual=_cursorState.Status()};
    }

    private object Wheel(JsonElement r)
    {
        var delta=Int(r,"delta",0);
        var horizontal=Bool(r,"horizontal",false);
        HoldCursorForPhysicalInput();
        _cursorState.MarkScroll();
        NativeInput.Wheel(delta,horizontal);
        return new {applied=true,delta,horizontal,native=NativeInput.ReadStatus(),cursorVisual=_cursorState.Status()};
    }

    private object Drag(JsonElement r)
    {
        var durationMs=Int(r,"durationMs",250);
        var sourceScreen=OptionalInt(r,"screen");
        var from=InputPoint(r,"fromX","fromY","screen");
        var to=InputPoint(r,"toX","toY","toScreen",sourceScreen);
        HoldCursorForPhysicalInput();
        _activity.TargetScreen=Screen.FromPoint(new Point(to.X,to.Y)).Bounds;
        _cursorState.MarkDrag(durationMs);
        NativeInput.Drag(
            from.X,from.Y,to.X,to.Y,
            Text(r,"button","left"),durationMs,Int(r,"steps",12)
        );
        return new {applied=true,native=NativeInput.ReadStatus(),cursorVisual=_cursorState.Status()};
    }

    private object WriteText(JsonElement r,bool visibleTyping=false)
    {
        var text=Text(r,"text");
        // SendInput issues real Unicode key-down/key-up pairs per character.
        // An unpaced burst was visually indistinguishable from paste.
        // Short text gets visible fast typing; longer input is bounded
        // so an agent operation remains responsive rather than timing out.
        var requested=Int(r,"intervalMs",visibleTyping?25:14);
        var intervalMs=Math.Clamp(requested,0,55);
        if(text.Length>512)intervalMs=Math.Min(intervalMs,4);
        else if(text.Length>180)intervalMs=Math.Min(intervalMs,8);
        HoldCursorForPhysicalInput(true);
        NativeInput.WriteText(text,intervalMs);
        return new {
            applied=true,characters=text.Length,requestedUnits=text.Length,intervalMs,
            contentVerification="unverified",verifiedInsertedUnits=(int?)null,
            textMethod="win32-unicode-key-events-per-character",
            keyStrokes=text.Length,native=NativeInput.ReadStatus()
        };
    }

    private object DeleteText(JsonElement r)
    {
        var count=Int(r,"count",1);
        HoldCursorForPhysicalInput(true);
        NativeInput.DeleteText(count);
        return new {applied=true,count,native=NativeInput.ReadStatus()};
    }

    private object PressKey(JsonElement r)
    {
        var key=Text(r,"key");
        HoldCursorForPhysicalInput(true);
        NativeInput.PressKey(key);
        return new {applied=true,key,native=NativeInput.ReadStatus()};
    }

    private object Hotkey(JsonElement r)
    {
        var key=Text(r,"key");
        var modifiers=Strings(r,"modifiers");
        HoldCursorForPhysicalInput(true);
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
            return AddVisualReceipt(mutation,visualReceipt);
        }

        var afterSeq=Long(r,"afterSeq",0);
        var settleMs=Math.Clamp(Int(r,"settleMs",90),0,250);
        _semantic.ValidateInput(semanticSessionId,afterSeq);
        var semanticMutation=RunBatch(r,64);
        var semanticAck=_semantic.AcknowledgeInput(semanticSessionId,afterSeq,settleMs,semanticMutation);
        return AddVisualReceipt(semanticAck,visualReceipt);
    }

    private static object AddVisualReceipt(object mutation,object? visual)
    {
        if(visual is null)return mutation;
        // Scope metadata is additive: retain the existing input receipt shape.
        var receipt=System.Text.Json.JsonSerializer.SerializeToNode(mutation)!.AsObject();
        receipt["visual"]=System.Text.Json.JsonSerializer.SerializeToNode(visual);
        return receipt;
    }

    private object SemanticAct(JsonElement r)
    {
        var semanticSessionId=Text(r,"semanticSessionId","");
        if(semanticSessionId.StartsWith("bsem_",StringComparison.Ordinal))
            throw new InvalidOperationException("semantic_action_provider_observation_only");
        var nodeId=Text(r,"nodeId","");
        var action=Text(r,"action","");
        var value=Text(r,"value","");
        var afterSeq=Long(r,"afterSeq",0);
        var settleMs=Math.Clamp(Int(r,"settleMs",90),0,250);
        HoldCursorForPhysicalInput(true);
        return _semantic.Act(semanticSessionId,nodeId,action,value,afterSeq,settleMs);
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
        var receipts=new List<object?>();
        foreach(var action in actions.EnumerateArray())
        {
            var guard=Text(action,"guardTitleContains","");
            if(guard.Length>0&&!NativeInput.ReadForeground().Title.Contains(guard,StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("guard_foreground_mismatch");
            var op=Text(action,"op");
            _activity.Check();
            object receipt=op switch {
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
            receipts.Add(receipt);
            applied++;
            var delay=Math.Clamp(Int(action,"delayMs",0),0,2000);
            if(delay>0) NativeInput.InterruptibleDelay(delay);
        }
        return new {applied,results=receipts,native=NativeInput.ReadStatus()};
    }

    private async Task<object> RunPlanAsync(JsonElement r)
    {
        ValidateDisplayTopology(r);
        var semanticSessionId=Text(r,"semanticSessionId","");
        var afterSeq=Long(r,"afterSeq",0);
        var settleMs=Math.Clamp(Int(r,"settleMs",90),0,250);
        if(semanticSessionId.Length>0) _semantic.ValidateInput(semanticSessionId,afterSeq);

        object mutation;
        var nodeId=Text(r,"nodeId","");
        var action=Text(r,"action","");
        if(nodeId.Length>0||action.Length>0)
        {
            if(semanticSessionId.Length==0) throw new InvalidOperationException("semantic_session_id_required");
            if(nodeId.Length==0) throw new InvalidOperationException("semantic_node_id_required");
            if(action.Length==0) throw new InvalidOperationException("semantic_action_required");
            HoldCursorForPhysicalInput(true);
            mutation=_semantic.ActMutation(semanticSessionId,nodeId,action,Text(r,"value",""),afterSeq);
        }
        else mutation=RunBatch(r,64);

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
        _activity.Stop();
        TryExit();
    }

    private void TryExit()
    {
        try { _=_uiDispatcher.BeginInvoke(new Action(()=>ExitThread())); }
        catch { }
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
        _activity.Dispose();
        NativeInput.ReleaseOwnedInputs();
        lock(_cursorLeaseGate) {
            _passivePreviewActive=false; _passivePreviewExpiresUtcMs=0;
            _passivePreviewTimer.Dispose();
        }
        _ambientGlow?.Close();
        _ambientGlow?.Dispose();
        base.ExitThreadCore();
    }
}
