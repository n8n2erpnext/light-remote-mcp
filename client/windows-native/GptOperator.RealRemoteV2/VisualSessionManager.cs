namespace GptOperator.RealRemoteV2;

internal sealed class VisualSessionManager : IDisposable
{
    private const int MaxSessions=4;
    private const int DefaultLeaseMs=30_000;
    private const int MinLeaseMs=1_000;
    private const int MaxLeaseMs=300_000;

    private sealed class Session
    {
        public required string Id { get; init; }
        public required string Epoch { get; init; }
        public required string LeaseToken { get; init; }
        public required string Owner { get; init; }
        public required string TopologyId { get; init; }
        public required int Screen { get; init; }
        public required int MaxWidth { get; init; }
        public required int MaxHeight { get; init; }
        public required int Quality { get; init; }
        public required long CreatedAt { get; init; }
        public required int LeaseMs { get; set; }
        public required long ExpiresAt { get; set; }
        public required long LastSeenAt { get; set; }
        public long FrameSeq { get; set; }
    }

    private readonly object _gate=new();
    private readonly Dictionary<string,Session> _sessions=new(StringComparer.Ordinal);
    private bool _disposed;

    public int ActiveSessions
    {
        get
        {
            lock(_gate)
            {
                CleanupExpiredLocked(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                return _sessions.Count;
            }
        }
    }

    public object Attach(
        int screen=0,
        int maxWidth=960,
        int maxHeight=540,
        int quality=50,
        int leaseMs=DefaultLeaseMs,
        string owner="")
    {
        ThrowIfDisposed();
        var screenCount=DesktopVisual.ReadScreenCount();
        if(screen<0||screen>=screenCount) throw new InvalidOperationException("visual_screen_invalid");

        owner=(owner??"").Trim();
        if(owner.Length>80) throw new InvalidOperationException("visual_owner_invalid");

        maxWidth=Math.Clamp(maxWidth,160,1280);
        maxHeight=Math.Clamp(maxHeight,90,720);
        quality=Math.Clamp(quality,25,70);
        leaseMs=NormalizeLeaseMs(leaseMs,DefaultLeaseMs);
        var now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var topologyId=DesktopVisual.ReadTopologyId();

        var session=new Session {
            Id="vis_"+Guid.NewGuid().ToString("N"),
            Epoch="vepoch_"+Guid.NewGuid().ToString("N"),
            LeaseToken="vlease_"+Guid.NewGuid().ToString("N"),
            Owner=owner,
            TopologyId=topologyId,
            Screen=screen,
            MaxWidth=maxWidth,
            MaxHeight=maxHeight,
            Quality=quality,
            CreatedAt=now,
            LeaseMs=leaseMs,
            ExpiresAt=now+leaseMs,
            LastSeenAt=now,
            FrameSeq=0
        };

        lock(_gate)
        {
            CleanupExpiredLocked(now);
            if(_sessions.Count>=MaxSessions) throw new InvalidOperationException("visual_session_limit");
            _sessions.Add(session.Id,session);
        }

        return new {
            visualSessionId=session.Id,
            epoch=session.Epoch,
            leaseToken=session.LeaseToken,
            owner=session.Owner,
            displayTopologyId=session.TopologyId,
            screen=session.Screen,
            maxWidth=session.MaxWidth,
            maxHeight=session.MaxHeight,
            quality=session.Quality,
            frameSeq=session.FrameSeq,
            leaseMs=session.LeaseMs,
            expiresAt=session.ExpiresAt,
            attachedAt=session.CreatedAt
        };
    }

    public object Resume(string visualSessionId,string leaseToken,int leaseMs=0)
    {
        var session=GetAuthorized(visualSessionId,leaseToken);
        EnsureTopology(session);
        Renew(session,leaseMs);
        return Summary(session,true);
    }

    public object KeepAlive(string visualSessionId,string leaseToken,int leaseMs=0)
    {
        var session=GetAuthorized(visualSessionId,leaseToken);
        EnsureTopology(session);
        Renew(session,leaseMs);
        return Summary(session,false);
    }

    public object Frame(string visualSessionId,string leaseToken)
    {
        var session=GetAuthorized(visualSessionId,leaseToken);
        EnsureTopology(session);
        var frame=DesktopVisual.Capture(session.Screen,session.MaxWidth,session.MaxHeight,session.Quality);
        EnsureTopology(session);

        long frameSeq;
        lock(_gate)
        {
            EnsurePresentLocked(session);
            var now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if(now>session.ExpiresAt)
            {
                _sessions.Remove(session.Id);
                throw new InvalidOperationException("visual_lease_expired");
            }
            session.LastSeenAt=now;
            session.ExpiresAt=now+session.LeaseMs;
            frameSeq=++session.FrameSeq;
        }

        return new {
            visualSessionId=session.Id,
            epoch=session.Epoch,
            displayTopologyId=session.TopologyId,
            frameSeq,
            expiresAt=session.ExpiresAt,
            frame
        };
    }

    public object ValidateInput(string visualSessionId,string leaseToken)
    {
        var session=GetAuthorized(visualSessionId,leaseToken);
        EnsureTopology(session);
        Renew(session,0);
        return new {
            visualSessionId=session.Id,
            epoch=session.Epoch,
            displayTopologyId=session.TopologyId,
            screen=session.Screen,
            frameSeq=session.FrameSeq,
            expiresAt=session.ExpiresAt,
            leaseValid=true,
            topologyPinned=true
        };
    }

    public object Detach(string visualSessionId,string leaseToken)
    {
        var session=GetAuthorized(visualSessionId,leaseToken);
        lock(_gate)
        {
            if(!_sessions.Remove(session.Id)) throw new InvalidOperationException("visual_session_missing");
        }

        return new {
            visualSessionId=session.Id,
            epoch=session.Epoch,
            detached=true,
            finalFrameSeq=session.FrameSeq,
            displayTopologyId=session.TopologyId
        };
    }

    private object Summary(Session session,bool resumed) => new {
        visualSessionId=session.Id,
        epoch=session.Epoch,
        owner=session.Owner,
        displayTopologyId=session.TopologyId,
        screen=session.Screen,
        maxWidth=session.MaxWidth,
        maxHeight=session.MaxHeight,
        quality=session.Quality,
        frameSeq=session.FrameSeq,
        leaseMs=session.LeaseMs,
        expiresAt=session.ExpiresAt,
        resumed
    };

    private Session GetAuthorized(string visualSessionId,string leaseToken)
    {
        ThrowIfDisposed();
        if(string.IsNullOrWhiteSpace(visualSessionId))
            throw new InvalidOperationException("visual_session_id_required");
        if(string.IsNullOrWhiteSpace(leaseToken))
            throw new InvalidOperationException("visual_lease_required");

        lock(_gate)
        {
            if(!_sessions.TryGetValue(visualSessionId,out var session))
                throw new InvalidOperationException("visual_session_missing");

            var now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if(now>session.ExpiresAt)
            {
                _sessions.Remove(visualSessionId);
                throw new InvalidOperationException("visual_lease_expired");
            }

            if(!string.Equals(session.LeaseToken,leaseToken,StringComparison.Ordinal))
                throw new InvalidOperationException("visual_lease_invalid");
            return session;
        }
    }

    private static void EnsureTopology(Session session)
    {
        var current=DesktopVisual.ReadTopologyId();
        if(!string.Equals(current,session.TopologyId,StringComparison.Ordinal))
            throw new InvalidOperationException("visual_topology_changed");
        if(session.Screen<0||session.Screen>=DesktopVisual.ReadScreenCount())
            throw new InvalidOperationException("visual_topology_changed");
    }

    private void Renew(Session session,int requestedLeaseMs)
    {
        lock(_gate)
        {
            EnsurePresentLocked(session);
            var now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if(now>session.ExpiresAt)
            {
                _sessions.Remove(session.Id);
                throw new InvalidOperationException("visual_lease_expired");
            }
            if(requestedLeaseMs!=0)
                session.LeaseMs=NormalizeLeaseMs(requestedLeaseMs,session.LeaseMs);
            session.LastSeenAt=now;
            session.ExpiresAt=now+session.LeaseMs;
        }
    }

    private void EnsurePresentLocked(Session session)
    {
        if(!_sessions.TryGetValue(session.Id,out var current)||!ReferenceEquals(current,session))
            throw new InvalidOperationException("visual_session_missing");
    }

    private void CleanupExpiredLocked(long now)
    {
        if(_sessions.Count==0) return;
        var expired=_sessions.Values.Where(x=>now>x.ExpiresAt).Select(x=>x.Id).ToArray();
        foreach(var id in expired) _sessions.Remove(id);
    }

    private static int NormalizeLeaseMs(int requested,int fallback)
    {
        if(requested==0) requested=fallback;
        return Math.Clamp(requested,MinLeaseMs,MaxLeaseMs);
    }

    public static bool SelfTest()
    {
        try
        {
            return NormalizeLeaseMs(0,DefaultLeaseMs)==DefaultLeaseMs
                && NormalizeLeaseMs(1,DefaultLeaseMs)==MinLeaseMs
                && NormalizeLeaseMs(900_000,DefaultLeaseMs)==MaxLeaseMs
                && NormalizeLeaseMs(12_345,DefaultLeaseMs)==12_345;
        }
        catch { return false; }
    }

    private void ThrowIfDisposed()
    {
        if(_disposed) throw new ObjectDisposedException(nameof(VisualSessionManager));
    }

    public void Dispose()
    {
        if(_disposed) return;
        _disposed=true;
        lock(_gate) _sessions.Clear();
    }
}
