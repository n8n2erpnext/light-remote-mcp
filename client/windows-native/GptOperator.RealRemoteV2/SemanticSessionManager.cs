using System.Windows.Automation;

namespace GptOperator.RealRemoteV2;

internal sealed class SemanticSessionManager : IDisposable
{
    private const int MaxSessions=8;
    private const int SignalDebounceMs=40;

    private sealed class PendingSignal
    {
        public required string SemanticSessionId { get; init; }
        public required string Epoch { get; init; }
        public required string Scope { get; set; }
        public long RootHwnd { get; set; }
        public string RootTitle { get; set; }="";
        public long RootEpoch { get; set; }
        public long StateSeq { get; set; }
        public bool ScopeChanged { get; set; }
        public bool ResyncRecommended { get; set; }
        public long At { get; set; }
        public List<SemanticJournalEntry> Events { get; }=new();
    }

    private sealed class Session
    {
        public required string Id { get; init; }
        public required string Epoch { get; init; }
        public required string Scope { get; init; }
        public long RootHwnd { get; set; }
        public string RootTitle { get; set; }="";
        public long RootEpoch { get; set; }=1;
        public required int MaxDepth { get; init; }
        public required int MaxNodes { get; init; }
        public required long AttachedAt { get; init; }
        public SemanticJournal Journal { get; }=new();
    }

    // Only primitive metadata crosses lanes. UIA elements stay on the worker
    // that created them, and a detached/re-rooted observation cannot publish.
    private sealed record RootRead(long Hwnd,string Title,long Epoch,long StateSeq,long InputSeq,long FocusGeneration,long NativeInputGeneration,long OwnerInputGeneration,bool InputRunning);
    private void RequireLive(Session session)
    {
        if(_disposed)throw new ObjectDisposedException(nameof(SemanticSessionManager));
        if(!_sessions.TryGetValue(session.Id,out var current)||!ReferenceEquals(current,session))
            throw new InvalidOperationException("semantic_session_missing");
    }
    private RootRead PinRoot(Session session)
    {
        lock(_gate) {
            RequireLive(session);
            return new(session.RootHwnd,session.RootTitle,session.RootEpoch,session.Journal.StateSeq,session.Journal.InputSeq,_sensor.FocusGeneration,
                _activity.InputObservationGeneration,_activity.OwnerInputGeneration,_activity.InputRunning);
        }
    }
    private void ValidateRoot(Session session,RootRead root)
    {
        RequireLive(session);
        if(session.RootHwnd!=root.Hwnd||session.RootEpoch!=root.Epoch)
            throw new InvalidOperationException("semantic_snapshot_changed_reobserve");
    }

    private readonly UiSensor _sensor;
    private readonly ControlActivity _activity;
    private readonly object _gate=new();
    private readonly Dictionary<string,Session> _sessions=new(StringComparer.Ordinal);
    private readonly Dictionary<string,PendingSignal> _pendingSignals=new(StringComparer.Ordinal);
    private readonly System.Threading.Timer _signalTimer;
    private bool _signalScheduled;
    private bool _disposed;

    public event Action<object>? Changed;

    public bool HasSessions
    {
        get { lock(_gate) return !_disposed && _sessions.Count>0; }
    }

    public SemanticSessionManager(UiSensor sensor,ControlActivity activity)
    {
        _sensor=sensor;_activity=activity;
        _signalTimer=new System.Threading.Timer(_=>FlushSignals(),null,Timeout.Infinite,Timeout.Infinite);
        _sensor.Changed+=OnUiChanged;
    }

    public object Attach(string scope="foreground",int maxDepth=6,int maxNodes=500)
    {
        ThrowIfDisposed();
        scope=NormalizeScope(scope);
        maxDepth=Math.Clamp(maxDepth,0,12);
        maxNodes=Math.Clamp(maxNodes,1,1500);

        var fg=NativeInput.ReadForeground();
        if(fg.Hwnd==0) throw new InvalidOperationException("semantic_foreground_missing");

        lock(_gate)
        {
            if(_sessions.Count>=MaxSessions) throw new InvalidOperationException("semantic_session_limit");
        }

