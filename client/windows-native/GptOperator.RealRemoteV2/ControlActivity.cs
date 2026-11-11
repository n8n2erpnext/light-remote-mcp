using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace GptOperator.RealRemoteV2;

// Hooks only observe input metadata; they never suppress Owner input or retain keys/text.
// Other injected input is not classified as physical Owner input. Our packets carry a marker.
internal sealed class ControlActivity : IDisposable
{
    internal static readonly nint InputMarker = (nint)0x4C524D32;
    private delegate nint HookProc(int code,nint message,nint data);
    private readonly HookProc _mouseCallback,_keyboardCallback;
    private nint _mouseHook,_keyboardHook;
    private long _generation,_startedGeneration,_lastLocalAt,_until;
    private long _desktopCheckedAt;
    private int _running,_paused,_locked,_disposed;
    private string _pauseReason="idle";
    private readonly object _targetGate=new();
    private System.Drawing.Rectangle? _screen;
    public System.Drawing.Rectangle? TargetScreen { get { lock(_targetGate)return _screen; } set { lock(_targetGate)_screen=value; } }
    public event Action? Changed;
    public bool Available => _mouseHook!=0 && _keyboardHook!=0;
    public bool Active => Volatile.Read(ref _disposed)==0 && Volatile.Read(ref _paused)==0
        && Volatile.Read(ref _locked)==0 && Environment.TickCount64<Volatile.Read(ref _until);
    public string State => Volatile.Read(ref _disposed)!=0?"disconnected":Volatile.Read(ref _paused)!=0?_pauseReason:Active?"controlling":"idle";

