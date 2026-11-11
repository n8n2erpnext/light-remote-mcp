using System.Runtime.InteropServices;

namespace GptOperator.RealRemoteV2;

// Compatibility recovery only. Normal startup, viewing, input and shutdown
// never change the OS cursor scheme. No cursor-install API exists here.
internal static class SystemCursorOverride
{
    public static bool IsActive => false;
    public static bool ForceRestore() => SystemParametersInfo(0x0057,0,IntPtr.Zero,0);
    internal static bool SelfTest() => !IsActive;
    [DllImport("user32.dll",SetLastError=true)]
    private static extern bool SystemParametersInfo(uint action,uint param,IntPtr value,uint flags);
}
