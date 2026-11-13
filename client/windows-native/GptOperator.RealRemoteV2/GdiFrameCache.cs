using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace GptOperator.RealRemoteV2;

internal sealed record EncodedCapture(int Width,int Height,int Quality,int Bytes,string Sha256,string Data,
    bool EncodeReused,double CopyMs,double HashMs,double EncodeMs,long Captures,long Encodes);

// One bounded private entry. Every request copies CURRENT pixels before deciding
// whether JPEG/base64 can be reused. No timer, stale screenshot or global pool.
internal sealed class GdiFrameCache : IDisposable
{
    private static readonly ImageCodecInfo Jpeg=ImageCodecInfo.GetImageEncoders().First(c=>c.MimeType=="image/jpeg");
    private readonly object _gate=new();
    private Bitmap? _source,_output;
    private Graphics? _copyGraphics,_resizeGraphics;
    private string _key="",_pixelHash="";
    private byte[] _pixels=Array.Empty<byte>();
    private readonly MemoryStream _stream=new(128*1024);
    private EncodedCapture? _last;
    private long _captures,_encodes;
    private bool _disposed;
    public EncodedCapture Capture(string key,int width,int height,int outWidth,int outHeight,int quality,Action<Graphics> copy)
        =>CaptureBitmap(key,width,height,outWidth,outHeight,quality,(_,graphics)=>copy(graphics));
    public EncodedCapture CaptureBitmap(string key,int width,int height,int outWidth,int outHeight,int quality,Action<Bitmap,Graphics> copy)
    {
        lock(_gate) {
            ObjectDisposedException.ThrowIf(_disposed,this);
            if(width<1||height<1||(long)width*height>16*1024*1024||outWidth<1||outHeight<1||outWidth>1280||outHeight>720)
                throw new InvalidOperationException("frame_pixel_budget_exceeded");
            if(_key!=key) {
                Reset();_key=key;
                _source=new Bitmap(width,height,PixelFormat.Format24bppRgb);_copyGraphics=Graphics.FromImage(_source);
                _pixels=new byte[checked(width*height*3)];
                if(width!=outWidth||height!=outHeight) {
                    _output=new Bitmap(outWidth,outHeight,PixelFormat.Format24bppRgb);_resizeGraphics=Graphics.FromImage(_output);
                    _resizeGraphics.InterpolationMode=InterpolationMode.HighQualityBicubic;
                    _resizeGraphics.PixelOffsetMode=PixelOffsetMode.HighQuality;
                }
            }
            var clock=Stopwatch.StartNew();_copyGraphics!.Flush(FlushIntention.Sync);copy(_source!,_copyGraphics);_copyGraphics.Flush(FlushIntention.Sync);_captures++;
            var copyMs=clock.Elapsed.TotalMilliseconds;clock.Restart();
            var locked=_source!.LockBits(new Rectangle(0,0,width,height),ImageLockMode.ReadOnly,PixelFormat.Format24bppRgb);
            try {
                // Ignore row padding and handle negative stride explicitly.
                for(var y=0;y<height;y++)Marshal.Copy(locked.Scan0+y*locked.Stride,_pixels,y*width*3,width*3);
            } finally {_source.UnlockBits(locked);}
            var hash=Convert.ToHexString(SHA256.HashData(_pixels));var hashMs=clock.Elapsed.TotalMilliseconds;
            if(_last is not null&&hash==_pixelHash)return _last with {EncodeReused=true,CopyMs=copyMs,HashMs=hashMs,EncodeMs=0,Captures=_captures,Encodes=_encodes};
            clock.Restart();
            if(_output is not null)_resizeGraphics!.DrawImage(_source,new Rectangle(0,0,outWidth,outHeight),0,0,width,height,GraphicsUnit.Pixel);
            _resizeGraphics?.Flush(FlushIntention.Sync);
            var image=_output??_source!;byte[] bytes=Array.Empty<byte>();var appliedQuality=quality;
            for(var q=quality;q>=25;q-=5) {
                _stream.Position=0;_stream.SetLength(0);
                using var options=new EncoderParameters(1);options.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,(long)q);
                image.Save(_stream,Jpeg,options);appliedQuality=q;
                if(_stream.Length<=650*1024){bytes=_stream.ToArray();break;}
            }
            if(bytes.Length==0)throw new InvalidOperationException("frame_too_large");
            _encodes++;
            _last=new EncodedCapture(outWidth,outHeight,appliedQuality,bytes.Length,
                Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),Convert.ToBase64String(bytes),
                false,copyMs,hashMs,clock.Elapsed.TotalMilliseconds,_captures,_encodes);
            _pixelHash=hash;return _last;
        }
    }
    private void Reset()
    {
        _copyGraphics?.Dispose();_resizeGraphics?.Dispose();_source?.Dispose();_output?.Dispose();
        _copyGraphics=null;_resizeGraphics=null;_source=null;_output=null;
        Array.Clear(_pixels);_pixels=Array.Empty<byte>();_last=null;_pixelHash="";_key="";
    }
    public void Clear(){lock(_gate){if(_disposed)return;Reset();if(_stream.TryGetBuffer(out var b))Array.Clear(b.Array!);_stream.Position=0;_stream.SetLength(0);}}
    public void Dispose(){lock(_gate){if(_disposed)return;_disposed=true;Reset();if(_stream.TryGetBuffer(out var b))Array.Clear(b.Array!);_stream.Dispose();}}
    internal static bool SelfTest()
    {
        using var cache=new GdiFrameCache();
        var a=cache.Capture("odd-width",17,13,17,13,50,g=>g.Clear(Color.Red));
        var b=cache.Capture("odd-width",17,13,17,13,50,g=>g.Clear(Color.Red));
        var c=cache.Capture("odd-width",17,13,17,13,50,g=>g.Clear(Color.Blue));
        var d=cache.Capture("different-size",40,30,20,15,50,g=>g.Clear(Color.Blue));
        return !a.EncodeReused&&b.EncodeReused&&b.Encodes==1&&b.Captures==2&&a.Sha256==b.Sha256
            &&!c.EncodeReused&&c.Sha256!=b.Sha256&&d.Width==20&&d.Height==15&&!d.EncodeReused;
    }
}
