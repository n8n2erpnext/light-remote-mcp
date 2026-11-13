using System.IO.Pipes;
using System.Text.Json;

namespace Rmv2TextFixture;

internal sealed class MeasuredTextBox:TextBox
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
        form.Controls.AddRange(new Control[]{a,b});
        form.Shown+=(_,_)=>Task.Run(async()=>{
            try {
                using var pipe=new NamedPipeServerStream(args[0],PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync();using var reader=new StreamReader(pipe);using var writer=new StreamWriter(pipe){AutoFlush=true};
                while(await reader.ReadLineAsync() is {} line) {
                    using var document=JsonDocument.Parse(line);var request=document.RootElement;
                    var id=request.GetProperty("id").GetString();var op=request.GetProperty("op").GetString();
                    var initial=request.TryGetProperty("initial",out var text)?text.GetString()??"":"";
                    var response=new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
                    form.BeginInvoke((Action)(()=>{
                        try {
                            object data;
                            switch(op) {
                                case "reset":form.Show();form.WindowState=FormWindowState.Normal;a.Text=initial;b.Clear();a.Characters=a.KeyDowns=b.Characters=b.KeyDowns=0;form.Activate();a.Focus();a.Select(a.TextLength,0);data=new {reset=true};break;
                                case "other":b.Focus();data=new {other=true};break;
                                case "read":data=new {text=a.Text,other=b.Text,characters=a.Characters,keyDowns=a.KeyDowns,otherCharacters=b.Characters,selectionStart=a.SelectionStart,selectionLength=a.SelectionLength,controlMaxLength=a.MaxLength,wordWrap=a.WordWrap};break;
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
