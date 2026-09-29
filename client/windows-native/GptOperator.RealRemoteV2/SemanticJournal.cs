namespace GptOperator.RealRemoteV2;

internal sealed record SemanticJournalEntry(
    long Seq,
    string Kind,
    long Hwnd,
    string Title,
    int ObjectId,
    int ChildId,
    long At,
    bool ScopeChanged,
    bool ResyncRecommended
);

internal sealed record SemanticJournalRead(
    long StateSeq,
    long InputSeq,
    long DroppedBeforeSeq,
    bool Gap,
    bool HasMore,
    SemanticJournalEntry[] Events
);

internal sealed class SemanticJournal
{
    public const int Capacity=512;
    public const int MaxRead=200;
    private const long CoalesceWindowMs=75;

    private readonly object _gate=new();
    private readonly List<SemanticJournalEntry> _events=new(Capacity);
    private long _stateSeq=1;
    private long _inputSeq;
    private long _droppedBeforeSeq;

    public long StateSeq
    {
        get { lock(_gate) return _stateSeq; }
    }

    public long InputSeq
    {
        get { lock(_gate) return _inputSeq; }
    }

    public long DroppedBeforeSeq
    {
        get { lock(_gate) return _droppedBeforeSeq; }
    }

    public long AdvanceSnapshot()
    {
        lock(_gate) return ++_stateSeq;
    }

    public long NextInputSeq()
    {
        lock(_gate) return ++_inputSeq;
    }

    public void ValidateAfterSeq(long afterSeq)
    {
        lock(_gate)
        {
            if(afterSeq<0) throw new InvalidOperationException("semantic_after_seq_invalid");
            if(afterSeq>_stateSeq) throw new InvalidOperationException("semantic_after_seq_ahead");
        }
    }

    public SemanticJournalEntry Append(
        string kind,
        long hwnd,
        string title,
        int objectId,
        int childId,
        long at,
        bool scopeChanged,
        bool resyncRecommended)
    {
        lock(_gate)
        {
            var entry=new SemanticJournalEntry(
                ++_stateSeq,
                kind,
                hwnd,
                title,
                objectId,
                childId,
                at,
                scopeChanged,
                resyncRecommended
            );

            if(_events.Count>0 && CanCoalesce(_events[^1],entry))
            {
                _events[^1]=entry;
                return entry;
            }

            _events.Add(entry);
            if(_events.Count>Capacity)
            {
                var removed=_events[0];
                _events.RemoveAt(0);
                _droppedBeforeSeq=Math.Max(_droppedBeforeSeq,removed.Seq);
            }
            return entry;
        }
    }

    public SemanticJournalRead Read(long afterSeq,int limit)
    {
        lock(_gate)
        {
            if(afterSeq<0) throw new InvalidOperationException("semantic_after_seq_invalid");
            if(afterSeq>_stateSeq) throw new InvalidOperationException("semantic_after_seq_ahead");
            limit=Math.Clamp(limit,1,MaxRead);

            var gap=_droppedBeforeSeq>0 && afterSeq<_droppedBeforeSeq;
            var available=_events.Where(e=>e.Seq>afterSeq).ToArray();
            var page=available.Take(limit).ToArray();
            return new SemanticJournalRead(
                _stateSeq,
                _inputSeq,
                _droppedBeforeSeq,
                gap,
                available.Length>page.Length,
                page
            );
        }
    }

    private static bool CanCoalesce(SemanticJournalEntry previous,SemanticJournalEntry next)
    {
        return next.At>=previous.At
            && next.At-previous.At<=CoalesceWindowMs
            && next.Kind==previous.Kind
            && next.Hwnd==previous.Hwnd
            && next.ObjectId==previous.ObjectId
            && next.ChildId==previous.ChildId
            && next.ScopeChanged==previous.ScopeChanged
            && next.ResyncRecommended==previous.ResyncRecommended;
    }

    public static bool SelfTest()
    {
        try
        {
            var j=new SemanticJournal();
            if(j.StateSeq!=1 || j.InputSeq!=0) return false;

            var first=j.Append("focus",101,"A",1,0,1000,false,false);
            if(first.Seq!=2) return false;

            var coalesced=j.Append("focus",101,"A",1,0,1050,false,false);
            if(coalesced.Seq!=3) return false;
            var r1=j.Read(1,10);
            if(r1.Events.Length!=1 || r1.Events[0].Seq!=3 || r1.Gap) return false;

            if(j.NextInputSeq()!=1 || j.InputSeq!=1) return false;
            if(j.AdvanceSnapshot()!=4) return false;

            for(var i=0;i<Capacity+20;i++)
                j.Append("name",101,"A",1000+i,0,2000+i,false,false);

            var r2=j.Read(0,MaxRead);
            if(!r2.Gap || r2.DroppedBeforeSeq<=0 || !r2.HasMore) return false;
            if(r2.Events.Length!=MaxRead) return false;

            var threw=false;
            try { j.ValidateAfterSeq(j.StateSeq+1); }
            catch(InvalidOperationException) { threw=true; }
            return threw;
        }
        catch
        {
            return false;
        }
    }
}
