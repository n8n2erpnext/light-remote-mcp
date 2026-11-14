using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace GptOperator.RealRemoteV2;

internal sealed record H264Packet(byte[] Bytes,string Codec,bool KeyFrame,long TimestampUs,bool Hardware,string Backend);

// Windows SDK Media Foundation/ICodecAPI ABI; no external encoder executable,
// DLL download, disk recording or proprietary driver dependency. Owned solely
// by the bounded capture lane and disposed with the authorized visual scope.
internal sealed unsafe class H264Encoder:IDisposable
{
    internal const int MaxPacketBytes=650*1024;
    private nint _transform,_events,_activation;
    private bool _started,_async,_needInput,_haveOutput;
    private long _sequence;
    private byte[]? _sps,_pps;
    private readonly int _width,_height,_fps;
    public bool Hardware {get;private set;}
    public string Backend=>Hardware?"media-foundation-hardware":"media-foundation-software";
    public string HardwareFallback {get;private set;}="";
    private static readonly Guid TransformId=new("bf94c121-5b05-4e6f-8000-ba598961414d"),EventGeneratorId=new("2cd0bd52-bcd5-4b89-b62c-eadc0c031e7d");
    private static readonly Guid Major=new("48eba18e-f8c9-4687-bf11-0a74c9f96a8f"),Subtype=new("f7e34c9a-42e8-4714-b74b-cb29d72c35e5");
    private static readonly Guid Video=new("73646976-0000-0010-8000-00aa00389b71"),Nv12=new("3231564e-0000-0010-8000-00aa00389b71"),H264=new("34363248-0000-0010-8000-00aa00389b71");
    private const int NeedMoreInput=unchecked((int)0xc00d6d72);
    public H264Encoder(int width,int height,int fps,bool preferHardware=true)
    {
        if(width<2||height<2||width>1280||height>720||(width&1)!=0||(height&1)!=0||fps<1||fps>30)throw new InvalidOperationException("video_geometry_or_rate_invalid");
        _width=width;_height=height;_fps=fps;
        Check(MFStartup(0x20070,0));_started=true;
        try {
            if(preferHardware)TryHardware();
            if(_transform==0) {
                var cls=new Guid("6ca50344-051a-4ded-9779-a43305165e35");var iid=TransformId;
                Check(CoCreateInstance(ref cls,0,1,ref iid,out _transform));Configure();
            }
        }catch{Dispose();throw;}
    }
    private void TryHardware()
    {
        var category=new Guid("f79eac7d-e545-4387-bdee-d647d7bde42a");var input=new RegisterType{Major=Video,Subtype=Nv12};var output=new RegisterType{Major=Video,Subtype=H264};
        nint array=0;uint count=0;
        try {
            Check(MFTEnumEx(category,0x44,ref input,ref output,out array,out count));
            for(uint i=0;i<Math.Min(count,4);i++) {
                var activate=Marshal.ReadIntPtr(array,checked((int)i*IntPtr.Size));nint transform=0;
                try {
                    var iid=TransformId;
                    Check(((delegate* unmanaged[Stdcall]<nint,Guid*,nint*,int>)V(activate,33))(activate,&iid,&transform));
                    _transform=transform;_activation=activate;Marshal.AddRef(activate);Hardware=true;Configure();return;
                }catch(Exception error)when(error is not OutOfMemoryException) {
                    HardwareFallback="hardware_init_"+error.HResult.ToString("x8");ClearTransform();Hardware=false;
                }
            }
            if(HardwareFallback.Length==0)HardwareFallback=count==0?"no_hardware_h264_encoder":"hardware_system_memory_nv12_unavailable";
        }catch(Exception error)when(error is not OutOfMemoryException){HardwareFallback="hardware_enum_"+error.HResult.ToString("x8");}
        finally {
            if(array!=0){for(uint i=0;i<count;i++){var item=Marshal.ReadIntPtr(array,checked((int)i*IntPtr.Size));if(item!=0)Marshal.Release(item);}Marshal.FreeCoTaskMem(array);}
        }
    }
    private void Configure()
    {
        nint attributes=0;
        try {
            if(((delegate* unmanaged[Stdcall]<nint,nint*,int>)V(_transform,8))(_transform,&attributes)>=0&&attributes!=0) {
                _async=GetUInt(attributes,new("f81a699a-649a-497d-8c73-29f8fed6ad7a"))!=0;
                if(_async){SetUInt(attributes,new("e5666d6b-3422-4eb6-a421-da7db1f8e207"),1);var iid=EventGeneratorId;Check(Marshal.QueryInterface(_transform,ref iid,out _events));}
                TryUInt(attributes,new("9c27891a-ed7a-40e1-88e8-b22727a024ee"),1);
            }
        }finally{Release(ref attributes);}
        nint outType=0,inType=0;
        try {
            outType=MediaType(H264);SetUInt(outType,new("20332624-fb0d-4d9e-bd0d-cbf6786c102e"),(uint)Math.Clamp(_width*_height*_fps/3,250000,8000000));
            SetUInt(outType,new("ad76a80b-2d5c-4e0b-b375-64e520137036"),66); // H264 baseline, no B pictures.
            Check(((delegate* unmanaged[Stdcall]<nint,uint,nint,uint,int>)V(_transform,16))(_transform,0,outType,0));
            inType=MediaType(Nv12);
            Check(((delegate* unmanaged[Stdcall]<nint,uint,nint,uint,int>)V(_transform,15))(_transform,0,inType,0));
        }finally{Release(ref outType);Release(ref inType);}
        // Independent IDR frames make bounded latest-only relay/reconnect safe.
        // If a provider ignores GOP1, Encode rejects non-IDR output explicitly.
        CodecUInt(new("95f31b26-95a4-41aa-9303-246a7fc6eef1"),1);
        CodecUInt(new("8d390aac-dc5c-4200-b57f-814d04babab2"),0);
        CodecUInt(new("9c27891a-ed7a-40e1-88e8-b22727a024ee"),1,true);
        Message(0x10000000);Message(0x10000003);
    }
    private nint MediaType(Guid subtype)
    {
        Check(MFCreateMediaType(out var type));
        try {
            SetGuid(type,Major,Video);SetGuid(type,Subtype,subtype);
            SetUlong(type,new("1652c33d-d6b2-4012-b834-72030849a37d"),((ulong)_width<<32)|(uint)_height);
            SetUlong(type,new("c459a2e8-3d2c-4e44-b132-fee5156c7bb0"),((ulong)_fps<<32)|1);
            SetUlong(type,new("c6376a1e-8d0a-4027-be45-6d9a0ad39bb6"),(1ul<<32)|1);
            SetUInt(type,new("e2724bb8-e676-4806-b4b2-a8d6efb44ccd"),2);
            return type;
        }catch{Marshal.Release(type);throw;}
    }
    public H264Packet Encode(Bitmap bitmap,Action guard)
    {
        if(_transform==0||bitmap.Width!=_width||bitmap.Height!=_height)throw new InvalidOperationException("video_encoder_geometry_changed");
        guard();if(_async)WaitEvent(true,guard);
        CodecUInt(new("398c1b98-8353-475a-9ef2-8f265d260345"),1);
        var pixels=Nv12Pixels(bitmap);nint sample=0,buffer=0;
        var pts=checked(_sequence++*10_000_000/_fps);
        try {
            Check(MFCreateSample(out sample));Check(MFCreateMemoryBuffer((uint)pixels.Length,out buffer));
            WriteBuffer(buffer,pixels);
            Check(((delegate* unmanaged[Stdcall]<nint,nint,int>)V(sample,42))(sample,buffer));
            Check(((delegate* unmanaged[Stdcall]<nint,long,int>)V(sample,36))(sample,pts));
            Check(((delegate* unmanaged[Stdcall]<nint,long,int>)V(sample,38))(sample,10_000_000/_fps));
            guard();Check(((delegate* unmanaged[Stdcall]<nint,uint,nint,uint,int>)V(_transform,24))(_transform,0,sample,0));_needInput=false;
        }finally{Array.Clear(pixels);Release(ref sample);Release(ref buffer);}
        var clock=Stopwatch.StartNew();byte[]? bytes=null;
        do {
            guard();if(_async)WaitEvent(false,guard);
            bytes=ReadOutput();_haveOutput=false;
            if(bytes!=null)break;
            if(clock.ElapsedMilliseconds>1500)throw new InvalidOperationException("video_encoder_output_timeout");
            Thread.Sleep(2);
        }while(true);
        guard();
        var nal=AnnexBUnits(bytes);var sps=nal.FirstOrDefault(x=>(x[0]&31)==7);var pps=nal.FirstOrDefault(x=>(x[0]&31)==8);
        if(sps!=null)_sps=sps;if(pps!=null)_pps=pps;
        if(!nal.Any(x=>(x[0]&31)==5)||_sps is null||_sps.Length<4||_pps is null)
            throw new InvalidOperationException("video_encoder_independent_idr_headers_required");
        if(sps is null||pps is null) {
            var prefix=new List<byte>();if(sps is null){prefix.AddRange(new byte[]{0,0,0,1});prefix.AddRange(_sps);}if(pps is null){prefix.AddRange(new byte[]{0,0,0,1});prefix.AddRange(_pps);}
            if(prefix.Count+bytes.Length>MaxPacketBytes)throw new InvalidOperationException("video_packet_budget");
            prefix.AddRange(bytes);bytes=prefix.ToArray();
        }
        return new H264Packet(bytes,"avc1."+Convert.ToHexString(_sps.AsSpan(1,3)).ToLowerInvariant(),true,pts/10,Hardware,Backend);
    }
    private void WaitEvent(bool input,Action guard)
    {
        var clock=Stopwatch.StartNew();
        while(input?!_needInput:!_haveOutput) {
            guard();nint mediaEvent=0;
            try {
                var hr=((delegate* unmanaged[Stdcall]<nint,uint,nint*,int>)V(_events,3))(_events,1,&mediaEvent);
                if(hr>=0&&mediaEvent!=0) {
                    uint kind=0;Check(((delegate* unmanaged[Stdcall]<nint,uint*,int>)V(mediaEvent,33))(mediaEvent,&kind));
                    int status=0;Check(((delegate* unmanaged[Stdcall]<nint,int*,int>)V(mediaEvent,35))(mediaEvent,&status));Check(status);
                    if(kind==601)_needInput=true;else if(kind==602)_haveOutput=true;
                }else if(hr!=unchecked((int)0xc00d3e80))Check(hr); // MF_E_NO_EVENTS_AVAILABLE
            }finally{Release(ref mediaEvent);}
            if(clock.ElapsedMilliseconds>1500)throw new InvalidOperationException("video_encoder_async_event_timeout");
            Thread.Sleep(2);
        }
    }
    private byte[]? ReadOutput()
    {
        OutputInfo info=default;Check(((delegate* unmanaged[Stdcall]<nint,uint,OutputInfo*,int>)V(_transform,7))(_transform,0,&info));
        var allocation=Math.Max(info.Size,(uint)(_width*_height*3/2+4096));
        if(allocation>4*1024*1024)throw new InvalidOperationException("video_encoder_output_budget");
        nint supplied=0,buffer=0;var output=new OutputData();
        try {
            if((info.Flags&0x100)==0) {
                Check(MFCreateSample(out supplied));Check(MFCreateMemoryBuffer(allocation,out buffer));
                Check(((delegate* unmanaged[Stdcall]<nint,nint,int>)V(supplied,42))(supplied,buffer));output.Sample=supplied;
            }
            uint status=0;var hr=((delegate* unmanaged[Stdcall]<nint,uint,uint,OutputData*,uint*,int>)V(_transform,25))(_transform,0,1,&output,&status);
            if(hr==NeedMoreInput)return null;Check(hr);
            if(output.Sample==0)throw new InvalidOperationException("video_encoder_empty_sample");
            nint contiguous=0;
            try {Check(((delegate* unmanaged[Stdcall]<nint,nint*,int>)V(output.Sample,41))(output.Sample,&contiguous));return ReadBuffer(contiguous);}
            finally{Release(ref contiguous);}
        }finally{if(output.Events!=0)Marshal.Release(output.Events);if(output.Sample!=0&&output.Sample!=supplied)Marshal.Release(output.Sample);Release(ref supplied);Release(ref buffer);}
    }
    internal static List<byte[]> AnnexBUnits(byte[] data)
    {
        var units=new List<byte[]>();var starts=new List<(int Start,int Payload)>();
        for(var i=0;i<data.Length-3;i++)if(data[i]==0&&data[i+1]==0) {
            var prefix=data[i+2]==1?3:data[i+2]==0&&data[i+3]==1?4:0;
            if(prefix>0){starts.Add((i,i+prefix));i+=prefix-1;}
        }
        for(var i=0;i<starts.Count;i++){var end=i+1<starts.Count?starts[i+1].Start:data.Length;if(end>starts[i].Payload)units.Add(data[starts[i].Payload..end]);}
        return units;
    }
    internal static byte[] Nv12Pixels(Bitmap bitmap)
    {
        var w=bitmap.Width;var h=bitmap.Height;var data=new byte[checked(w*h*3/2)];
        var bits=bitmap.LockBits(new Rectangle(0,0,w,h),ImageLockMode.ReadOnly,PixelFormat.Format24bppRgb);
        try {
            for(var y=0;y<h;y++)for(var x=0;x<w;x++) {
                var p=(byte*)bits.Scan0+(long)y*bits.Stride+x*3;int b=p[0],g=p[1],r=p[2];
                data[y*w+x]=(byte)Math.Clamp(((66*r+129*g+25*b+128)>>8)+16,16,235);
            }
            for(var y=0;y<h;y+=2)for(var x=0;x<w;x+=2) {
                int r=0,g=0,b=0;for(var yy=0;yy<2;yy++)for(var xx=0;xx<2;xx++){var p=(byte*)bits.Scan0+(long)(y+yy)*bits.Stride+(x+xx)*3;b+=p[0];g+=p[1];r+=p[2];}
                r/=4;g/=4;b/=4;var i=w*h+(y/2)*w+x;
                data[i]=(byte)Math.Clamp(((-38*r-74*g+112*b+128)>>8)+128,16,240);
                data[i+1]=(byte)Math.Clamp(((112*r-94*g-18*b+128)>>8)+128,16,240);
            }
            return data;
        }finally{bitmap.UnlockBits(bits);}
    }
    private static byte[] ReadBuffer(nint buffer)
    {
        nint pointer=0;uint maximum=0,length=0;
        Check(((delegate* unmanaged[Stdcall]<nint,nint*,uint*,uint*,int>)V(buffer,3))(buffer,&pointer,&maximum,&length));
        try{if(length<1||length>MaxPacketBytes||length>maximum)throw new InvalidOperationException("video_packet_budget");var bytes=new byte[(int)length];Marshal.Copy(pointer,bytes,0,bytes.Length);return bytes;}
        finally{Check(((delegate* unmanaged[Stdcall]<nint,int>)V(buffer,4))(buffer));}
    }
    private static void WriteBuffer(nint buffer,byte[] data)
    {
        nint pointer=0;uint maximum=0,length=0;Check(((delegate* unmanaged[Stdcall]<nint,nint*,uint*,uint*,int>)V(buffer,3))(buffer,&pointer,&maximum,&length));
        try{if(maximum<data.Length)throw new InvalidOperationException("video_input_buffer_budget");Marshal.Copy(data,0,pointer,data.Length);}
        finally{Check(((delegate* unmanaged[Stdcall]<nint,int>)V(buffer,4))(buffer));}
        Check(((delegate* unmanaged[Stdcall]<nint,uint,int>)V(buffer,6))(buffer,(uint)data.Length));
    }
    private void CodecUInt(Guid key,uint value,bool boolean=false)
    {
        var iid=new Guid("901db4c7-31ce-41a2-85dc-8fa0bf41b8da");nint codec=0;
        if(Marshal.QueryInterface(_transform,ref iid,out codec)<0)return;
        try{var variant=new Variant{Type=(ushort)(boolean?11:19),Value=boolean?(value==0?0u:0xffffu):value};_ = ((delegate* unmanaged[Stdcall]<nint,Guid*,Variant*,int>)V(codec,9))(codec,&key,&variant);}
        finally{Release(ref codec);}
    }
    private void Message(uint value)=>Check(((delegate* unmanaged[Stdcall]<nint,uint,nuint,int>)V(_transform,23))(_transform,value,0));
    private static uint GetUInt(nint attributes,Guid key){uint value=0;return ((delegate* unmanaged[Stdcall]<nint,Guid*,uint*,int>)V(attributes,7))(attributes,&key,&value)>=0?value:0;}
    private static void SetUInt(nint attributes,Guid key,uint value)=>Check(((delegate* unmanaged[Stdcall]<nint,Guid*,uint,int>)V(attributes,21))(attributes,&key,value));
    private static void TryUInt(nint attributes,Guid key,uint value)=>_ = ((delegate* unmanaged[Stdcall]<nint,Guid*,uint,int>)V(attributes,21))(attributes,&key,value);
    private static void SetUlong(nint attributes,Guid key,ulong value)=>Check(((delegate* unmanaged[Stdcall]<nint,Guid*,ulong,int>)V(attributes,22))(attributes,&key,value));
    private static void SetGuid(nint attributes,Guid key,Guid value)=>Check(((delegate* unmanaged[Stdcall]<nint,Guid*,Guid*,int>)V(attributes,24))(attributes,&key,&value));
    private static nint V(nint instance,int slot)=>((nint*)*(nint*)instance)[slot];
    private static void Check(int hr){if(hr<0)Marshal.ThrowExceptionForHR(hr);}
    private static void Release(ref nint value){if(value!=0){Marshal.Release(value);value=0;}}
    private void ClearTransform()
    {
        if(_transform!=0){try{Message(0);Message(0x10000001);}catch{}}
        Release(ref _events);Release(ref _transform);
        if(_activation!=0){try{_ = ((delegate* unmanaged[Stdcall]<nint,int>)V(_activation,34))(_activation);}catch{}Release(ref _activation);}
        _async=_needInput=_haveOutput=false;
    }
    public void Dispose(){ClearTransform();if(_sps!=null)Array.Clear(_sps);if(_pps!=null)Array.Clear(_pps);_sps=_pps=null;if(_started){_ = MFShutdown();_started=false;}}
    [StructLayout(LayoutKind.Sequential)] private struct RegisterType{public Guid Major,Subtype;}
    [StructLayout(LayoutKind.Sequential)] private struct OutputInfo{public uint Flags,Size,Alignment;}
    [StructLayout(LayoutKind.Sequential)] private struct OutputData{public uint Stream;public nint Sample;public uint Status;public nint Events;}
    [StructLayout(LayoutKind.Explicit,Size=24)] private struct Variant{[FieldOffset(0)]public ushort Type;[FieldOffset(8)]public uint Value;}
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("mfplat.dll",ExactSpelling=true)] private static extern int MFStartup(uint version,uint flags);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("mfplat.dll",ExactSpelling=true)] private static extern int MFShutdown();
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("mfplat.dll",ExactSpelling=true)] private static extern int MFCreateMediaType(out nint value);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("mfplat.dll",ExactSpelling=true)] private static extern int MFCreateSample(out nint value);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("mfplat.dll",ExactSpelling=true)] private static extern int MFCreateMemoryBuffer(uint length,out nint value);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("mfplat.dll",ExactSpelling=true)] private static extern int MFTEnumEx(Guid category,uint flags,ref RegisterType input,ref RegisterType output,out nint activates,out uint count);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("ole32.dll",ExactSpelling=true)] private static extern int CoCreateInstance(ref Guid clsid,nint outer,uint context,ref Guid iid,out nint instance);
}