        var session=new Session {
            Id="sem_"+Guid.NewGuid().ToString("N"),
            Epoch="epoch_"+Guid.NewGuid().ToString("N"),
            Scope=scope,
            RootHwnd=fg.Hwnd,
            RootTitle=fg.Title,
            MaxDepth=maxDepth,
            MaxNodes=maxNodes,
            AttachedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        var focusBefore=_sensor.FocusGeneration;
        var snapshot=_sensor.SemanticSnapshot(fg.Hwnd,maxDepth,maxNodes,session.Epoch);
        if(NativeInput.ReadForeground().Hwnd!=fg.Hwnd||_sensor.FocusGeneration!=focusBefore)
            throw new InvalidOperationException("semantic_snapshot_changed_reobserve");

        lock(_gate)
        {
            ThrowIfDisposed();
            if(_sessions.Count>=MaxSessions) throw new InvalidOperationException("semantic_session_limit");
            _sessions.Add(session.Id,session);
        return new {
            semanticSessionId=session.Id,
            epoch=session.Epoch,
            scope=session.Scope,
            rootHwnd=session.RootHwnd,
            rootTitle=session.RootTitle,
            rootEpoch=session.RootEpoch,
            stateSeq=session.Journal.StateSeq,
            inputSeq=session.Journal.InputSeq,
            maxDepth=session.MaxDepth,
            maxNodes=session.MaxNodes,
            attachedAt=session.AttachedAt,
            snapshot
        };
        }
    }

    public object Snapshot(string semanticSessionId)
    {
        var session=Get(semanticSessionId);
        RefreshTaskRoot(session);
        var root=PinRoot(session);
        var snapshot=_sensor.SemanticSnapshot(root.Hwnd,session.MaxDepth,session.MaxNodes,session.Epoch);
        var foreground=NativeInput.ReadForeground();
        if(session.Scope=="desktop")AdoptTaskRoot(session,foreground);
        lock(_gate) {
        ValidateRoot(session,root);
        var focusOutsideScope=session.Scope=="foreground" && foreground.Hwnd!=root.Hwnd;
        var concurrentInput=session.Journal.InputSeq!=root.InputSeq||root.InputRunning||_activity.InputRunning||
            _activity.InputObservationGeneration!=root.NativeInputGeneration||_activity.OwnerInputGeneration!=root.OwnerInputGeneration;
        var concurrentUiChange=session.Journal.StateSeq!=root.StateSeq||_sensor.FocusGeneration!=root.FocusGeneration;
        var stateSeq=session.Journal.AdvanceSnapshot();
        return new {
            semanticSessionId=session.Id,
            epoch=session.Epoch,
            stateSeq,
            inputSeq=session.Journal.InputSeq,
            scope=session.Scope,
            rootHwnd=root.Hwnd,
            rootTitle=root.Title,
            rootEpoch=root.Epoch,
            foreground,
            focusOutsideScope,
            concurrentInput,
            concurrentUiChange,
            resyncRecommended=focusOutsideScope||concurrentInput||concurrentUiChange,
            snapshot
        };
        }
    }

    public object Events(string semanticSessionId,long afterSeq,int limit=100)
    {
        var session=Get(semanticSessionId);
        RefreshTaskRoot(session);
        var foreground=NativeInput.ReadForeground();
        lock(_gate) {
        RequireLive(session);
        var read=session.Journal.Read(afterSeq,limit);
        var focusOutsideScope=session.Scope=="foreground" && foreground.Hwnd!=session.RootHwnd;
        var scopeChanged=read.Events.Any(e=>e.ScopeChanged);
        var resyncRecommended=read.Gap || focusOutsideScope || read.Events.Any(e=>e.ResyncRecommended);

        return new {
            semanticSessionId=session.Id,
            epoch=session.Epoch,
            stateSeq=read.StateSeq,
            inputSeq=read.InputSeq,
            afterSeq,
            gap=read.Gap,
            droppedBeforeSeq=read.DroppedBeforeSeq,
            scope=session.Scope,
            rootHwnd=session.RootHwnd,
            rootTitle=session.RootTitle,
            rootEpoch=session.RootEpoch,
            scopeChanged,
            focusOutsideScope,
            resyncRecommended,
            hasMore=read.HasMore,
            events=read.Events,
            foreground
        };
        }
    }

    public void ValidateInput(string semanticSessionId,long afterSeq)
    {
        var session=Get(semanticSessionId);
        if(afterSeq>0) session.Journal.ValidateAfterSeq(afterSeq);
        ValidateScope(session);
    }

    private void ValidateScope(Session session)
    {
        var foreground=NativeInput.ReadForeground();
        if(session.Scope=="desktop")
        {
            AdoptTaskRoot(session,foreground);
            return;
        }
        lock(_gate) {
            RequireLive(session);
            if(foreground.Hwnd!=session.RootHwnd)throw new InvalidOperationException("semantic_scope_changed");
        }
    }

