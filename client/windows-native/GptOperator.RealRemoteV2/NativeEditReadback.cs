using System.Runtime.InteropServices;
using System.Text;

namespace GptOperator.RealRemoteV2;

// Read-only system messages are marshalled by User32 across process boundaries.
// No target-memory allocation, selection changes, clipboard or text mutation.
// Older Rich Edit providers may truncate WM_GETTEXT above64K. A truncated or
// changing read NEVER verifies: both lengths, copied count and the full payload
// must agree. Unsupported controls retain the existing UIA path at bind time.
internal static class NativeEditReadback
{
    internal static bool Supported(string name)=>name.Equals("Edit",StringComparison.OrdinalIgnoreCase)
        ||name.Equals("RICHEDIT50W",StringComparison.OrdinalIgnoreCase)
        ||name.StartsWith("WindowsForms10.Edit.",StringComparison.OrdinalIgnoreCase)
        ||name.StartsWith("WindowsForms10.RICHEDIT50W.",StringComparison.OrdinalIgnoreCase);
    internal static string ClassName(nint hwnd)
    {
        var value=new StringBuilder(256);
        return GetClassName(hwnd,value,value.Capacity)>0?value.ToString():"";
    }
    internal static bool Eligible(nint hwnd,string name)
    {
        if(hwnd==0||!Supported(name)||!IsWindowUnicode(hwnd)||!IsWindowEnabled(hwnd))return false;
        const uint password=0x0020,readOnly=0x0800;
        return (GetWindowLong(hwnd,-16)&(password|readOnly))==0;
    }
    internal static bool TryRead(nint hwnd,int maximum,out string text)
    {
        text="";
        if(maximum<1||maximum>20*1024*1024)return false;
        if(!Length(hwnd,out var before)||before<0||before>=maximum)return false;
        // A spare character makes a concurrently growing document detectable.
        var capacity=Math.Min(maximum+1,checked((int)before+2));var value=new StringBuilder(capacity);
        if(SendText(hwnd,0x000D,(nuint)capacity,value,0x23,150,out var copied)==0)return false;
        if(!Length(hwnd,out var after))return false;
        var result=value.ToString();
        if(!Consistent(before,after,(long)copied,result.Length,capacity))return false;
        text=result;return true;
    }
    private static bool Length(nint hwnd,out long length)
    {
        var ok=SendValue(hwnd,0x000E,0,0,0x23,150,out var value)!=0;
        length=unchecked((long)value);return ok;
    }
    private static bool Consistent(long before,long after,long copied,int actual,int capacity)
        =>before==after&&copied==actual&&actual==before&&actual<capacity-1;
    internal static bool SelfTest()=>Supported("Edit")&&Supported("WindowsForms10.RICHEDIT50W.app.0.test")
        &&!Supported("RichEdit20W")&&!Supported("Chrome_RenderWidgetHostHWND")
        &&Consistent(0,0,0,0,2)&&Consistent(262144,262144,262144,262144,262146)
        &&!Consistent(262144,262144,65535,65535,262146)
        &&!Consistent(255,256,255,255,257)&&!Consistent(255,255,254,254,257)
        &&!Consistent(256,256,256,256,257);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="GetClassNameW")] private static extern int GetClassName(nint hwnd,StringBuilder value,int maximum);
    [DllImport("user32.dll",EntryPoint="GetWindowLongW")] private static extern uint GetWindowLong(nint hwnd,int index);
    [DllImport("user32.dll")] private static extern bool IsWindowUnicode(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(nint hwnd);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageTimeoutW",SetLastError=true)] private static extern nint SendText(nint hwnd,uint message,nuint wparam,StringBuilder text,uint flags,uint timeout,out nuint result);
    [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",SetLastError=true)] private static extern nint SendValue(nint hwnd,uint message,nuint wparam,nint parameter,uint flags,uint timeout,out nuint result);
}
