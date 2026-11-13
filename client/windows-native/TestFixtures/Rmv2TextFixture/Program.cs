using System.IO.Pipes;
using System.Text.Json;

namespace Rmv2TextFixture;

internal sealed class MeasuredTextBox:TextBox
{
    public int Characters,KeyDowns,DelayMs;
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
        using var a=new MeasuredTextBox{Multiline=true,MaxLength=1048576};a.SetBounds(20,20,540,160);
        using var b=new MeasuredTextBox{Multiline=true,MaxLength=1048576};b.SetBounds(20,200,540,160);
        using var rich=new MeasuredRichEdit{Multiline=true,MaxLength=1048576,WordWrap=true,DetectUrls=false,Visible=false};rich.SetBounds(20,20,540,160);
        TextBoxBase active=a;var activeKind="classic-edit";
        form.Controls.AddRange(new Control[]{a,b,rich});
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
                                    if(kind is not ("classic" or "rich")||delay is <0 or >100||kind=="rich"&&delay!=0)throw new InvalidOperationException("fixture_editor_options_invalid");
                                    a.DelayMs=delay;active=kind=="rich"?rich:a;activeKind=kind=="rich"?"rich-edit":"classic-edit";
                                    a.Visible=kind!="rich";rich.Visible=kind=="rich";
                                    form.Show();form.WindowState=FormWindowState.Normal;active.Text=initial;b.Clear();
                                    a.Characters=a.KeyDowns=b.Characters=b.KeyDowns=rich.Characters=rich.KeyDowns=0;
                                    form.Activate();active.Focus();active.Select(active.Text.Length,0);data=new {reset=true,controlKind=activeKind};break;
                                case "other":b.Focus();data=new {other=true};break;
                                case "read":data=new {text=active.Text,other=b.Text,characters=active==a?a.Characters:rich.Characters,keyDowns=active==a?a.KeyDowns:rich.KeyDowns,otherCharacters=b.Characters,selectionStart=active.SelectionStart,selectionLength=active.SelectionLength,controlMaxLength=active.MaxLength,wordWrap=active.WordWrap,controlKind=activeKind,delayMs=active==a?a.DelayMs:0};break;
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
