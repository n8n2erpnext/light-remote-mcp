using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace GptOperator.RealRemoteV2;

internal sealed class TypingTargetInterrupted(string reason):Exception(reason) {}
internal sealed class LogicalTextPacketInterrupted(string reason,int sent,bool known):Exception(reason)
{
    public int SentUnits {get;}=sent;
    public bool ProgressKnown {get;}=known;
}

// All UIA work runs on the ordered MTA worker. Per-packet checks use only
// Win32 identity and metadata generations; no document read in the typing loop.
internal sealed class TypingTarget
{
    internal const int DeliveryWaitMs=5000;
    private const int BeforeLimit=2*1024*1024;
    private readonly UiSensor _sensor;
    private readonly ControlActivity _activity;
    private readonly nint _root,_focus;
    private readonly uint _pid;
    private readonly long _processStart,_ownerGeneration,_focusGeneration;
    private AutomationElement? _element;
    private int[]? _runtime;
    private TextPattern? _text;
    private ValuePattern? _value;
    private string _prefix="",_suffix="";
    private bool _password;
    private bool _nativeReadback;
    private string _nativeClass="";
    private long _nativeGeneration;
    private uint _nativeThread;
    public bool VerificationAvailable {get;private set;}
    public string VerificationMethod {get;private set;}="unavailable";
    public string Fingerprint {get;private set;}="";
    public bool NativeMultilineLineBreaks {get;}

