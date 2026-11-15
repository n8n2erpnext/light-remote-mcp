using System.Drawing;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace GptOperator.RealRemoteV2;

// Separate source instance: legacy JPEG/DXGI fallback and its resource owner do
// not change. A normal DXGI no-update timeout never invokes GDI here.
internal interface IObservationCapture:IDisposable {string Copy(Bitmap output,string name,Rectangle screen,Rectangle crop,string topology,bool first);}
internal sealed unsafe class ObservationCapture:IObservationCapture
{
    private ID3D11Device? _device;private ID3D11DeviceContext? _context;private IDXGIOutputDuplication? _duplication;private GpuFrameScaler? _scaler;
    public string Copy(Bitmap output,string name,Rectangle screen,Rectangle crop,string topology,bool first)
    {
        if(topology!=DesktopVisual.ReadTopologyId())throw new InvalidOperationException("observation_topology_changed");
        if(_duplication is null)Initialize(name,screen);
        var result=_duplication!.AcquireNextFrame(16,out _,out var resource);
        if(result.Code==unchecked((int)0x887A0027)){resource?.Dispose();return "idle";}
        if(result.Failure){resource?.Dispose();throw new InvalidOperationException("observation_dxgi_unavailable_"+result.Code.ToString("x8"));}
        try{using(resource){var local=new Rectangle(crop.X-screen.X,crop.Y-screen.Y,crop.Width,crop.Height);if(!first&&!Touches(local))return "idle";using var texture=resource.QueryInterface<ID3D11Texture2D>();var desc=texture.Description;if(desc.Format!=Format.B8G8R8A8_UNorm||desc.Width!=screen.Width||desc.Height!=screen.Height)throw new InvalidOperationException("observation_surface_changed");_scaler!.Copy(texture,local,output);return "frame";}}
        finally{_duplication.ReleaseFrame().CheckError();}
    }
    private bool Touches(Rectangle roi)
    {
        // Windows SDK IDXGIOutputDuplication ABI: slots9/10. The acquired
        // surface is already complete; metadata only skips unrelated ROI work,
        // not a reconstruction dependency. Overflow/error means copy safely.
        var pointer=_duplication!.NativePointer;var table=*(nint**)pointer;uint count=0;
        var dirty=stackalloc Rect[256];var hr=((delegate* unmanaged[Stdcall]<nint,uint,Rect*,uint*,int>)table[9])(pointer,4096,dirty,&count);
        if(hr<0||count>4096||count%16!=0)return true;
        for(var i=0;i<count/16;i++)if(roi.IntersectsWith(dirty[i].Box))return true;
        var moves=stackalloc Move[256];count=0;hr=((delegate* unmanaged[Stdcall]<nint,uint,Move*,uint*,int>)table[10])(pointer,6144,moves,&count);
        if(hr<0||count>6144||count%24!=0)return true;
        for(var i=0;i<count/24;i++){var box=moves[i].Destination.Box;if(roi.IntersectsWith(box)||roi.IntersectsWith(new Rectangle(moves[i].X,moves[i].Y,box.Width,box.Height)))return true;}
        return false;
    }
    private void Initialize(string name,Rectangle bounds)
    {
        if((long)bounds.Width*bounds.Height>16*1024*1024)throw new InvalidOperationException("observation_source_budget");
        using var factory=DXGI.CreateDXGIFactory1<IDXGIFactory1>();
        for(uint a=0;a<32;a++){
            var found=factory.EnumAdapters1(a,out var adapter);if(found.Failure){adapter?.Dispose();break;}
            using(adapter)for(uint o=0;o<32;o++){
                var enumerated=adapter.EnumOutputs(o,out var target);if(enumerated.Failure){target?.Dispose();break;}
                using(target){var desc=target.Description;if(!String.Equals(desc.DeviceName,name,StringComparison.OrdinalIgnoreCase))continue;var r=desc.DesktopCoordinates;if(!desc.AttachedToDesktop||desc.Rotation!=ModeRotation.Identity||r.Left!=bounds.Left||r.Top!=bounds.Top||r.Right!=bounds.Right||r.Bottom!=bounds.Bottom)throw new InvalidOperationException("observation_output_transform_unsupported");
                    D3D11.D3D11CreateDevice(adapter,DriverType.Unknown,DeviceCreationFlags.BgraSupport,new[]{FeatureLevel.Level_11_0},out ID3D11Device device,out ID3D11DeviceContext context).CheckError();_device=device;_context=context;using var output=target.QueryInterface<IDXGIOutput1>();_duplication=output.DuplicateOutput(device);_scaler=new GpuFrameScaler(device,context);return;}
            }
        }
        throw new InvalidOperationException("observation_exact_output_missing");
    }
    public void Dispose(){_scaler?.Dispose();_duplication?.Dispose();_context?.Dispose();_device?.Dispose();_scaler=null;_duplication=null;_context=null;_device=null;}
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]private struct Rect{public int Left,Top,Right,Bottom;public Rectangle Box=>Rectangle.FromLTRB(Left,Top,Right,Bottom);}
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]private struct Move{public int X,Y;public Rect Destination;}
}