    public object AcknowledgeInput(string semanticSessionId,long afterSeq,int settleMs,object mutation)
    {
        var session=Get(semanticSessionId);
        settleMs=Math.Clamp(settleMs,0,250);
        if(settleMs>0) Thread.Sleep(settleMs);

        RefreshTaskRoot(session);
        var root=PinRoot(session);
        var focused=_sensor.FocusedSemantic();
        var foreground=NativeInput.ReadForeground();
        lock(_gate) {
        RequireLive(session);
        // The mutation already happened. A later root change is an uncertain
        // acknowledgement requiring observation, never a reason to replay it.
        var rootChanged=session.RootHwnd!=root.Hwnd||session.RootEpoch!=root.Epoch;
        var inputSeq=session.Journal.NextInputSeq();
        var read=session.Journal.Read(afterSeq,SemanticJournal.MaxRead);
        var focusOutsideScope=session.Scope=="foreground" && foreground.Hwnd!=root.Hwnd;
        var scopeChanged=read.Events.Any(e=>e.ScopeChanged);
        var resyncRecommended=rootChanged||read.Gap || focusOutsideScope || read.Events.Any(e=>e.ResyncRecommended);

        return new {
            semanticSessionId=session.Id,
            epoch=session.Epoch,
            scope=session.Scope,
            rootHwnd=root.Hwnd,
            rootTitle=root.Title,
            rootEpoch=root.Epoch,
            inputSeq,
            stateSeq=read.StateSeq,
            afterSeq,
            settleMs,
            mutation,
            cursor=NativeInput.ReadStatus().Cursor,
            foreground,
            focused=rootChanged?null:focused,
            rootChanged,
            currentRootHwnd=session.RootHwnd,
            currentRootEpoch=session.RootEpoch,
            automaticReplay=false,
            gap=read.Gap,
            droppedBeforeSeq=read.DroppedBeforeSeq,
            scopeChanged,
            focusOutsideScope,
            resyncRecommended,
            hasMore=read.HasMore,
            events=read.Events
        };
        }
    }

    public object ActMutation(string semanticSessionId,string nodeId,string action,string? value=null,long afterSeq=0)
    {
        var session=Get(semanticSessionId);
        if(afterSeq>0) session.Journal.ValidateAfterSeq(afterSeq);
        ValidateScope(session);
        RefreshTaskRoot(session);
        var root=PinRoot(session);
        var element=_sensor.ResolveSemanticElement(root.Hwnd,session.MaxDepth,session.MaxNodes,session.Epoch,nodeId);
        action=(action??"").Trim().ToLowerInvariant();
        if(action.Length==0) throw new InvalidOperationException("semantic_action_required");

        string method;
        try
        {
            // A concurrent read/hook may discover a different task window while
            // resolving. Never apply the previously resolved node to that root.
            lock(_gate)ValidateRoot(session,root);
            if(NativeInput.ReadForeground().Hwnd!=root.Hwnd||_sensor.FocusGeneration!=root.FocusGeneration)
                throw new InvalidOperationException("semantic_scope_changed");
            method=action switch
            {
                "invoke"=>InvokeElement(element),
                "toggle"=>ToggleElement(element),
                "set-value" or "value"=>SetElementValue(element,value??""),
                "select"=>SelectElement(element),
                "expand"=>ExpandElement(element,true),
                "collapse"=>ExpandElement(element,false),
                "focus"=>FocusElement(element),
                "click"=>ClickElement(element),
                _=>throw new InvalidOperationException("semantic_action_unsupported")
            };
        }
        catch(ElementNotAvailableException)
        {
            throw new InvalidOperationException("semantic_node_stale_or_not_found");
        }

        return new {
            applied=true,
            provider="windows-uia",
            semanticSessionId=session.Id,
            nodeId,
            action,
            method
        };
    }

    public object Act(string semanticSessionId,string nodeId,string action,string? value=null,long afterSeq=0,int settleMs=90)
    {
        var mutation=ActMutation(semanticSessionId,nodeId,action,value,afterSeq);
        var ack=AcknowledgeInput(semanticSessionId,afterSeq,settleMs,mutation);
        return new {
            provider="windows-uia",
            semanticSessionId,
            nodeId,
            action=(action??"").Trim().ToLowerInvariant(),
            mutation,
            ack
        };
    }

