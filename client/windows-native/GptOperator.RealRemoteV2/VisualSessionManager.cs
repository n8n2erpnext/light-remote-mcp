using System.Drawing;

namespace GptOperator.RealRemoteV2;

internal sealed class VisualSessionManager : IDisposable
{
    private const int MaxSessions=4;
    private const int DefaultLeaseMs=30_000;
    private const int MinLeaseMs=1_000;
    private const int MaxLeaseMs=900_000;

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
        public Rectangle? Region {get;init;}
        public long FrameSeq { get; set; }
        public GpuObservation? Observation {get;set;}
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

    public bool IsActive(string id)
    {
        lock(_gate) {
            if(_disposed)return false;
            CleanupExpiredLocked(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            return _sessions.ContainsKey(id);
        }
    }

    public object Attach(
        int screen=0,
        int maxWidth=960,
        int maxHeight=540,
        int quality=50,
        int leaseMs=DefaultLeaseMs,
        string owner="",Rectangle? region=null)
    {
        ThrowIfDisposed();
        var screenCount=DesktopVisual.ReadScreenCount();
        if(screen<0||screen>=screenCount) throw new InvalidOperationException("visual_screen_invalid");

        _=DesktopVisual.Crop(Screen.AllScreens[screen].Bounds,region);
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
            Quality=quality,Region=region,
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
            region=session.Region is {} roi?new {x=roi.X,y=roi.Y,width=roi.Width,height=roi.Height}:null,
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

    public object Frame(string visualSessionId,string leaseToken,string previousSha="",bool omitUnchanged=false)
    {
        var session=GetAuthorized(visualSessionId,leaseToken);
        EnsureTopology(session);
        var frame=DesktopVisual.Capture(session.Screen,session.MaxWidth,session.MaxHeight,session.Quality,session.Region,previousSha,omitUnchanged);
        EnsureTopology(session);

        long frameSeq;
        lock(_gate)
        {
            EnsurePresentLocked(session);
            var now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if(now>session.ExpiresAt)
            {
                session.Observation?.Dispose();_sessions.Remove(session.Id);
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

    public object VideoFrame(string visualSessionId,string leaseToken,int fps=15,bool hardware=true,bool gpu=true)
    {
        if(fps<1||fps>30)throw new InvalidOperationException("video_rate_invalid");
        var session=GetAuthorized(visualSessionId,leaseToken);
        void Guard(){var current=GetAuthorized(visualSessionId,leaseToken);if(!ReferenceEquals(current,session))throw new InvalidOperationException("visual_session_replaced");EnsureTopology(session);}
        Guard();var packet=DesktopVisual.CaptureVideo(session.Id,session.Screen,session.MaxWidth,session.MaxHeight,session.Region,fps,hardware,gpu,Guard);
        Guard();long seq;
        lock(_gate){EnsurePresentLocked(session);var now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();if(now>session.ExpiresAt)throw new InvalidOperationException("visual_lease_expired");session.LastSeenAt=now;session.ExpiresAt=now+session.LeaseMs;seq=++session.FrameSeq;}
        return new {visualSessionId=session.Id,epoch=session.Epoch,displayTopologyId=session.TopologyId,frameSeq=seq,expiresAt=session.ExpiresAt,video=packet};
    }
    // The background guard checks authority and topology without renewing it.
    public object ObservationStart(string id,string token,string profile,int fps,Rectangle? region)
    {
        var s=GetAuthorized(id,token);EnsureTopology(s);
        if(profile=="precision"&&region is null)throw new InvalidOperationException("observation_precision_region_required");
        var screen=Screen.AllScreens[s.Screen];var crop=DesktopVisual.Crop(screen.Bounds,region??s.Region);
        var scope=DesktopVisual.Crop(screen.Bounds,s.Region);
        if(!scope.Contains(crop))throw new InvalidOperationException("observation_region_outside_attached_scope");
        void Guard(){if(!ReferenceEquals(GetAuthorized(id,token),s))throw new InvalidOperationException("visual_session_replaced");EnsureTopology(s);}
        lock(_gate){
            EnsurePresentLocked(s);
            if(s.Observation is not null)throw new InvalidOperationException("observation_already_started_stop_first");
            if(_sessions.Values.Count(x=>x.Observation is not null)>=2)throw new InvalidOperationException("observation_producer_limit");
            s.Observation=new GpuObservation(screen.DeviceName,screen.Bounds,crop,s.TopologyId,profile,fps,Guard);
            Renew(s,0);
            return new {visualSessionId=s.Id,epoch=s.Epoch,observationId=s.Observation.Id,observationEpoch=s.Observation.Epoch,state="starting",backgroundRenewsLease=false};
        }
    }
    public object ObservationRead(string id,string token,string observationId,long afterSeq,int waitMs)
    {
        var s=GetAuthorized(id,token);EnsureTopology(s);GpuObservation producer;
        lock(_gate){producer=s.Observation??throw new InvalidOperationException("observation_not_started");if(producer.Id!=observationId)throw new InvalidOperationException("observation_id_mismatch");Renew(s,0);}
        var observation=producer.Read(afterSeq,waitMs);
        lock(_gate){EnsurePresentLocked(s);if(!ReferenceEquals(s.Observation,producer))throw new InvalidOperationException("observation_closed_during_read");return new {visualSessionId=s.Id,epoch=s.Epoch,displayTopologyId=s.TopologyId,frameSeq=++s.FrameSeq,observation};}
    }
    public object ObservationStop(string id,string token,string observationId)
    {
        var s=GetAuthorized(id,token);lock(_gate){if(s.Observation?.Id!=observationId)throw new InvalidOperationException("observation_id_mismatch");s.Observation.Dispose();s.Observation=null;return new {stopped=true,observationId,retainedFrames=0,backgroundRenewsLease=false};}
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
            session.Observation?.Dispose();
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
            region=session.Region is {} roi?new {x=roi.X,y=roi.Y,width=roi.Width,height=roi.Height}:null,
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
                session.Observation?.Dispose();_sessions.Remove(visualSessionId);
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
                session.Observation?.Dispose();_sessions.Remove(session.Id);
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
        foreach(var id in expired){_sessions[id].Observation?.Dispose();_sessions.Remove(id);}
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
        lock(_gate){foreach(var s in _sessions.Values)s.Observation?.Dispose();_sessions.Clear();}
    }
}