    public ControlActivity():this(true) {}
    private ControlActivity(bool installHooks)
    {
        _mouseCallback=OnMouse; _keyboardCallback=OnKeyboard;
        if(!installHooks)return;
        _mouseHook=SetWindowsHookEx(14,_mouseCallback,GetModuleHandle(null),0);
        _keyboardHook=SetWindowsHookEx(13,_keyboardCallback,GetModuleHandle(null),0);
        SystemEvents.SessionSwitch+=OnSessionSwitch;
    }
    public void Begin()
    {
        if(!Available)throw new InvalidOperationException("local_input_monitor_unavailable");
        if(Volatile.Read(ref _disposed)!=0 || Volatile.Read(ref _locked)!=0 || !InputDesktopAvailable())
            throw new InvalidOperationException("input_desktop_unavailable");
        if(Environment.TickCount64-Volatile.Read(ref _lastLocalAt)<750)
            throw new InvalidOperationException("input_paused_local_activity_observe_before_retry");
        _startedGeneration=Volatile.Read(ref _generation);
        Volatile.Write(ref _paused,0); Volatile.Write(ref _running,1);
        Touch(); Check();
    }
    public void Touch()
    {
        Volatile.Write(ref _until,Environment.TickCount64+900);
        Changed?.Invoke();
    }
    public void Check()
    {
        if(Volatile.Read(ref _disposed)!=0 || Volatile.Read(ref _locked)!=0)
            throw new InvalidOperationException("input_desktop_unavailable");
        if(Volatile.Read(ref _running)!=0 && Volatile.Read(ref _generation)!=_startedGeneration)
            throw new InvalidOperationException("input_interrupted_local_activity_do_not_replay");
        var now=Environment.TickCount64;
        if(now-_desktopCheckedAt>=32) {
            _desktopCheckedAt=now;
            if(!InputDesktopAvailable()) { Stop("paused-desktop"); throw new InvalidOperationException("input_desktop_unavailable"); }
        }
        Volatile.Write(ref _until,Environment.TickCount64+900);
    }
    public void End() { Volatile.Write(ref _running,0); Changed?.Invoke(); }
    public void Stop(string reason="idle")
    {
        Interlocked.Increment(ref _generation);
        _pauseReason=reason;
        Volatile.Write(ref _until,0); Volatile.Write(ref _paused,1);
        Changed?.Invoke();
    }
    private void LocalInput()
    {
        _pauseReason="paused-local-input";
        Volatile.Write(ref _lastLocalAt,Environment.TickCount64);
        Interlocked.Increment(ref _generation);
        Volatile.Write(ref _until,0); Volatile.Write(ref _paused,1);
        // Hook stays bounded; no SendInput, UIA, dispatcher wait or blocking cleanup here.
    }
    private nint OnMouse(int code,nint message,nint data)
    {
        if(code>=0) { var input=Marshal.PtrToStructure<MouseHook>(data);
            if(IsPhysical(input.Flags,1,input.Extra)) LocalInput(); }
        return CallNextHookEx(0,code,message,data);
    }
    private nint OnKeyboard(int code,nint message,nint data)
    {
        if(code>=0) { var input=Marshal.PtrToStructure<KeyHook>(data);
            if(IsPhysical(input.Flags,0x10,input.Extra)) LocalInput(); }
        return CallNextHookEx(0,code,message,data);
    }
    internal static bool IsPhysical(uint flags,uint injectedFlag,nint extra)
        => extra!=InputMarker && (flags&injectedFlag)==0;
    private void OnSessionSwitch(object sender,SessionSwitchEventArgs e)
    {
        if(e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.ConsoleDisconnect or SessionSwitchReason.RemoteDisconnect)
        { Volatile.Write(ref _locked,1); Stop("paused-desktop"); }
        else if(e.Reason is SessionSwitchReason.SessionUnlock or SessionSwitchReason.ConsoleConnect or SessionSwitchReason.RemoteConnect)
        { Volatile.Write(ref _locked,0); Stop(); }
    }
    internal static bool InputDesktopAvailable()
    {
        var desktop=OpenInputDesktop(0,false,1);
        if(desktop==0)return false;
        try { var name=new System.Text.StringBuilder(256);
            return GetUserObjectInformation(desktop,2,name,512,out _) && name.ToString().Equals("Default",StringComparison.OrdinalIgnoreCase); }
        finally { CloseDesktop(desktop); }
    }
    public void Dispose()
    {
        if(Interlocked.Exchange(ref _disposed,1)!=0)return;
        Stop(); SystemEvents.SessionSwitch-=OnSessionSwitch;
        if(_mouseHook!=0) { UnhookWindowsHookEx(_mouseHook); _mouseHook=0; }
        if(_keyboardHook!=0) { UnhookWindowsHookEx(_keyboardHook); _keyboardHook=0; }
    }
    internal static bool SelfTest()
    {
        if(!IsPhysical(0,1,0)||IsPhysical(1,1,0)||IsPhysical(0,1,InputMarker)||IsPhysical(0x10,0x10,0))return false;
        using var activity=new ControlActivity(false);
        activity._running=1; activity._startedGeneration=activity._generation;
        activity.Touch(); activity.LocalInput(); activity.LocalInput();
        if(activity.Active||activity.State!="paused-local-input")return false;
        try { activity.Check(); return false; }
        catch(InvalidOperationException ex) { return ex.Message=="input_interrupted_local_activity_do_not_replay"; }
    }
    [StructLayout(LayoutKind.Sequential)] private struct MouseHook { public int X,Y; public uint Data,Flags,Time; public nint Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct KeyHook { public uint Key,Scan,Flags,Time; public nint Extra; }
    [DllImport("user32.dll",SetLastError=true)] private static extern nint SetWindowsHookEx(int id,HookProc callback,nint module,uint thread);
    [DllImport("user32.dll")] private static extern nint CallNextHookEx(nint hook,int code,nint message,nint data);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] private static extern nint GetModuleHandle(string? module);
    [DllImport("user32.dll")] private static extern nint OpenInputDesktop(uint flags,bool inherit,uint access);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(nint desktop);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern bool GetUserObjectInformation(nint handle,int index,System.Text.StringBuilder info,int length,out int needed);
}
