using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace GptOperator.RealRemoteV2;

// Optional on-demand desktop duplication. No capture timer, transport, input or
// permission path lives here. GPU crop/resize precede reduced CPU readback.
// JPEG remains CPU encoding; no hardware video/zero-copy claim.
internal sealed class DxgiCapture
{
    private readonly object _gate=new();
    private ID3D11Device? _device;
    private ID3D11DeviceContext? _context;
    private IDXGIOutputDuplication? _duplication;
    private GpuFrameScaler? _scaler;
    private string _key="";
    private long _retryAfter;
    private long _captures,_fallbacks;
    private string _lastFallback="not_requested";
    public object Metadata()
    {
        if(!Monitor.TryEnter(_gate))return new {compiled=true,busy=true,hardwareAccepted=false,defaultBackend="gdi"};
        try{return new {compiled=true,busy=false,active=_device is not null,captures=_captures,fallbacks=_fallbacks,lastFallback=_lastFallback,
            hardwareAccepted=false,videoEncoder=false,gpuResizeSupported=true,gpuResizeStage="d3d11-compute-before-reduced-readback",acquireTimeoutMs=16,defaultBackend="gdi"};}
        finally{Monitor.Exit(_gate);}
    }
    public void Clear() {lock(_gate){Reset();_retryAfter=0;}}
    private void Reset()
    {
        _scaler?.Dispose();_scaler=null;
        _duplication?.Dispose();_duplication=null;
        _context?.Dispose();_context=null;
        _device?.Dispose();_device=null;_key="";
    }
    private bool Fallback(string reason,out string fallback,bool reset=false)
    {
        if(reset){Reset();_retryAfter=Stopwatch.GetTimestamp()+2*Stopwatch.Frequency;}
        _fallbacks++;_lastFallback=reason;fallback=reason;return false;
    }
    public bool TryCopy(Bitmap destination,string deviceName,Rectangle screen,Rectangle crop,string topology,out string fallback)
    {
        lock(_gate) {
            fallback="";
            if(Stopwatch.GetTimestamp()<_retryAfter)return Fallback("dxgi_recovery_backoff",out fallback);
            if((long)screen.Width*screen.Height>16*1024*1024)return Fallback("dxgi_source_pixel_budget",out fallback,true);
            try {
                var key=$"{topology}:{deviceName}:{screen}";
                if(_key!=key){Reset();Initialize(deviceName,screen);_key=key;}
                var acquired=_duplication!.AcquireNextFrame(16,out _,out var resource);
                if(acquired.Code==unchecked((int)0x887A0027)) {resource?.Dispose();return Fallback("dxgi_wait_timeout_fresh_gdi",out fallback);}
                if(acquired.Failure){resource?.Dispose();acquired.CheckError();}
                try {
                    using(resource) {
                        using var texture=resource.QueryInterface<ID3D11Texture2D>();
                        var desc=texture.Description;
                        if(desc.Format!=Format.B8G8R8A8_UNorm||desc.Width!=screen.Width||desc.Height!=screen.Height)
                            throw new InvalidOperationException("dxgi_surface_geometry_or_format");
                        var local=new Rectangle(crop.X-screen.X,crop.Y-screen.Y,crop.Width,crop.Height);
                        _scaler!.Copy(texture,local,destination);
                    }
                } finally {_duplication.ReleaseFrame().CheckError();}
                _captures++;_lastFallback="";return true;
            } catch(Exception error) when(error is not OutOfMemoryException) {
                // Do not expose driver/provider strings or serve the previous
                // desktop on device loss. Caller copies CURRENT pixels via GDI.
                return Fallback("dxgi_unavailable_"+error.HResult.ToString("x8"),out fallback,true);
            }
        }
    }
    private void Initialize(string deviceName,Rectangle bounds)
    {
        using var factory=DXGI.CreateDXGIFactory1<IDXGIFactory1>();
        for(uint a=0;a<32;a++) {
            var enumerated=factory.EnumAdapters1(a,out var adapter);
            if(enumerated.Failure){adapter?.Dispose();break;}
            using(adapter) for(uint o=0;o<32;o++) {
                var result=adapter.EnumOutputs(o,out var output);
                if(result.Failure){output?.Dispose();break;}
                using(output) {
                    var desc=output.Description;var rect=desc.DesktopCoordinates;
                    if(!String.Equals(desc.DeviceName,deviceName,StringComparison.OrdinalIgnoreCase))continue;
                    if(!desc.AttachedToDesktop||rect.Left!=bounds.Left||rect.Top!=bounds.Top||rect.Right!=bounds.Right||rect.Bottom!=bounds.Bottom||desc.Rotation!=ModeRotation.Identity)
                        throw new InvalidOperationException("dxgi_output_rotated_or_geometry_changed");
                    D3D11.D3D11CreateDevice(adapter,DriverType.Unknown,DeviceCreationFlags.BgraSupport,
                        new[]{FeatureLevel.Level_11_0,FeatureLevel.Level_10_1,FeatureLevel.Level_10_0},out ID3D11Device device,out ID3D11DeviceContext context).CheckError();
                    _device=device;_context=context;
                    using var output1=output.QueryInterface<IDXGIOutput1>();
                    _duplication=output1.DuplicateOutput(device);
                    _scaler=new GpuFrameScaler(device,context);
                    return;
                }
            }
        }
        throw new InvalidOperationException("dxgi_exact_output_missing");
    }
    internal static unsafe void CopyBgraToBgr(nint source,int rowPitch,nint destination,int stride,Rectangle crop)
    {
        if(crop.X<0||crop.Y<0||crop.Width<1||crop.Height<1||rowPitch<(long)crop.Right*4||Math.Abs((long)stride)<(long)crop.Width*3)
            throw new InvalidOperationException("dxgi_copy_geometry_invalid");
        for(var y=0;y<crop.Height;y++) {
            var input=(byte*)source+(long)(crop.Y+y)*rowPitch+crop.X*4;
            var target=(byte*)destination+(long)y*stride;
            for(var x=0;x<crop.Width;x++){target[x*3]=input[x*4];target[x*3+1]=input[x*4+1];target[x*3+2]=input[x*4+2];}
        }
    }
    internal static unsafe bool SelfTest()
    {
        var source=new byte[4*24];var target=Enumerable.Repeat((byte)0xee,24).ToArray();
        for(var y=0;y<4;y++)for(var x=0;x<5;x++){var i=y*24+x*4;source[i]=(byte)x;source[i+1]=(byte)y;source[i+2]=0x91;source[i+3]=0xff;}
        fixed(byte* src=source)fixed(byte* dst=target) {
            CopyBgraToBgr((nint)src,24,(nint)(dst+12),-12,new Rectangle(1,1,3,2));
            for(var y=0;y<2;y++)for(var x=0;x<3;x++) {
                var i=12-y*12+x*3;if(target[i]!=x+1||target[i+1]!=y+1||target[i+2]!=0x91)return false;
            }
            if(target[9]!=0xee||target[21]!=0xee)return false;
            try{CopyBgraToBgr((nint)src,4,(nint)dst,12,new Rectangle(1,1,3,2));return false;}catch(InvalidOperationException){}
        }
        return true;
    }
}
