using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Diagnostics;

namespace GptOperator.RealRemoteV2;

// Pull-based video, one capture/encode in flight on the existing capture lane.
// No autonomous screen polling: idle cleanup cannot be held alive by a viewer.
// The caller checks the current visual lease both before/after all screen work.
internal sealed class DesktopVideo:IDisposable
{
    private Bitmap? _source,_output;
    private H264Encoder? _encoder;
    private string _key="";
    private long _frames;
    private bool _hardwareFailed;
    internal bool Active=>_encoder is not null;
    public object Capture(string scope,int screenIndex,int maxWidth,int maxHeight,Rectangle? region,int fps,bool preferHardware,bool preferGpuCapture,DxgiCapture dxgi,Action guard)
    {
        guard();var screen=Screen.AllScreens[screenIndex];var crop=DesktopVisual.Crop(screen.Bounds,region);
        var topology=DesktopVisual.ReadTopologyId();var clock=Stopwatch.StartNew();var at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var scale=Math.Min(1d,Math.Min((double)maxWidth/crop.Width,(double)maxHeight/crop.Height));
        var width=Math.Max(2,((int)(crop.Width*scale))&~1);var height=Math.Max(2,((int)(crop.Height*scale))&~1);
        var key=$"{scope}:{topology}:{crop}:{width}:{height}:{fps}:{preferHardware}:{preferGpuCapture}";
        if(_key!=key){Dispose();_key=key;_output=new Bitmap(width,height,PixelFormat.Format24bppRgb);_hardwareFailed=false;}
        var backend="gdi";var fallback="";
        if(preferGpuCapture&&dxgi.TryCopy(_output!,screen.DeviceName,screen.Bounds,crop,topology,out fallback))backend="dxgi-d3d11";
        else {
            if(_source==null||_source.Width!=crop.Width||_source.Height!=crop.Height){_source?.Dispose();_source=new Bitmap(crop.Width,crop.Height,PixelFormat.Format24bppRgb);}
            using(var graphics=Graphics.FromImage(_source))graphics.CopyFromScreen(crop.X,crop.Y,0,0,crop.Size,CopyPixelOperation.SourceCopy);
            using(var graphics=Graphics.FromImage(_output!)){graphics.InterpolationMode=InterpolationMode.HighQualityBilinear;graphics.DrawImage(_source,new Rectangle(0,0,width,height));}
        }
        guard();if(topology!=DesktopVisual.ReadTopologyId())throw new InvalidOperationException("display_topology_changed_during_video");
        var copyMs=clock.Elapsed.TotalMilliseconds;clock.Restart();H264Packet packet;var encoderFallback="";
        _encoder??=new H264Encoder(width,height,fps,preferHardware&&!_hardwareFailed);
        try{packet=_encoder.Encode(_output!,guard);}
        catch(Exception error)when(_encoder.Hardware&&error is not OutOfMemoryException) {
            guard();
            // Re-encoding captured read-only pixels is safe; no input is replayed.
            _hardwareFailed=true;encoderFallback="hardware_encode_"+error.HResult.ToString("x8");_encoder.Dispose();_encoder=new H264Encoder(width,height,fps,false);packet=_encoder.Encode(_output!,guard);
        }
        guard();if(topology!=DesktopVisual.ReadTopologyId())throw new InvalidOperationException("display_topology_changed_during_video");
        return new {mime="video/h264",format="annexb",codec=packet.Codec,keyFrame=packet.KeyFrame,timestampUs=packet.TimestampUs,
            width,height,fps,sequence=++_frames,capturedAt=at,displayTopologyId=topology,
            bounds=new {x=crop.X,y=crop.Y,width=crop.Width,height=crop.Height},
            inputMapping=new {xOffset=crop.X,yOffset=crop.Y,xScale=(double)crop.Width/width,yScale=(double)crop.Height/height,coordinateConvention="frame-pixel-centers-to-physical-virtual-no-extra-dpi"},
            captureBackend=backend,gpuCaptureRequested=preferGpuCapture,gpuResize=backend=="dxgi-d3d11",readbackPixels=backend=="dxgi-d3d11"?width*height:crop.Width*crop.Height,
            encoderBackend=packet.Backend,hardwareEncoding=packet.Hardware,hardwareRequested=preferHardware,encoderFallback=encoderFallback.Length>0?encoderFallback:_encoder.HardwareFallback,
            captureFallback=fallback.Length>0?fallback:null,nv12Conversion="cpu-bt601-limited",zeroCopy=false,
            timing=new {captureMs=copyMs,encodeMs=clock.Elapsed.TotalMilliseconds},dataBytes=packet.Bytes.Length,data=Convert.ToBase64String(packet.Bytes),
            queuePolicy="one-pull-one-independent-idr-no-backlog",storedOnDisk=false};
    }
    public void Dispose(){_source?.Dispose();_output?.Dispose();_encoder?.Dispose();_source=null;_output=null;_encoder=null;_key="";_frames=0;}
}
