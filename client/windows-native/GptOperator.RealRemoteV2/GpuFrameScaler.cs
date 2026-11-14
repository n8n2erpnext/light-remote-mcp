using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace GptOperator.RealRemoteV2;

// D3D11 crop/bilinear resize BEFORE CPU readback. One bounded resource set,
// owned by the capture lane. RGBA UAV avoids unsupported BGRA typed stores.
internal sealed class GpuFrameScaler(ID3D11Device device,ID3D11DeviceContext context):IDisposable
{
    private ID3D11Texture2D? _source,_output,_readback;
    private ID3D11ShaderResourceView? _inputView;
    private ID3D11UnorderedAccessView? _outputView;
    private ID3D11ComputeShader? _shader;
    private ID3D11Buffer? _parameters;
    private string _geometry="";
    private const string Shader="""
        Texture2D<float4> source : register(t0);
        RWTexture2D<float4> target : register(u0);
        cbuffer Geometry : register(b0) { uint4 crop; uint2 outputSize; uint2 padding; };
        [numthreads(8,8,1)] void main(uint3 id:SV_DispatchThreadID) {
            if(any(id.xy>=outputSize)) return;
            float2 p=(float2(id.xy)+0.5)*float2(crop.zw)/float2(outputSize)-0.5;
            p=clamp(p,float2(0,0),float2(crop.zw)-1.0);
            uint2 a=uint2(floor(p)), b=min(a+1,crop.zw-1);
            float2 f=frac(p); uint2 origin=crop.xy;
            float4 top=lerp(source.Load(int3(origin+a,0)),source.Load(int3(origin+uint2(b.x,a.y),0)),f.x);
            float4 bottom=lerp(source.Load(int3(origin+uint2(a.x,b.y),0)),source.Load(int3(origin+b,0)),f.x);
            target[id.xy]=float4(lerp(top,bottom,f.y).rgb,1);
        }
        """;
    private void Ensure(int width,int height,int outWidth,int outHeight)
    {
        if(width<1||height<1||(long)width*height>16*1024*1024||outWidth<1||outHeight<1||outWidth>1280||outHeight>720)
            throw new InvalidOperationException("gpu_resize_pixel_budget");
        var key=$"{width}:{height}:{outWidth}:{outHeight}";if(_geometry==key)return;
        Dispose();
        try {
            _shader=device.CreateComputeShader(CompileShader());
            _parameters=device.CreateBuffer(new BufferDescription {ByteWidth=32,BindFlags=BindFlags.ConstantBuffer,Usage=ResourceUsage.Default});
            _source=device.CreateTexture2D(new Texture2DDescription(Format.B8G8R8A8_UNorm,(uint)width,(uint)height,mipLevels:1,bindFlags:BindFlags.ShaderResource));
            _inputView=device.CreateShaderResourceView(_source);
            _output=device.CreateTexture2D(new Texture2DDescription(Format.R8G8B8A8_UNorm,(uint)outWidth,(uint)outHeight,mipLevels:1,bindFlags:BindFlags.UnorderedAccess));
            _outputView=device.CreateUnorderedAccessView(_output);
            _readback=device.CreateTexture2D(new Texture2DDescription(Format.R8G8B8A8_UNorm,(uint)outWidth,(uint)outHeight,mipLevels:1,bindFlags:BindFlags.None,usage:ResourceUsage.Staging,cpuAccessFlags:CpuAccessFlags.Read));
            _geometry=key;
        }catch{Dispose();throw;}
    }
    public void Copy(ID3D11Texture2D texture,Rectangle crop,Bitmap destination)
    {
        var desc=texture.Description;
        if(desc.Format!=Format.B8G8R8A8_UNorm||crop.X<0||crop.Y<0||crop.Width<1||crop.Height<1||crop.Right>desc.Width||crop.Bottom>desc.Height)
            throw new InvalidOperationException("gpu_resize_source_geometry");
        Ensure((int)desc.Width,(int)desc.Height,destination.Width,destination.Height);
        context.CopyResource(_source!,texture);
        uint[] geometry={(uint)crop.X,(uint)crop.Y,(uint)crop.Width,(uint)crop.Height,(uint)destination.Width,(uint)destination.Height,0,0};
        context.UpdateSubresource<uint>(geometry.AsSpan(),_parameters!);
        context.CSSetShader(_shader);context.CSSetConstantBuffer(0,_parameters);
        context.CSSetShaderResource(0,_inputView);context.CSSetUnorderedAccessView(0,_outputView);
        try{context.Dispatch((uint)(destination.Width+7)/8,(uint)(destination.Height+7)/8,1);}
        finally {context.CSSetUnorderedAccessView(0,null);context.CSUnsetShaderResource(0);context.CSSetConstantBuffer(0,null);context.CSSetShader(null);}
        context.CopyResource(_readback!,_output!);
        var mapped=context.Map(_readback!,0,MapMode.Read);
        try {
            if(mapped.DataPointer==0||mapped.RowPitch<(long)destination.Width*4)throw new InvalidOperationException("gpu_resize_readback_pitch");
            var bits=destination.LockBits(new Rectangle(0,0,destination.Width,destination.Height),ImageLockMode.WriteOnly,PixelFormat.Format24bppRgb);
            try{CopyRgbaToBgr(mapped.DataPointer,checked((int)mapped.RowPitch),bits.Scan0,bits.Stride,destination.Width,destination.Height);}
            finally{destination.UnlockBits(bits);}
        }finally{context.Unmap(_readback!,0);}
    }
    private static unsafe void CopyRgbaToBgr(nint source,int rowPitch,nint destination,int stride,int width,int height)
    {
        if(rowPitch<(long)width*4||Math.Abs((long)stride)<(long)width*3)throw new InvalidOperationException("gpu_resize_copy_pitch");
        for(var y=0;y<height;y++) {
            var input=(byte*)source+(long)y*rowPitch;var target=(byte*)destination+(long)y*stride;
            for(var x=0;x<width;x++){target[x*3]=input[x*4+2];target[x*3+1]=input[x*4+1];target[x*3+2]=input[x*4];}
        }
    }
    private static unsafe byte[] CompileShader()
    {
        var source=Encoding.UTF8.GetBytes(Shader);nint code=0,errors=0;
        try {
            var hr=D3DCompile(source,(nuint)source.Length,0,0,0,"main","cs_5_0",1u<<15,0,out code,out errors);
            if(hr<0||code==0)throw new InvalidOperationException("gpu_resize_shader_compile",Marshal.GetExceptionForHR(hr));
            var table=*(nint**)code;
            var pointer=((delegate* unmanaged[Stdcall]<nint,nint>)table[3])(code);
            var length=((delegate* unmanaged[Stdcall]<nint,nuint>)table[4])(code);
            if(length<1||length>1024*1024)throw new InvalidOperationException("gpu_resize_shader_size");
            var bytes=new byte[(int)length];Marshal.Copy(pointer,bytes,0,bytes.Length);return bytes;
        }finally{if(errors!=0)Marshal.Release(errors);if(code!=0)Marshal.Release(code);}
    }
    public void Dispose()
    {
        _inputView?.Dispose();_outputView?.Dispose();_source?.Dispose();_output?.Dispose();_readback?.Dispose();_parameters?.Dispose();_shader?.Dispose();
        _inputView=null;_outputView=null;_source=null;_output=null;_readback=null;_parameters=null;_shader=null;_geometry="";
    }
    internal static bool SelfTest()
    {
        // Actual shader dispatch and CPU readback on Windows WARP. This proves
        // crop/resize/pitch/channel math, not physical GPU speed or DDA support.
        D3D11.D3D11CreateDevice((IDXGIAdapter?)null,DriverType.Warp,DeviceCreationFlags.BgraSupport,
            new[]{FeatureLevel.Level_11_0},out ID3D11Device device,out ID3D11DeviceContext context).CheckError();
        using(device)using(context)using(var scaler=new GpuFrameScaler(device,context)) {
            using var source=device.CreateTexture2D(new Texture2DDescription(Format.B8G8R8A8_UNorm,64,32,mipLevels:1,bindFlags:BindFlags.ShaderResource));
            var pixels=new byte[64*32*4];
            for(var y=0;y<32;y++)for(var x=0;x<64;x++){var i=(y*64+x)*4;pixels[i]=(byte)(x<32?0:255);pixels[i+2]=(byte)(x<32?255:0);pixels[i+3]=255;}
            context.UpdateSubresource<byte>(pixels.AsSpan(),source,0,64*4);
            using var result=new Bitmap(16,8,PixelFormat.Format24bppRgb);
            scaler.Copy(source,new Rectangle(16,8,32,16),result);
            var left=result.GetPixel(1,1);var right=result.GetPixel(14,6);
            if(left.R<250||left.B>5||right.B<250||right.R>5)return false;
            using var changed=new Bitmap(9,7,PixelFormat.Format24bppRgb);
            scaler.Copy(source,new Rectangle(32,0,16,16),changed);
            return changed.GetPixel(0,0).B>=250&&changed.GetPixel(8,6).B>=250;
        }
    }
    [DllImport("d3dcompiler_47.dll",CharSet=CharSet.Ansi,ExactSpelling=true)] private static extern int D3DCompile(byte[] source,nuint size,nint name,nint defines,nint include,string entry,string target,uint flags,uint effectFlags,out nint code,out nint errors);
}
