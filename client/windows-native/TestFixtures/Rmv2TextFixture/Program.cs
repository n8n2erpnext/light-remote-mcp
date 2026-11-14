using System.IO.Pipes;
using System.Text.Json;
using System.Runtime.InteropServices;
using System.Text;

namespace Rmv2TextFixture;

// A genuine Win32 EDIT HWND, without a managed TextBox accessibility provider.
// Managed editor stress is required separately, with its real accessibility state recorded.
internal sealed class NativeEdit:NativeWindow,IDisposable
{
    public int Characters,KeyDowns;
    public NativeEdit(nint parent)
    {
        var hwnd=CreateWindowEx(0,"EDIT","",0x50A01044,20,20,540,160,parent,0,0,0);
        if(hwnd==0)throw new System.ComponentModel.Win32Exception();
        AssignHandle(hwnd);SendMessage(hwnd,0x00C5,(nint)1048576,0);ShowWindow(hwnd,0);
    }
    public void Reset(string text)
    {
        SetWindowText(Handle,text);Characters=KeyDowns=0;ShowWindow(Handle,5);
        SetFocus(Handle);SendMessage(Handle,0x00B1,(nint)text.Length,(nint)text.Length);
    }
    public void Hide()=>ShowWindow(Handle,0);
    public string ReadText(){var value=new StringBuilder(GetWindowTextLength(Handle)+1);GetWindowText(Handle,value,value.Capacity);return value.ToString();}
    protected override void WndProc(ref Message message)
    {
        if(message.Msg==0x0102)Characters++;
        if(message.Msg==0x0100)KeyDowns++;
        base.WndProc(ref message);
    }
    public void Dispose(){if(Handle!=0){DestroyWindow(Handle);ReleaseHandle();}}
    [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="CreateWindowExW",SetLastError=true)] private static extern nint CreateWindowEx(uint ex,string name,string text,uint style,int x,int y,int width,int height,nint parent,nint menu,nint instance,nint parameter);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SetWindowTextW")] private static extern bool SetWindowText(nint hwnd,string text);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="GetWindowTextLengthW")] private static extern int GetWindowTextLength(nint hwnd);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="GetWindowTextW")] private static extern int GetWindowText(nint hwnd,StringBuilder value,int maximum);
    [DllImport("user32.dll",EntryPoint="SendMessageW")] private static extern nint SendMessage(nint hwnd,uint message,nint wparam,nint lparam);
    [DllImport("user32.dll")] private static extern nint SetFocus(nint hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(nint hwnd,int command);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(nint hwnd);
}

