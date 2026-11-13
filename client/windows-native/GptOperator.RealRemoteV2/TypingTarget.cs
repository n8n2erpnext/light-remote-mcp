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
    public bool VerificationAvailable {get;private set;}
    public string VerificationMethod {get;private set;}="unavailable";
    public string Fingerprint {get;private set;}="";

    private TypingTarget(UiSensor sensor,ControlActivity activity)
    {
        _sensor=sensor;_activity=activity;
        _ownerGeneration=activity.OwnerInputGeneration;_focusGeneration=sensor.FocusGeneration;
        _root=GetForegroundWindow();
        if(_root==0)throw new InvalidOperationException("desktop_text_foreground_required");
        var thread=GetWindowThreadProcessId(_root,out _pid);
        _focus=ReadFocus(thread);_processStart=ProcessStart(_pid);
    }
    public static TypingTarget Capture(UiSensor sensor,ControlActivity activity,string mode,string verification)
    {
        if(mode is not ("insert" or "append")||verification is not ("none" or "prefer" or "required"))
            throw new InvalidOperationException("desktop_text_invalid_options");
        var target=new TypingTarget(sensor,activity);
        try {
            target._element=AutomationElement.FocusedElement;
            if(target._element is not null) {
                target._runtime=target._element.GetRuntimeId();
                target._password=target._element.Current.IsPassword;
                if(!target._element.Current.IsEnabled)throw new InvalidOperationException("desktop_text_target_disabled");
                if(!target._password&&(verification!="none"||mode=="append")&&target._runtime is {Length:>0})target.CaptureReadback(mode);
            }
        } catch(InvalidOperationException error) when(error.Message is "desktop_text_append_requires_caret_at_end" or "desktop_text_target_disabled") {throw;}
          catch {target.VerificationAvailable=false;target.VerificationMethod="provider_unavailable";}
        if(target._processStart==0){target.VerificationAvailable=false;target.VerificationMethod="process_generation_unavailable";}
        if(mode=="append"&&!target.VerificationAvailable)throw new InvalidOperationException("desktop_text_append_requires_selection_readback");
        if(verification=="required"&&!target.VerificationAvailable)throw new InvalidOperationException("desktop_text_verification_unavailable");
        var identity=$"{target._root}|{target._focus}|{target._pid}|{target._processStart}|{String.Join(".",target._runtime??Array.Empty<int>())}";
        target.Fingerprint=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity))).ToLowerInvariant();
        target.CheckFull();return target;
    }
    private void CaptureReadback(string mode)
    {
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
    public object Metadata()=>new {fingerprint=Fingerprint,password=_password,
        binding=_runtime is {Length:>0}?"win32-foreground-focus+uia-runtime":"win32-foreground-focus",
        verificationAvailable=VerificationAvailable,verificationMethod=VerificationMethod};
    public void CheckFast()
    {
        if(_activity.OwnerInputGeneration!=_ownerGeneration)throw new TypingTargetInterrupted("owner_input");
        if(_sensor.FocusGeneration!=_focusGeneration)throw new TypingTargetInterrupted("focus_changed");
        if(!ControlActivity.InputDesktopAvailable())throw new TypingTargetInterrupted("input_desktop_unavailable");
        var root=GetForegroundWindow();var thread=GetWindowThreadProcessId(root,out var pid);
        if(root!=_root||pid!=_pid||ReadFocus(thread)!=_focus)throw new TypingTargetInterrupted("target_changed");
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
        CheckFull();
        if(!VerificationAvailable)return new {contentVerification="unverified",verifiedInsertedUnits=(int?)null,verificationMethod=VerificationMethod};
        var expected=Normalize(_prefix+sent+_suffix);
        var maximum=Math.Min(20*1024*1024,Math.Max(32,2*(_prefix.Length+sent.Length+_suffix.Length)+16));
        var clock=Stopwatch.StartNew();
        while(true) {
            CheckFull();
            var actual=_text is not null?_text.DocumentRange.GetText(maximum):_value!.Current.Value;
            if(Normalize(actual)==expected)return new {contentVerification=complete?"verified":"partial",verifiedInsertedUnits=(int?)sentUnits,verificationMethod=VerificationMethod};
            if(clock.ElapsedMilliseconds>=1500)break;
            Thread.Sleep(30);
        }
        return new {contentVerification="mismatch",verifiedInsertedUnits=(int?)null,verificationMethod=VerificationMethod};
    }
    private static string Normalize(string value)=>value.Replace("\r\n","\n",StringComparison.Ordinal).Replace('\r','\n');
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
}
