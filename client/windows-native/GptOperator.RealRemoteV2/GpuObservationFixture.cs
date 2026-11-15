using System.Drawing;
using System.Drawing.Imaging;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace GptOperator.RealRemoteV2;

// Actions-only synthetic input exercises the SAME threaded producer, D3D
// scaler/readback, PNG encoder and close fence. WARP is not physical GPU proof.
internal static class GpuObservationFixture
{
    private sealed class Scene:IObservationCapture
    {
        public static int X=70,Disposed,Acquired;
        private readonly ID3D11Device _device;private readonly ID3D11DeviceContext _context;private readonly ID3D11Texture2D _texture;private readonly GpuFrameScaler _scaler;private int _last=-1;
        public Scene(){D3D11.D3D11CreateDevice(null,DriverType.Warp,DeviceCreationFlags.BgraSupport,new[]{FeatureLevel.Level_11_0},out ID3D11Device device,out ID3D11DeviceContext context).CheckError();_device=device;_context=context;_texture=device.CreateTexture2D(new Texture2DDescription(Format.B8G8R8A8_UNorm,256,192,mipLevels:1,bindFlags:BindFlags.ShaderResource));_scaler=new(device,context);}
        public string Copy(Bitmap output,string name,Rectangle screen,Rectangle crop,string topology,bool first){
            var x=Volatile.Read(ref X);if(!first&&_last==x)return "idle";
            var pixels=new uint[256*192];Array.Fill(pixels,0xffffffffu);for(var y=0;y<192;y++)pixels[y*256+x]=0xffff0000u;
            _context.UpdateSubresource<uint>(pixels.AsSpan(),_texture,0,256*4);
            _scaler.Copy(_texture,new Rectangle(crop.X-screen.X,crop.Y-screen.Y,crop.Width,crop.Height),output);_last=x;Interlocked.Increment(ref Acquired);return "frame";
        }
        public void Dispose(){_scaler.Dispose();_texture.Dispose();_context.Dispose();_device.Dispose();Interlocked.Increment(ref Disposed);}
    }
    internal static bool Write(string output)
    {
        if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true")return false;
        try{
            ApplicationConfiguration.Initialize();var allowed=true;void Guard(){if(!Volatile.Read(ref allowed))throw new InvalidOperationException("fixture_authority_closed");}
            var topology=DesktopVisual.ReadTopologyId();var screen=new Rectangle(-400,0,256,192);var crop=new Rectangle(-368,16,128,96);
            using var producer=new GpuObservation("synthetic-warp",screen,crop,topology,"precision",30,Guard,()=>new Scene());
            var frames=new List<object>();long seq=0;var times=new List<double>();
            foreach(var position in new[]{70,71,73}){
                var clock=Stopwatch.StartNew();Volatile.Write(ref Scene.X,position);
                // No read/capture request while the source changes. Producer
                // must acquire the new texture independently of the consumer.
                var expected=frames.Count+1;while(Volatile.Read(ref Scene.Acquired)<expected&&clock.ElapsedMilliseconds<10000)Thread.Sleep(10);
                JsonElement view=default;var found=false;
                while(clock.ElapsedMilliseconds<10000){view=JsonSerializer.SerializeToElement(producer.Read(seq,500));if(view.GetProperty("state").GetString()=="changed"){found=true;break;}}
                if(!found)throw new InvalidOperationException("fixture_background_capture_missing");
                var image=view.GetProperty("image");using var stream=new MemoryStream(Convert.FromBase64String(image.GetProperty("data").GetString()!));using var bitmap=new Bitmap(stream);
                var localX=position-32;
                for(var y=0;y<96;y++)for(var x=0;x<128;x++)if(bitmap.GetPixel(x,y).ToArgb()!=(x==localX?Color.Red:Color.White).ToArgb())throw new InvalidOperationException("fixture_precision_pixel_mismatch");
                seq=view.GetProperty("sourceSeq").GetInt64();times.Add(clock.Elapsed.TotalMilliseconds);frames.Add(new{position,expectedImageX=localX,frame=view});
            }
            var unchanged=JsonSerializer.SerializeToElement(producer.Read(seq,100));if(unchanged.GetProperty("state").GetString()!="no_change"||unchanged.GetProperty("image").ValueKind!=JsonValueKind.Null)throw new InvalidOperationException("fixture_no_change_failed");
            Volatile.Write(ref allowed,false);try{producer.Read(0,0);throw new Exception("fixture_revoked_read_accepted");}catch(InvalidOperationException error)when(error.Message=="fixture_authority_closed"){}
            producer.Dispose();var drain=Stopwatch.StartNew();while(Volatile.Read(ref Scene.Disposed)==0&&drain.ElapsedMilliseconds<3000)Thread.Sleep(10);if(Scene.Disposed!=1)throw new InvalidOperationException("fixture_gpu_cleanup_pending");
            // Also exercise production DXGI acquisition without substituting GDI.
            string actualDxgi;using(var visual=new VisualSessionManager()){
                var a=JsonSerializer.SerializeToElement(visual.Attach(leaseMs:1000));var id=a.GetProperty("visualSessionId").GetString()!;var token=a.GetProperty("leaseToken").GetString()!;
                var start=JsonSerializer.SerializeToElement(visual.ObservationStart(id,token,"precision",15,new Rectangle(0,0,128,96)));var obs=start.GetProperty("observationId").GetString()!;
                var read=JsonSerializer.SerializeToElement(visual.ObservationRead(id,token,obs,0,600));var o=read.GetProperty("observation");actualDxgi=o.GetProperty("state").GetString()=="changed"?"DXGI_CAPTURED_UNVERIFIED_DESKTOP_PIXELS":"UNAVAILABLE_"+o.GetProperty("reason").GetString();
                Thread.Sleep(1200);try{visual.ObservationRead(id,token,obs,0,0);throw new Exception("fixture_background_renewed_lease");}catch(InvalidOperationException error)when(error.Message is "visual_lease_expired" or "visual_session_missing"){}
                // Legacy fresh screenshot still works independently.
                _=DesktopVisual.Capture(0,160,90,25);
            }
            File.WriteAllText(output,JsonSerializer.Serialize(new {result="PASS",scope="isolated_synthetic_warp_gpu_not_owner_physical",sameProductionProducer=true,backgroundCapture=true,precisionPixelParity=true,oneAndTwoPixelChanges=true,noChange=true,closedReadDenied=true,backgroundDoesNotRenewLease=true,legacyScreenshotPreserved=true,gpuResourcesDisposed=true,actualDxgi,changeToReadMs=times,frames}));return true;
        }catch(Exception error){File.WriteAllText(output,JsonSerializer.Serialize(new{result="FAIL",error=error.Message,hresult=error.HResult}));return false;}
    }
}