    private static string InvokeElement(AutomationElement element)
    {
        if(!element.TryGetCurrentPattern(InvokePattern.Pattern,out var raw)||raw is not InvokePattern pattern)
            throw new InvalidOperationException("semantic_action_pattern_unavailable:invoke");
        pattern.Invoke();
        return "uia.invoke";
    }

    private static string ToggleElement(AutomationElement element)
    {
        if(!element.TryGetCurrentPattern(TogglePattern.Pattern,out var raw)||raw is not TogglePattern pattern)
            throw new InvalidOperationException("semantic_action_pattern_unavailable:toggle");
        pattern.Toggle();
        return "uia.toggle";
    }

    private static string SetElementValue(AutomationElement element,string value)
    {
        if(!element.TryGetCurrentPattern(ValuePattern.Pattern,out var raw)||raw is not ValuePattern pattern)
            throw new InvalidOperationException("semantic_action_pattern_unavailable:value");
        if(pattern.Current.IsReadOnly) throw new InvalidOperationException("semantic_action_value_read_only");
        pattern.SetValue(value);
        return "uia.value";
    }

    private static string SelectElement(AutomationElement element)
    {
        if(!element.TryGetCurrentPattern(SelectionItemPattern.Pattern,out var raw)||raw is not SelectionItemPattern pattern)
            throw new InvalidOperationException("semantic_action_pattern_unavailable:selectionItem");
        pattern.Select();
        return "uia.selectionItem";
    }

    private static string ExpandElement(AutomationElement element,bool expand)
    {
        if(!element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern,out var raw)||raw is not ExpandCollapsePattern pattern)
            throw new InvalidOperationException("semantic_action_pattern_unavailable:expandCollapse");
        if(expand) pattern.Expand(); else pattern.Collapse();
        return expand?"uia.expand":"uia.collapse";
    }

    private static string FocusElement(AutomationElement element)
    {
        element.SetFocus();
        return "uia.focus";
    }

    private static string ClickElement(AutomationElement element)
    {
        var bounds=element.Current.BoundingRectangle;
        if(bounds.IsEmpty||bounds.Width<=0||bounds.Height<=0)
            throw new InvalidOperationException("semantic_action_click_bounds_unavailable");
        var x=(int)Math.Round(bounds.X+bounds.Width/2d);
        var y=(int)Math.Round(bounds.Y+bounds.Height/2d);
        NativeInput.Move(x,y,60,6);
        NativeInput.Click("left",1);
        return "sendinput.click";
    }

    public object Detach(string semanticSessionId)
    {
        Session? session;
        lock(_gate)
        {
            if(!_sessions.Remove(semanticSessionId,out session) || session is null)
                throw new InvalidOperationException("semantic_session_missing");
            _pendingSignals.Remove(semanticSessionId);
        }

        return new {
            semanticSessionId=session.Id,
            epoch=session.Epoch,
            scope=session.Scope,
            rootEpoch=session.RootEpoch,
            detached=true,
            finalStateSeq=session.Journal.StateSeq,
            finalInputSeq=session.Journal.InputSeq
        };
    }

    private Session Get(string semanticSessionId)
    {
        ThrowIfDisposed();
        if(string.IsNullOrWhiteSpace(semanticSessionId))
            throw new InvalidOperationException("semantic_session_id_required");
        lock(_gate)
        {
            if(_sessions.TryGetValue(semanticSessionId,out var session)) return session;
        }
        throw new InvalidOperationException("semantic_session_missing");
    }

    private static string NormalizeScope(string value)
    {
        var scope=String.IsNullOrWhiteSpace(value)?"foreground":value.Trim().ToLowerInvariant();
        return scope switch {
            "foreground"=>"foreground",
            "desktop" or "task"=>"desktop",
            _=>throw new InvalidOperationException("semantic_scope_invalid")
        };
    }

    private void RefreshTaskRoot(Session session)
    {
        if(session.Scope!="desktop") return;
        AdoptTaskRoot(session,NativeInput.ReadForeground());
    }

    private void AdoptTaskRoot(Session session,ForegroundInfo foreground)
    {
        lock(_gate)
        {
            RequireLive(session);
            if(session.Scope!="desktop" || foreground.Hwnd==0)return;
            if(session.RootHwnd==foreground.Hwnd) return;
            session.RootHwnd=foreground.Hwnd;
            session.RootTitle=foreground.Title;
            session.RootEpoch++;
        }
    }

