using System.Security.Cryptography;
using System.Text;

namespace GptOperator.RealRemoteV2;

internal sealed class LogicalTextWriter(UiSensor sensor,ControlActivity activity)
{
    private sealed class Write
    {
        public required string Id,Visual,Mode,Verification;
        public required TypingTarget Target;
        public required int Requested;
        public readonly StringBuilder SentText=new();
        public int Sent;
        public int LastObserved;
        public bool Known=true;
        public volatile bool Cancelled;
        public string State="running",Reason="";
        public int LastOffset=-1;
        public string LastHash="";
        public object? LastReceipt;
    }
    private readonly object _gate=new();
    private Write? _active;
    public bool Active {get {lock(_gate)return _active is not null;} }
    private Write Owned(string id,string visual)
    {
        lock(_gate) {
            var row=_active;
            if(row is null||row.Id!=id)throw new InvalidOperationException("desktop_write_unknown_do_not_replay");
            if(row.Visual!=visual)throw new InvalidOperationException("desktop_write_native_scope_mismatch");
            return row;
        }
    }
    public object Start(string id,string visual,int requested,string mode,string verification)
    {
        if(!System.Text.RegularExpressions.Regex.IsMatch(id,"^write_[A-Za-z0-9_-]{8,80}$")||requested<1||requested>8*1024*1024)
            throw new InvalidOperationException("desktop_write_invalid_identity_or_budget");
        lock(_gate) {
            if(_active is {} prior) {
                if(prior.Id==id&&prior.Visual==visual&&prior.Requested==requested&&prior.Mode==mode&&prior.Verification==verification)return Prepared(prior);
                throw new InvalidOperationException("desktop_logical_write_busy");
            }
        }
        NativeInput.EnsureNoHeldModifiers();
        var target=TypingTarget.Capture(sensor,activity,mode,verification);
        var row=new Write{Id=id,Visual=visual,Requested=requested,Mode=mode,Verification=verification,Target=target};
        lock(_gate) {if(_active is not null)throw new InvalidOperationException("desktop_logical_write_busy");_active=row;}
        return Prepared(row);
    }
    private static object Prepared(Write row)=>new {writeId=row.Id,target=row.Target.Metadata(),
        verificationAvailable=row.Target.VerificationAvailable,verificationMethod=row.Target.VerificationMethod,
        maxChunkUnits=256,deliveryBackpressure=row.Target.VerificationAvailable,progressUnits="utf16-input-events-accepted-not-inserted-content",automaticReplay=false};
    public void AssertInput(string op,string id)
    {
        lock(_gate)if(_active is {} row&&(op!="desktop.text.chunk"||row.Id!=id))
            throw new InvalidOperationException("desktop_logical_write_in_progress_cancel_or_wait");
    }
    public bool CancelScope(string visual)
    {
        lock(_gate) {if(_active is not {} row||row.Visual!=visual)return false;row.Cancelled=true;return true;}
    }
    public object Chunk(string id,string visual,int offset,string text,int intervalMs,long authorityDeadline)
    {
        if(authorityDeadline<=0||System.Diagnostics.Stopwatch.GetTimestamp()>=authorityDeadline)
            throw new InvalidOperationException("desktop_write_authority_expired_before_native_admission");
        var row=Owned(id,visual);
        if(text.Length is <1 or >256||offset<0||intervalMs is <0 or >100)
            throw new InvalidOperationException("desktop_write_invalid_chunk");
        var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
        if(offset==row.LastOffset&&row.LastReceipt is not null) {
            if(hash!=row.LastHash)throw new InvalidOperationException("desktop_write_chunk_conflict");
            return row.LastReceipt; // confirmed native duplicate, no additional input
        }
        if(!row.Known||offset!=row.Sent||row.Sent+text.Length>row.Requested)
            throw new InvalidOperationException("desktop_write_offset_requires_reconciliation");
        if(row.State!="running")throw new InvalidOperationException("desktop_write_already_interrupted");
        var accepted=0;var phase="target-preflight";
        double targetMs=0,sendMs=0,deliveryMs=0;
        var clock=System.Diagnostics.Stopwatch.StartNew();
        void ObserveGuard()
        {
            if(row.Cancelled)throw new TypingTargetInterrupted("agent_cancelled");
            row.Target.CheckFast();
        }
        void AdmitPacket()
        {
            if(System.Diagnostics.Stopwatch.GetTimestamp()>=authorityDeadline)throw new TypingTargetInterrupted("desktop_write_authority_expired_reconcile");
            ObserveGuard();
            // Recheck after potentially slow Win32 target validation, directly
            // before the packet sender is called.
            if(System.Diagnostics.Stopwatch.GetTimestamp()>=authorityDeadline)throw new TypingTargetInterrupted("desktop_write_authority_expired_reconcile");
        }
        try {
            row.Target.CheckFull();
            targetMs=clock.Elapsed.TotalMilliseconds;phase="sending";clock.Restart();
            accepted=NativeInput.WriteLogicalChunk(text,intervalMs,AdmitPacket,ObserveGuard);
            sendMs=clock.Elapsed.TotalMilliseconds;phase="delivery-readback";clock.Restart();
            row.Sent+=accepted;row.SentText.Append(text);
            if(row.Verification!="none"&&row.Target.VerificationAvailable) {
                // WaitForDelivery performs CheckFull before every read. Do not
                // issue a duplicate focused-element/provider lookup here.
                // Authority freshness fences new packets, not observation of
                // already admitted effects. Completion never sends more input;
                // its bounded polling still checks cancel/Owner/focus/desktop.
                if(!row.Target.WaitForDelivery(row.SentText.ToString(),ObserveGuard))
                    throw new TypingTargetInterrupted("desktop_text_delivery_not_observed_reconcile");
                row.LastObserved=row.Sent;
            } else row.Target.CheckFull();
            deliveryMs=clock.Elapsed.TotalMilliseconds;phase="complete";
        } catch(LogicalTextPacketInterrupted interruption) {
            row.Known=interruption.ProgressKnown;
            if(row.Known) {row.Sent+=interruption.SentUnits;row.SentText.Append(text.AsSpan(0,interruption.SentUnits));}
            row.State=interruption.ProgressKnown?(interruption.Message=="agent_cancelled"?"cancelled":"interrupted"):"indeterminate";
            row.Reason=interruption.Message;
        } catch(TypingTargetInterrupted interruption) {
            row.State=interruption.Message=="agent_cancelled"?"cancelled":"interrupted";row.Reason=interruption.Message;
        } catch(Exception error) {
            row.Known=false;row.State="indeterminate";row.Reason=error.Message;
        }
        if(phase=="target-preflight")targetMs=clock.Elapsed.TotalMilliseconds;
        else if(phase=="sending")sendMs=clock.Elapsed.TotalMilliseconds;
        else if(phase=="delivery-readback")deliveryMs=clock.Elapsed.TotalMilliseconds;
        var receipt=new {writeId=row.Id,state=row.State,reason=row.Reason.Length==0?null:row.Reason,
            phase,textTiming=new {targetMs,sendMs,deliveryMs},authorityExpiredAtReceipt=System.Diagnostics.Stopwatch.GetTimestamp()>=authorityDeadline,
            sentUnits=row.Known?(int?)row.Sent:null,requestedUnits=row.Requested,lastObservedInsertedUnits=row.LastObserved,verifiedInsertedUnits=(int?)null,
            contentVerification="unverified",automaticReplay=false};
        row.LastOffset=offset;row.LastHash=hash;row.LastReceipt=receipt;return receipt;
    }
    public object Abandon(string id,string visual) {var row=Owned(id,visual);row.Cancelled=true;lock(_gate)if(_active==row)_active=null;row.SentText.Clear();return new {contentVerification="indeterminate",verifiedInsertedUnits=(int?)null,reason="native_scope_expired_no_readback"};}
    public object Finish(string id,string visual,bool complete)
    {
        var row=Owned(id,visual);
        try {
            if(!complete||row.Verification=="none")return new {contentVerification="unverified",verifiedInsertedUnits=(int?)null,verificationMethod=row.Target.VerificationMethod};
            if(!row.Known)return new {contentVerification="indeterminate",verifiedInsertedUnits=(int?)null,verificationMethod=row.Target.VerificationMethod};
            var full=complete&&row.Sent==row.Requested&&!row.Cancelled&&row.State=="running";
            try{return row.Target.Verify(row.SentText.ToString(),row.Sent,full);}
            catch(TypingTargetInterrupted error){return new {contentVerification="interrupted",verifiedInsertedUnits=(int?)null,verificationMethod=row.Target.VerificationMethod,reason=error.Message};}
        } finally {
            lock(_gate)if(_active==row)_active=null;
            row.SentText.Clear();
        }
    }
    public void Clear() {lock(_gate){if(_active is {} row)row.Cancelled=true;_active=null;} }
}
