using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace GptOperator.RealRemoteV2;

internal static class H264Fixture
{
    internal static bool Write(string output)
    {
        if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true")return false;
        var ok=false;var thread=new Thread(()=>{
            var hr=CoInitializeEx(0,0);
            try {
                Marshal.ThrowExceptionForHR(hr);
                var rows=new List<object>();var timings=new List<double>();
                foreach(var preferHardware in new[]{false,true}) {
                    using var encoder=new H264Encoder(128,96,15,preferHardware);
                    for(var i=0;i<8;i++) {
                        using var bitmap=new Bitmap(128,96,PixelFormat.Format24bppRgb);
                        var color=i%2==0?Color.Red:Color.Blue;
                        using(var graphics=Graphics.FromImage(bitmap)){graphics.Clear(color);graphics.FillRectangle(Brushes.Lime,50+i,40,20,16);}
                        var clock=Stopwatch.StartNew();var packet=encoder.Encode(bitmap,()=>{});timings.Add(clock.Elapsed.TotalMilliseconds);
                        rows.Add(new {mime="video/h264",format="annexb",codec=packet.Codec,keyFrame=packet.KeyFrame,timestampUs=packet.TimestampUs,width=128,height=96,dataBytes=packet.Bytes.Length,data=Convert.ToBase64String(packet.Bytes),hardwareEncoding=packet.Hardware,encoderBackend=packet.Backend,preferHardware,expectedColor=i%2==0?"red":"blue"});
                    }
                }
                File.WriteAllText(output,JsonSerializer.Serialize(new {result="ENCODED_BROWSER_DECODE_REQUIRED",scope="synthetic_ci_pixels_not_owner_screen",frames=rows,encodeMs=timings,hardwarePhysical="NOT_RUN"}));ok=true;
            }catch(Exception error){File.WriteAllText(output,JsonSerializer.Serialize(new {result="FAIL",stage="native_h264_encode",error=error.Message,hresult=error.HResult}));}
            finally{if(hr>=0)CoUninitialize();}
        });
        thread.SetApartmentState(ApartmentState.MTA);thread.Start();thread.Join();return ok;
    }
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("ole32.dll",ExactSpelling=true)] private static extern int CoInitializeEx(nint reserved,uint flags);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("ole32.dll",ExactSpelling=true)] private static extern void CoUninitialize();
}