    private void OnUiChanged(UiChangeEvent evt)
    {
        lock(_gate)
        {
            if(_disposed||_sessions.Count==0) return;
        foreach(var session in _sessions.Values)
        {
            var rootChanged=false;
            if(session.Scope=="desktop" && evt.Kind=="foreground" && evt.Hwnd!=0)
            {
                var before=session.RootHwnd;
                AdoptTaskRoot(session,new ForegroundInfo(evt.Hwnd,evt.Title));
                rootChanged=before!=session.RootHwnd;
            }

            var within=_sensor.IsWithinRoot(evt.Hwnd,session.RootHwnd);
            var scopeChanged=session.Scope=="foreground"
                ? evt.Kind=="foreground" && !within
                : rootChanged;
            if(!within && !scopeChanged) continue;

            var entry=session.Journal.Append(
                evt.Kind,
                evt.Hwnd,
                evt.Title,
                evt.ObjectId,
                evt.ChildId,
                evt.At,
                scopeChanged,
                scopeChanged && session.Scope!="desktop"
            );

            QueueSignal(session,entry);
        }
        }
    }

    private void QueueSignal(Session session,SemanticJournalEntry entry)
    {
        lock(_gate)
        {
            if(_disposed||!_sessions.TryGetValue(session.Id,out var current)||!ReferenceEquals(current,session)) return;
            if(!_pendingSignals.TryGetValue(session.Id,out var pending))
            {
                pending=new PendingSignal {
                    SemanticSessionId=session.Id,
                    Epoch=session.Epoch,
                    Scope=session.Scope,
                    RootHwnd=session.RootHwnd,
                    RootTitle=session.RootTitle,
                    RootEpoch=session.RootEpoch
                };
                _pendingSignals[session.Id]=pending;
            }
            pending.Scope=session.Scope;
            pending.RootHwnd=session.RootHwnd;
            pending.RootTitle=session.RootTitle;
            pending.RootEpoch=session.RootEpoch;
            pending.StateSeq=Math.Max(pending.StateSeq,entry.Seq);
            pending.ScopeChanged|=entry.ScopeChanged;
            pending.ResyncRecommended|=entry.ResyncRecommended;
            pending.At=Math.Max(pending.At,entry.At);
            pending.Events.Add(entry);
            if(pending.Events.Count>64) pending.Events.RemoveRange(0,pending.Events.Count-64);
            if(_signalScheduled) return;
            _signalScheduled=true;
            _signalTimer.Change(SignalDebounceMs,Timeout.Infinite);
        }
    }

    private void FlushSignals()
    {
        PendingSignal[] pending;
        lock(_gate)
        {
            if(_disposed) return;
            pending=_pendingSignals.Values.ToArray();
            _pendingSignals.Clear();
            _signalScheduled=false;
        }

        foreach(var signal in pending)
        {
            try
            {
                Changed?.Invoke(new {
                    kind="semantic.delta",
                    semanticSessionId=signal.SemanticSessionId,
                    epoch=signal.Epoch,
                    scope=signal.Scope,
                    rootHwnd=signal.RootHwnd,
                    rootTitle=signal.RootTitle,
                    rootEpoch=signal.RootEpoch,
                    stateSeq=signal.StateSeq,
                    events=signal.Events.Select(entry=>new {
                        seq=entry.Seq,
                        kind=entry.Kind,
                        hwnd=entry.Hwnd,
                        title=entry.Title,
                        objectId=entry.ObjectId,
                        childId=entry.ChildId,
                        at=entry.At,
                        scopeChanged=entry.ScopeChanged,
                        resyncRecommended=entry.ResyncRecommended
                    }).ToArray(),
                    foreground=NativeInput.ReadForeground(),
                    focused=_sensor.FocusedSemantic(),
                    scopeChanged=signal.ScopeChanged,
                    resyncRecommended=signal.ResyncRecommended,
                    at=signal.At
                });
            }
            catch {}
        }
    }

    internal static bool ScopeSelfTest()
    {
        try
        {
            return NormalizeScope("")=="foreground"
                && NormalizeScope("foreground")=="foreground"
                && NormalizeScope("desktop")=="desktop"
                && NormalizeScope("task")=="desktop";
        }
        catch { return false; }
    }

    private void ThrowIfDisposed()
    {
        if(_disposed) throw new ObjectDisposedException(nameof(SemanticSessionManager));
    }

    public void Dispose()
    {
        if(_disposed) return;
        _disposed=true;
        _sensor.Changed-=OnUiChanged;
        _signalTimer.Dispose();
        lock(_gate)
        {
            _sessions.Clear();
            _pendingSignals.Clear();
            _signalScheduled=false;
        }
    }
}