internal sealed class MeasuredTextBox:TextBox
{
    public int Characters,KeyDowns,DelayMs;
    public bool AccessibilityCreated;
    protected override AccessibleObject CreateAccessibilityInstance(){AccessibilityCreated=true;return base.CreateAccessibilityInstance();}
    protected override CreateParams CreateParams {get {var value=base.CreateParams;value.Style|=0x1000;return value;}}
    protected override void WndProc(ref Message message)
    {
        if(message.Msg==0x0102){if(DelayMs>0)Thread.Sleep(DelayMs);Characters++;}
        if(message.Msg==0x0100)KeyDowns++;
        base.WndProc(ref message);
    }
}
internal sealed class MeasuredRichEdit:RichTextBox
{
    public int Characters,KeyDowns;
    public bool AccessibilityCreated;
    protected override AccessibleObject CreateAccessibilityInstance(){AccessibilityCreated=true;return base.CreateAccessibilityInstance();}
    protected override CreateParams CreateParams {get {var value=base.CreateParams;value.Style|=0x1000;return value;}}
    protected override void WndProc(ref Message message)
    {
        if(message.Msg==0x0102)Characters++;
        if(message.Msg==0x0100)KeyDowns++;
        base.WndProc(ref message);
    }
}
internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        // Test-only executable, never staged in a product or run on Owner PC.
        if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true"||args.Length!=1||!args[0].StartsWith("lightremote-text-fixture-",StringComparison.Ordinal))
        {Environment.ExitCode=2;return;}
        ApplicationConfiguration.Initialize();
        using var form=new Form{Text="RM isolated native text acceptance",Width=600,Height=440,TopMost=true};
        using var a=new MeasuredTextBox{Multiline=true,AcceptsReturn=true,MaxLength=1048576};a.SetBounds(20,20,540,160);
        using var b=new MeasuredTextBox{Multiline=true,AcceptsReturn=true,MaxLength=1048576};b.SetBounds(20,200,540,160);
        using var rich=new MeasuredRichEdit{Multiline=true,MaxLength=1048576,WordWrap=true,DetectUrls=false,Visible=false};rich.SetBounds(20,20,540,160);
        TextBoxBase active=a;var activeKind="classic-edit";
        form.Controls.AddRange(new Control[]{a,b,rich});
        using var native=new NativeEdit(form.Handle);
        form.Shown+=(_,_)=>Task.Run(async()=>{
            try {
                using var pipe=new NamedPipeServerStream(args[0],PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync();using var reader=new StreamReader(pipe);using var writer=new StreamWriter(pipe){AutoFlush=true};
                while(await reader.ReadLineAsync() is {} line) {
                    using var document=JsonDocument.Parse(line);var request=document.RootElement;
                    var id=request.GetProperty("id").GetString();var op=request.GetProperty("op").GetString();
                    var initial=request.TryGetProperty("initial",out var text)?text.GetString()??"":"";
                    var kind=request.TryGetProperty("kind",out var requestedKind)?requestedKind.GetString()??"classic":"classic";
                    var delay=request.TryGetProperty("delayMs",out var requestedDelay)?requestedDelay.GetInt32():0;
                    var response=new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
                    form.BeginInvoke((Action)(()=>{
                        try {
                            object data;
                            switch(op) {
                                case "reset":
                                    if(kind is not ("classic" or "rich" or "native")||delay is <0 or >100||kind!="classic"&&delay!=0)throw new InvalidOperationException("fixture_editor_options_invalid");
                                    a.DelayMs=delay;active=kind=="rich"?rich:a;activeKind=kind=="native"?"win32-edit":kind=="rich"?"rich-edit":"classic-edit";
                                    native.Hide();a.Visible=kind=="classic";rich.Visible=kind=="rich";
                                    form.Show();form.WindowState=FormWindowState.Normal;active.Text=initial;b.Clear();
                                    a.Characters=a.KeyDowns=b.Characters=b.KeyDowns=rich.Characters=rich.KeyDowns=0;
                                    form.Activate();
                                    if(kind=="native")native.Reset(initial);else{active.Focus();active.Select(active.Text.Length,0);}
                                    data=new {reset=true,controlKind=activeKind};break;
                                case "other":b.Focus();data=new {other=true};break;
                                case "read":data=new {text=activeKind=="win32-edit"?native.ReadText():active.Text,other=b.Text,characters=activeKind=="win32-edit"?native.Characters:active==a?a.Characters:rich.Characters,keyDowns=activeKind=="win32-edit"?native.KeyDowns:active==a?a.KeyDowns:rich.KeyDowns,otherCharacters=b.Characters,selectionStart=activeKind=="win32-edit"?0:active.SelectionStart,selectionLength=activeKind=="win32-edit"?0:active.SelectionLength,controlMaxLength=activeKind=="win32-edit"?1048576:active.MaxLength,wordWrap=activeKind=="win32-edit"||active.WordWrap,controlKind=activeKind,delayMs=activeKind=="classic-edit"?a.DelayMs:0,accessibilityObjectCreated=activeKind!="win32-edit"&&(active==a?a.AccessibilityCreated:rich.AccessibilityCreated)};break;
                                case "close":data=new {closed=true};break;
                                default:throw new InvalidOperationException("fixture_operation_invalid");
                            }
                            response.SetResult(new {id,ok=true,data});
                        }catch(Exception error){response.SetResult(new {id,ok=false,error=error.Message});}
                    }));
                    await writer.WriteLineAsync(JsonSerializer.Serialize(await response.Task));
                    if(op=="close"){form.BeginInvoke((Action)(()=>form.Close()));break;}
                }
            }catch{try{form.BeginInvoke((Action)(()=>form.Close()));}catch{}}
        });
        Application.Run(form);
    }
}
