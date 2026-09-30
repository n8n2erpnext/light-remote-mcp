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

    private readonly UiSensor _sensor;
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

    public SemanticSessionManager(UiSensor sensor)
    {
        _sensor=sensor;
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

        var snapshot=_sensor.SemanticSnapshot(fg.Hwnd,maxDepth,maxNodes);
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

        lock(_gate)
        {
            if(_sessions.Count>=MaxSessions) throw new InvalidOperationException("semantic_session_limit");
            _sessions.Add(session.Id,session);
        }

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

    public object Snapshot(string semanticSessionId)
    {
        var session=Get(semanticSessionId);
        RefreshTaskRoot(session);
        var snapshot=_sensor.SemanticSnapshot(session.RootHwnd,session.MaxDepth,session.MaxNodes);
        var stateSeq=session.Journal.AdvanceSnapshot();
        var foreground=NativeInput.ReadForeground();
        var focusOutsideScope=session.Scope=="foreground" && foreground.Hwnd!=session.RootHwnd;

        return new {
            semanticSessionId=session.Id,
            epoch=session.Epoch,
            stateSeq,
            inputSeq=session.Journal.InputSeq,
            scope=session.Scope,
            rootHwnd=session.RootHwnd,
            rootTitle=session.RootTitle,
            rootEpoch=session.RootEpoch,
            foreground,
            focusOutsideScope,
            resyncRecommended=focusOutsideScope,
            snapshot
        };
    }

    public object Events(string semanticSessionId,long afterSeq,int limit=100)
    {
        var session=Get(semanticSessionId);
        RefreshTaskRoot(session);
        var read=session.Journal.Read(afterSeq,limit);
        var foreground=NativeInput.ReadForeground();
        var focusOutsideScope=session.Scope=="foreground" && foreground.Hwnd!=session.RootHwnd;
        var scopeChanged=read.Events.Any(e=>e.ScopeChanged);
        var resyncRecommended=read.Gap || scopeChanged || focusOutsideScope || read.Events.Any(e=>e.ResyncRecommended);

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

    public void ValidateInput(string semanticSessionId,long afterSeq)
    {
        var session=Get(semanticSessionId);
        session.Journal.ValidateAfterSeq(afterSeq);
        var foreground=NativeInput.ReadForeground();
        if(session.Scope=="desktop")
        {
            AdoptTaskRoot(session,foreground);
            return;
        }
        if(foreground.Hwnd!=session.RootHwnd)
            throw new InvalidOperationException("semantic_scope_changed");
    }

    public object AcknowledgeInput(string semanticSessionId,long afterSeq,int settleMs,object mutation)
    {
        var session=Get(semanticSessionId);
        settleMs=Math.Clamp(settleMs,0,250);
        if(settleMs>0) Thread.Sleep(settleMs);

        RefreshTaskRoot(session);
        var inputSeq=session.Journal.NextInputSeq();
        var read=session.Journal.Read(afterSeq,SemanticJournal.MaxRead);
        var foreground=NativeInput.ReadForeground();
        var focusOutsideScope=session.Scope=="foreground" && foreground.Hwnd!=session.RootHwnd;
        var scopeChanged=read.Events.Any(e=>e.ScopeChanged);
        var focused=_sensor.FocusedSemantic();
        var resyncRecommended=read.Gap || scopeChanged || focusOutsideScope || read.Events.Any(e=>e.ResyncRecommended);

        return new {
            semanticSessionId=session.Id,
            epoch=session.Epoch,
            scope=session.Scope,
            rootHwnd=session.RootHwnd,
            rootTitle=session.RootTitle,
            rootEpoch=session.RootEpoch,
            inputSeq,
            stateSeq=read.StateSeq,
            afterSeq,
            settleMs,
            mutation,
            cursor=NativeInput.ReadStatus().Cursor,
            foreground,
            focused,
            gap=read.Gap,
            droppedBeforeSeq=read.DroppedBeforeSeq,
            scopeChanged,
            focusOutsideScope,
            resyncRecommended,
            hasMore=read.HasMore,
            events=read.Events
        };
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
        if(session.Scope!="desktop" || foreground.Hwnd==0 || foreground.Hwnd==session.RootHwnd) return;
        lock(_gate)
        {
            if(session.RootHwnd==foreground.Hwnd) return;
            session.RootHwnd=foreground.Hwnd;
            session.RootTitle=foreground.Title;
            session.RootEpoch++;
        }
    }

    private void OnUiChanged(UiChangeEvent evt)
    {
        Session[] sessions;
        lock(_gate)
        {
            if(_disposed||_sessions.Count==0) return;
            sessions=_sessions.Values.ToArray();
        }

        foreach(var session in sessions)
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
                scopeChanged
            );

            QueueSignal(session,entry);
        }
    }

    private void QueueSignal(Session session,SemanticJournalEntry entry)
    {
        lock(_gate)
        {
            if(_disposed) return;
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
