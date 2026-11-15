using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace GptOperator.RealRemoteV2;

// Explicit opt-in. The producer owns its D3D context/thread; neither capture
// nor source validation renews a task or sends input. No autonomous transport.
internal sealed class GpuObservation : IDisposable
{
    private readonly object _gate=new();
    private readonly CancellationTokenSource _stop=new();
    private readonly Thread _worker;
    private readonly Rectangle _screen,_crop;
    private readonly string _device,_topology,_profile;
    private readonly Action _guard;
    private readonly Func<IObservationCapture> _sourceFactory;
    private readonly int _width,_height,_fps;
    private Bitmap? _latest;
    private string _state="starting",_reason="",_hash="";
    private long _seq,_capturedAt,_validatedAt,_validatedTick,_capturedTick,_acquired,_idle,_skipped;
    private bool _disposed,_finished;
    public string Id {get;}="obs_"+Guid.NewGuid().ToString("N");
    public string Epoch {get;}="oepoch_"+Guid.NewGuid().ToString("N");
    public GpuObservation(string device,Rectangle screen,Rectangle crop,string topology,string profile,int fps,Action guard,Func<IObservationCapture>? sourceFactory=null)
    {
        if(profile is not ("precision" or "overview")||fps<1||fps>30)throw new InvalidOperationException("observation_options_invalid");
        if(profile=="precision"&&(crop.Width>384||crop.Height>384))throw new InvalidOperationException("observation_precision_roi_max384_select_smaller_region");
        _device=device;_screen=screen;_crop=crop;_topology=topology;_profile=profile;_fps=fps;_guard=guard;_sourceFactory=sourceFactory??(()=>new ObservationCapture());
        var scale=profile=="precision"?1d:Math.Min(1d,Math.Min(640d/crop.Width,360d/crop.Height));
        _width=Math.Max(1,(int)(crop.Width*scale));_height=Math.Max(1,(int)(crop.Height*scale));
        _worker=new Thread(Produce){IsBackground=true,Name="RM GPU observation"};_worker.SetApartmentState(ApartmentState.MTA);_worker.Start();
    }
    private void Produce()
    {
        var hr=CoInitializeEx(0,0);IObservationCapture? source=null;
        try {
            source=_sourceFactory();
            Marshal.ThrowExceptionForHR(hr);using var work=new Bitmap(_width,_height,PixelFormat.Format24bppRgb);
            while(!_stop.IsCancellationRequested) {
                _guard();var tick=Stopwatch.GetTimestamp();
                var outcome=source.Copy(work,_device,_screen,_crop,_topology,_seq==0);
                _guard();var now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if(outcome=="frame") {
                    var hash=HashPixels(work);
                    lock(_gate) {
                        if(_stop.IsCancellationRequested)break;
                        _acquired++;
                        if(hash!=_hash){_latest?.Dispose();_latest=(Bitmap)work.Clone();_hash=hash;_seq++;_capturedAt=now;_capturedTick=Stopwatch.GetTimestamp();}
                        else _skipped++;
                        _state="running";_validatedAt=now;_validatedTick=Stopwatch.GetTimestamp();Monitor.PulseAll(_gate);
                    }
                }else {
                    lock(_gate){if(_stop.IsCancellationRequested)break;_idle++;_validatedAt=now;_validatedTick=Stopwatch.GetTimestamp();if(_latest is not null)_state="running";}
                }
                var remaining=1000d/_fps-Stopwatch.GetElapsedTime(tick).TotalMilliseconds;
                if(remaining>0)_stop.Token.WaitHandle.WaitOne((int)Math.Ceiling(remaining));
            }
        }catch(Exception error)when(error is not OutOfMemoryException) {
            lock(_gate){_reason=error is InvalidOperationException?error.Message:"observation_gpu_unavailable_"+error.HResult.ToString("x8");_state="source_lost";ClearLocked();Monitor.PulseAll(_gate);}
        }finally {
            source?.Dispose();lock(_gate){if(_state!="source_lost")_state="stopped";ClearLocked();_finished=true;_stop.Dispose();Monitor.PulseAll(_gate);}
            if(hr>=0)CoUninitialize();
        }
    }
    public object Read(long afterSeq,int waitMs)
    {
        if(afterSeq<0||waitMs<0||waitMs>1500)throw new InvalidOperationException("observation_read_invalid");
        _guard();Bitmap? copy=null;long seq,at,validated,capturedTick,validatedTick,acquired,idle,skipped;string state,reason,hash;
        var clock=Stopwatch.StartNew();
        lock(_gate) {
            while(!_disposed&&(_state is "starting" or "running")&&_seq<=afterSeq&&clock.ElapsedMilliseconds<waitMs)
                Monitor.Wait(_gate,(int)Math.Max(1,waitMs-clock.ElapsedMilliseconds));
            seq=_seq;at=_capturedAt;validated=_validatedAt;capturedTick=_capturedTick;validatedTick=_validatedTick;acquired=_acquired;idle=_idle;skipped=_skipped;state=_state;reason=_reason;hash=_hash;
            if(seq>afterSeq&&_latest is not null&&state=="running")copy=(Bitmap)_latest.Clone();
        }
        try {
            _guard();byte[]? bytes=null;
            if(copy is not null){using var encoded=new MemoryStream();if(_profile=="precision")copy.Save(encoded,ImageFormat.Png);else{var codec=ImageCodecInfo.GetImageEncoders().Single(x=>x.MimeType=="image/jpeg");using var parameters=new EncoderParameters(1);parameters.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,45L);copy.Save(encoded,codec,parameters);}bytes=encoded.ToArray();if(bytes.Length>650*1024)throw new InvalidOperationException("observation_image_budget_select_smaller_roi");}
            _guard();lock(_gate){if(_disposed||(_state=="source_lost"&&copy is not null))throw new InvalidOperationException("observation_closed_during_read");}
            return new {observationId=Id,observationEpoch=Epoch,state=state=="running"?(bytes is null?"no_change":"changed"):state,reason=reason.Length==0?null:reason,sourceSeq=seq,capturedAt=at,validatedAt=validated,
                capturedAgeMs=capturedTick==0?(double?)null:Stopwatch.GetElapsedTime(capturedTick).TotalMilliseconds,sourceValidationAgeMs=validatedTick==0?(double?)null:Stopwatch.GetElapsedTime(validatedTick).TotalMilliseconds,
                sourceBackend="dxgi-d3d11",gpuCapture=true,profile=_profile,lossless=_profile=="precision",resampled=_profile!="precision",width=_width,height=_height,fps=_fps,
                physicalBounds=new{x=_crop.X,y=_crop.Y,width=_crop.Width,height=_crop.Height},displayTopologyId=_topology,
                inputMapping=new{xOffset=_crop.X,yOffset=_crop.Y,xScale=(double)_crop.Width/_width,yScale=(double)_crop.Height/_height,coordinateConvention="frame-pixel-centers-to-physical-virtual-no-extra-dpi"},
                image=bytes is null?null:new{mimeType=_profile=="precision"?"image/png":"image/jpeg",data=Convert.ToBase64String(bytes),dataBytes=bytes.Length,sha256=Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),pixelSha256=hash},
                stats=new{acquiredFrames=acquired,idlePolls=idle,identicalRoiFrames=skipped,changedFrames=seq,intermediateChangesSinceRead=Math.Max(0,seq-afterSeq-1),retainedFrames=state=="running"?1:0,backgroundRenewsLease=false},storedOnDisk=false};
        }finally{copy?.Dispose();}
    }
    internal static string HashPixels(Bitmap bitmap)
    {
        using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);var bits=bitmap.LockBits(new Rectangle(0,0,bitmap.Width,bitmap.Height),ImageLockMode.ReadOnly,PixelFormat.Format24bppRgb);var row=new byte[bitmap.Width*3];
        try{for(var y=0;y<bitmap.Height;y++){Marshal.Copy(bits.Scan0+y*bits.Stride,row,0,row.Length);hash.AppendData(row);}return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();}finally{Array.Clear(row);bitmap.UnlockBits(bits);}
    }
    private void ClearLocked(){_latest?.Dispose();_latest=null;_hash="";}
    public void Dispose(){lock(_gate){if(_disposed)return;_disposed=true;if(!_finished)_stop.Cancel();_state="stopped";ClearLocked();Monitor.PulseAll(_gate);}}
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("ole32.dll",ExactSpelling=true)]private static extern int CoInitializeEx(nint reserved,uint flags);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("ole32.dll",ExactSpelling=true)]private static extern void CoUninitialize();
}
