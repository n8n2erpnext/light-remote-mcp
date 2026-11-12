using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace GptOperator.RealRemoteV2;

internal sealed class RobotRpcServer : IDisposable
{
    private readonly string _pipeName;
    private readonly Func<JsonElement,Task<object?>> _handler;
    private readonly Action _disconnected;
    private readonly SemaphoreSlim _writeGate=new(1,1);
    private readonly RpcWorkScheduler _scheduler=new();
    public void CancelScope(string id)=>_scheduler.CancelScope(id);
    public void ForgetScope(string id)=>_scheduler.ForgetScope(id);
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
            // The request lane remains ordered. Detect a vanished Agent while a
            // synchronous input handler is busy, so its loop can stop immediately.
            using var connectionWatch=new System.Threading.Timer(state=>{
                try {
                    if(!_disposed&&!pipe.SafePipeHandle.IsClosed &&
                        !PeekNamedPipe(pipe.SafePipeHandle,IntPtr.Zero,0,IntPtr.Zero,out _,IntPtr.Zero))
                        _disconnected();
                } catch(ObjectDisposedException) {}
            },null,50,50);
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
                    // Enqueue before accepting the next line; responses may finish
                    // out of order and are correlated by the existing request ID.
                    _=ReplyAsync(id,root);
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
            _scheduler.Dispose();
        }
    }

    private async Task ReplyAsync(string id,JsonElement root)
    {
        try {
            var op=root.TryGetProperty("op",out var operation)?operation.GetString()??"":"";
            var scope=root.TryGetProperty("visualSessionId",out var visual)?visual.GetString()??"":"";
            var clock=System.Diagnostics.Stopwatch.StartNew();
            var data=await _scheduler.Schedule(op,scope,()=>_handler(root)).ConfigureAwait(false);
            var receipt=JsonSerializer.SerializeToNode(data);
            if(receipt is System.Text.Json.Nodes.JsonObject obj) {
                obj["nativeTiming"]=JsonSerializer.SerializeToNode(new {requestId=id,handlerMs=obj["nativeHandlerMs"]?.GetValue<double>()??clock.Elapsed.TotalMilliseconds,handlerAndQueueMs=clock.Elapsed.TotalMilliseconds,processId=Environment.ProcessId});
                data=obj;
            }
            await SendAsync(new {type="response",id,ok=true,data});
        } catch(Exception error) {
            try { await SendAsync(new {type="response",id,ok=false,error=error.Message}); } catch {}
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
        _scheduler.Dispose(); // outstanding writes can still release their gate
    }

    [DllImport("kernel32.dll",SetLastError=true)]
    private static extern bool PeekNamedPipe(SafePipeHandle pipe,IntPtr buffer,uint size,IntPtr read,out uint available,IntPtr left);
}
