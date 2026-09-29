namespace GptOperator.RealRemoteV2;

internal sealed class SemanticSessionManager : IDisposable
{
    private const int MaxSessions=8;
    private const int SignalDebounceMs=40;

    private sealed record PendingSignal(
        string SemanticSessionId,
        string Epoch,
        long StateSeq,
        string EventKind,
        bool ScopeChanged,
        bool ResyncRecommended,
        long At
    );

    private sealed class Session
    {
        public required string Id { get; init; }
        public required string Epoch { get; init; }
        public required long RootHwnd { get; init; }
        public required string RootTitle { get; init; }
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

    public object Attach(int maxDepth=6,int maxNodes=500)
    {
        ThrowIfDisposed();
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
            scope="foreground",
            rootHwnd=session.RootHwnd,
            rootTitle=session.RootTitle,
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
        var snapshot=_sensor.SemanticSnapshot(session.RootHwnd,session.MaxDepth,session.MaxNodes);
        var stateSeq=session.Journal.AdvanceSnapshot();
        var foreground=NativeInput.ReadForeground();
        var focusOutsideScope=foreground.Hwnd!=session.RootHwnd;

        return new {
            semanticSessionId=session.Id,
            epoch=session.Epoch,
            stateSeq,
            inputSeq=session.Journal.InputSeq,
            scope="foreground",
            rootHwnd=session.RootHwnd,
            foreground,
            focusOutsideScope,
            resyncRecommended=focusOutsideScope,
            snapshot
        };
    }

    public object Events(string semanticSessionId,long afterSeq,int limit=100)
    {
        var session=Get(semanticSessionId);
        var read=session.Journal.Read(afterSeq,limit);
        var foreground=NativeInput.ReadForeground();
        var focusOutsideScope=foreground.Hwnd!=session.RootHwnd;
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
        if(foreground.Hwnd!=session.RootHwnd)
            throw new InvalidOperationException("semantic_scope_changed");
    }

    public object AcknowledgeInput(string semanticSessionId,long afterSeq,int settleMs,object mutation)
    {
        var session=Get(semanticSessionId);
        settleMs=Math.Clamp(settleMs,0,250);
        if(settleMs>0) Thread.Sleep(settleMs);

        var inputSeq=session.Journal.NextInputSeq();
        var read=session.Journal.Read(afterSeq,SemanticJournal.MaxRead);
        var foreground=NativeInput.ReadForeground();
        var focusOutsideScope=foreground.Hwnd!=session.RootHwnd;
        var scopeChanged=read.Events.Any(e=>e.ScopeChanged);
        var focused=_sensor.FocusedSemantic();
        var resyncRecommended=read.Gap || scopeChanged || focusOutsideScope || read.Events.Any(e=>e.ResyncRecommended);

        return new {
            semanticSessionId=session.Id,
            epoch=session.Epoch,
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
        }

        return new {
            semanticSessionId=session.Id,
            epoch=session.Epoch,
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
            var within=_sensor.IsWithinRoot(evt.Hwnd,session.RootHwnd);
            var scopeChanged=evt.Kind=="foreground" && !within;
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
            _pendingSignals[session.Id]=new PendingSignal(
                session.Id,
                session.Epoch,
                entry.Seq,
                entry.Kind,
                entry.ScopeChanged,
                entry.ResyncRecommended,
                entry.At
            );
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
                    kind="semantic.changed",
                    semanticSessionId=signal.SemanticSessionId,
                    epoch=signal.Epoch,
                    stateSeq=signal.StateSeq,
                    eventKind=signal.EventKind,
                    scopeChanged=signal.ScopeChanged,
                    resyncRecommended=signal.ResyncRecommended,
                    at=signal.At
                });
            }
            catch {}
        }
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
