using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace GptOperator.RealRemoteV2;

internal sealed class RobotRpcServer : IDisposable
{
    private readonly string _pipeName;
    private readonly Func<JsonElement,Task<object?>> _handler;
    private readonly Action _disconnected;
    private readonly SemaphoreSlim _writeGate=new(1,1);
    private StreamWriter? _writer;
    private volatile bool _disposed;

    public RobotRpcServer(string pipeName,Func<JsonElement,Task<object?>> handler,Action disconnected)
    {
        _pipeName=pipeName;_handler=handler;_disconnected=disconnected;
    }

    public static bool IsValidPipeName(string value)
    {
        if(string.IsNullOrWhiteSpace(value)||value.Length>120) return false;
        return value.All(ch=>char.IsLetterOrDigit(ch)||ch is '-' or '_' or '.');
    }

    public async Task RunAsync()
    {
        try
        {
            using var pipe=new NamedPipeServerStream(_pipeName,PipeDirection.InOut,1,PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly,64*1024,64*1024);
            await pipe.WaitForConnectionAsync();
            using var reader=new StreamReader(pipe,new UTF8Encoding(false),false,16*1024,leaveOpen:true);
            using var writer=new StreamWriter(pipe,new UTF8Encoding(false),16*1024,leaveOpen:true){AutoFlush=true};
            _writer=writer;
            await SendAsync(new {type="event",eventName="robot.ready",at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),pid=Environment.ProcessId});
            while(!_disposed&&pipe.IsConnected)
            {
                var line=await reader.ReadLineAsync();
                if(line is null) break;
                string id="";
                try
                {
                    using var doc=JsonDocument.Parse(line);
                    var root=doc.RootElement.Clone();
                    id=root.TryGetProperty("id",out var idNode)?idNode.ToString():"";
                    if(string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("request_id_required");
                    var data=await _handler(root);
                    await SendAsync(new {type="response",id,ok=true,data});
                }
                catch(Exception ex)
                {
                    await SendAsync(new {type="response",id,ok=false,error=ex.Message});
                }
            }
        }
        catch when(_disposed) {}
        finally
        {
            _writer=null;
            if(!_disposed) _disconnected();
        }
    }

    public void PublishEvent(object value) => PublishEvent("ui.changed",value);

    public void PublishEvent(string eventName,object value)
    {
        if(_writer is null||_disposed) return;
        _=Task.Run(async()=>{
            try { await SendAsync(new {type="event",eventName,data=value}); } catch {}
        });
    }

    private async Task SendAsync(object value)
    {
        var writer=_writer;
        if(writer is null) return;
        var json=JsonSerializer.Serialize(value);
        await _writeGate.WaitAsync();
        try { await writer.WriteLineAsync(json); }
        finally { _writeGate.Release(); }
    }

    public void Dispose()
    {
        _disposed=true;
        _writer=null;
        _writeGate.Dispose();
    }
}