    private TypingTarget(UiSensor sensor,ControlActivity activity)
    {
        _sensor=sensor;_activity=activity;
        _ownerGeneration=activity.OwnerInputGeneration;_focusGeneration=sensor.FocusGeneration;
        _root=GetForegroundWindow();
        if(_root==0)throw new InvalidOperationException("desktop_text_foreground_required");
        var thread=GetWindowThreadProcessId(_root,out _pid);
        _focus=ReadFocus(thread);_processStart=ProcessStart(_pid);
        NativeMultilineLineBreaks=ReadNativeLineBreakPolicy(_focus);
    }
    public static TypingTarget Capture(UiSensor sensor,ControlActivity activity,string mode,string verification)
    {
        if(mode is not ("insert" or "append")||verification is not ("none" or "prefer" or "required"))
            throw new InvalidOperationException("desktop_text_invalid_options");
        var target=new TypingTarget(sensor,activity);
        try {
            // Bind empty native editors without creating a managed UIA provider.
            // Existing/non-native documents still require UIA selection proof.
            if(!target.CaptureNativeEmpty(mode,verification)) {
            target._element=AutomationElement.FocusedElement;
            if(target._element is not null) {
                target._runtime=target._element.GetRuntimeId();
                target._password=target._element.Current.IsPassword;
                if(!target._element.Current.IsEnabled)throw new InvalidOperationException("desktop_text_target_disabled");
                if(!target._password&&(verification!="none"||mode=="append")&&target._runtime is {Length:>0})target.CaptureReadback(mode);
            }
            }
        } catch(InvalidOperationException error) when(error.Message is "desktop_text_append_requires_caret_at_end" or "desktop_text_target_disabled" or "desktop_text_target_read_only") {throw;}
          catch {target.VerificationAvailable=false;target.VerificationMethod="provider_unavailable";}
        if(target._processStart==0){target.VerificationAvailable=false;target.VerificationMethod="process_generation_unavailable";}
        if(mode=="append"&&!target.VerificationAvailable)throw new InvalidOperationException("desktop_text_append_requires_selection_readback");
        if(verification=="required"&&!target.VerificationAvailable)throw new InvalidOperationException("desktop_text_verification_unavailable");
        var identity=$"{target._root}|{target._focus}|{target._pid}|{target._processStart}|{String.Join(".",target._runtime??Array.Empty<int>())}";
        target.Fingerprint=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity))).ToLowerInvariant();
        target.CheckFull();return target;
    }
    private bool CaptureNativeEmpty(string mode,string verification)
    {
        _nativeClass=NativeEditReadback.ClassName(_focus);
        if(!NativeEditReadback.Eligible(_focus,_nativeClass))return false;
        _nativeThread=GetWindowThreadProcessId(_focus,out var pid);
        if(pid!=_pid||_nativeThread==0||_processStart==0)return false;
        _nativeGeneration=_sensor.TrackNativeWindow(_focus);
        CheckFast();
        if(verification=="none"&&mode=="insert")return true;
        if(!NativeEditReadback.TryRead(_focus,BeforeLimit+1,out var before)||before.Length!=0)return false;
        _nativeReadback=true;VerificationAvailable=true;VerificationMethod="win32-empty-edit-full-line-endings";
        return true;
    }
    private void CaptureReadback(string mode)
    {
        // An empty ValuePattern has unambiguous insertion semantics and avoids
        // provider-specific empty TextPattern paragraph/end-point artifacts.
        // This is readback only: typing still uses real Unicode SendInput.
        if(_element!.TryGetCurrentPattern(ValuePattern.Pattern,out var valueRaw)&&valueRaw is ValuePattern empty) {
            if(empty.Current.IsReadOnly)throw new InvalidOperationException("desktop_text_target_read_only");
            if(empty.Current.Value.Length==0) {
                _value=empty;VerificationAvailable=true;VerificationMethod="uia-empty-value-line-endings";return;
            }
        }
        if(_element!.TryGetCurrentPattern(TextPattern.Pattern,out var raw)&&raw is TextPattern text) {
            var selection=text.GetSelection();
            if(selection.Length!=1)return;
            var document=text.DocumentRange;var before=document.GetText(BeforeLimit+1);
            if(before.Length>BeforeLimit)return;
            var prefix=document.Clone();prefix.MoveEndpointByRange(TextPatternRangeEndpoint.End,selection[0],TextPatternRangeEndpoint.Start);
            var suffix=document.Clone();suffix.MoveEndpointByRange(TextPatternRangeEndpoint.Start,selection[0],TextPatternRangeEndpoint.End);
            var a=prefix.GetText(BeforeLimit+1);var b=suffix.GetText(BeforeLimit+1);var selected=selection[0].GetText(BeforeLimit+1);
            if(a.Length>BeforeLimit||b.Length>BeforeLimit||Normalize(a+selected+b)!=Normalize(before))return;
            if(mode=="append"&&(selected.Length!=0||Normalize(b).Length!=0))throw new InvalidOperationException("desktop_text_append_requires_caret_at_end");
            _prefix=a;_suffix=b;_text=text;VerificationAvailable=true;VerificationMethod="uia-text-pattern-selection-line-endings";return;
        }
        if(_element.TryGetCurrentPattern(ValuePattern.Pattern,out raw)&&raw is ValuePattern value) {
            // Without caret/selection, only an initially empty value proves
            // insertion semantics. Never assume before+payload for other values.
            if(value.Current.Value.Length!=0||value.Current.IsReadOnly)return;
            _value=value;VerificationAvailable=true;VerificationMethod="uia-empty-value-line-endings";
        }
    }
    public object Metadata()=>new {fingerprint=Fingerprint,password=_password,nativeMultilineLineBreaks=NativeMultilineLineBreaks,
        binding=_nativeReadback?"win32-foreground-focus+process+destroy-generation+editor-class":_runtime is {Length:>0}?"win32-foreground-focus+uia-runtime":"win32-foreground-focus",
        verificationAvailable=VerificationAvailable,verificationMethod=VerificationMethod};
    public void CheckFast()
    {
        if(_activity.OwnerInputGeneration!=_ownerGeneration)throw new TypingTargetInterrupted("owner_input");
        if(_sensor.FocusGeneration!=_focusGeneration)throw new TypingTargetInterrupted("focus_changed");
        if(!ControlActivity.InputDesktopAvailable())throw new TypingTargetInterrupted("input_desktop_unavailable");
        var root=GetForegroundWindow();var thread=GetWindowThreadProcessId(root,out var pid);
        if(root!=_root||pid!=_pid||ReadFocus(thread)!=_focus)throw new TypingTargetInterrupted("target_changed");
        if(_nativeGeneration!=0&&(!_sensor.NativeWindowMatches(_focus,_nativeGeneration)
            ||GetWindowThreadProcessId(_focus,out var focusPid)!=_nativeThread||focusPid!=_pid
            ||NativeEditReadback.ClassName(_focus)!=_nativeClass||!NativeEditReadback.Eligible(_focus,_nativeClass)))
            throw new TypingTargetInterrupted("native_editor_recreated_or_changed");
        if(NativeMultilineLineBreaks&&!ReadNativeLineBreakPolicy(_focus))throw new TypingTargetInterrupted("native_multiline_target_changed");
    }
    public void CheckFull()
    {
        CheckFast();
        if(_processStart!=0&&ProcessStart(_pid)!=_processStart)throw new TypingTargetInterrupted("target_process_changed");
        if(_runtime is {Length:>0}) {
            try {
                var focused=AutomationElement.FocusedElement;
                if(focused is null||!focused.GetRuntimeId().SequenceEqual(_runtime))throw new TypingTargetInterrupted("focused_control_changed");
            } catch(TypingTargetInterrupted) {throw;}
              catch {throw new TypingTargetInterrupted("focused_control_unavailable");}
        }
    }
    public object Verify(string sent,int sentUnits,bool complete)
    {
        if(!VerificationAvailable){CheckFull();return new {contentVerification="unverified",verifiedInsertedUnits=(int?)null,verificationMethod=VerificationMethod};}
        if(WaitForDelivery(sent,()=>{}))return new {contentVerification=complete?"verified":"partial",verifiedInsertedUnits=(int?)sentUnits,verificationMethod=VerificationMethod};
        return new {contentVerification="mismatch",verifiedInsertedUnits=(int?)null,verificationMethod=VerificationMethod};
    }
    public bool WaitForDelivery(string sent,Action guard)
    {
        if(!VerificationAvailable)return false;
        var expected=Normalize(_prefix+sent+_suffix);
        var maximum=Math.Min(20*1024*1024,Math.Max(32,2*(_prefix.Length+sent.Length+_suffix.Length)+16));
        var clock=Stopwatch.StartNew();
        return PollDelivery(()=>{
            CheckFull();
            string actual;
            if(_nativeReadback) {if(!NativeEditReadback.TryRead(_focus,maximum,out actual))return false;}
            else actual=_text is not null?_text.DocumentRange.GetText(maximum):_value!.Current.Value;
            CheckFast();
            return Normalize(actual)==expected;
        },guard,()=>clock.ElapsedMilliseconds,Thread.Sleep);
    }
    private static bool PollDelivery(Func<bool> observe,Action guard,Func<long> elapsed,Action<int> delay)
    {
        var pause=15;
        while(true) {
            guard();var matched=observe();guard();if(matched)return true;
            var remaining=DeliveryWaitMs-elapsed();if(remaining<=0)return false;
            // Full-document provider reads can compete with the target's input
            // pump. Back off pending read-only observations, never send again.
            delay((int)Math.Min(pause,remaining));pause=Math.Min(120,pause*2);
        }
    }
    internal static bool DeliveryPollingSelfTest()
    {
        long elapsed=0;var reads=0;var waits=new List<int>();
        void Wait(int milliseconds){waits.Add(milliseconds);elapsed+=milliseconds;}
        if(!PollDelivery(()=>{reads++;return elapsed>=240;},()=>{},()=>elapsed,Wait)||reads>7||waits.Any(x=>x<1||x>120))return false;
        elapsed=0;reads=0;waits.Clear();
        if(PollDelivery(()=>{reads++;return false;},()=>{},()=>elapsed,Wait)||elapsed!=5000||reads>50||waits.Any(x=>x<1||x>120))return false;
        elapsed=0;reads=0;var cancelled=false;
        try {PollDelivery(()=>{reads++;return false;},()=>{if(cancelled)throw new TypingTargetInterrupted("agent_cancelled");},()=>elapsed,ms=>{elapsed+=ms;cancelled=true;});return false;}
        catch(TypingTargetInterrupted){return reads==1;}
    }
    private static string Normalize(string value)=>value.Replace("\r\n","\n",StringComparison.Ordinal).Replace('\r','\n');
    private static bool NativeLineBreakPolicy(string name,uint style)
    {
        // Requiring WANTRETURN avoids making a newline into a dialog submit.
        const uint required=0x0004|0x1000; // ES_MULTILINE | ES_WANTRETURN
        return (style&required)==required&&(name.Equals("Edit",StringComparison.OrdinalIgnoreCase)
            ||name.StartsWith("RichEdit",StringComparison.OrdinalIgnoreCase)
            ||name.StartsWith("WindowsForms10.Edit.",StringComparison.OrdinalIgnoreCase)
            ||name.StartsWith("WindowsForms10.RichEdit",StringComparison.OrdinalIgnoreCase));
    }
    private static bool ReadNativeLineBreakPolicy(nint hwnd)
    {
        var name=new StringBuilder(256);
        return hwnd!=0&&GetClassName(hwnd,name,name.Capacity)>0&&NativeLineBreakPolicy(name.ToString(),GetWindowLong(hwnd,-16));
    }
    internal static bool NativeLineBreakPolicySelfTest()=>NativeLineBreakPolicy("Edit",0x1004)
        &&NativeLineBreakPolicy("WindowsForms10.RICHEDIT50W.app.0.test",0x1004)
        &&!NativeLineBreakPolicy("Chrome_RenderWidgetHostHWND",0x1004)
        &&!NativeLineBreakPolicy("Edit",0x1000)&&!NativeLineBreakPolicy("Edit",0x0004)
        &&!NativeLineBreakPolicy("Edit",0);
    private static long ProcessStart(uint pid) {try {using var process=Process.GetProcessById((int)pid);return process.StartTime.ToUniversalTime().Ticks;}catch{return 0;} }
    private static nint ReadFocus(uint thread)
    {
        var info=new GuiThreadInfo{Size=(uint)Marshal.SizeOf<GuiThreadInfo>()};
        if(thread==0||!GetGUIThreadInfo(thread,ref info))throw new TypingTargetInterrupted("os_focus_unavailable");
        return info.Focus;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Rect {public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)] private struct GuiThreadInfo {public uint Size,Flags;public nint Active,Focus,Capture,MenuOwner,MoveSize,Caret;public Rect CaretRect;}
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd,out uint pid);
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread,ref GuiThreadInfo info);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="GetClassNameW")] private static extern int GetClassName(nint hwnd,StringBuilder value,int maximum);
    [DllImport("user32.dll",EntryPoint="GetWindowLongW")] private static extern uint GetWindowLong(nint hwnd,int index);
}
