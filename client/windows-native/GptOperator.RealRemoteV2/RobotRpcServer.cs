using System.IO;
using System.Threading.Channels;
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
    private readonly Channel<object> _uiEvents=Channel.CreateBounded<object>(new BoundedChannelOptions(1){SingleReader=true,FullMode=BoundedChannelFullMode.DropOldest});
    private readonly Task _uiPump;
    private long _uiProduced,_uiForwarded;
    public long UiEventsProduced=>Interlocked.Read(ref _uiProduced);
    public long UiEventsForwarded=>Interlocked.Read(ref _uiForwarded);
    private readonly RpcWorkScheduler _scheduler=new();
    public void CancelScope(string id)=>_scheduler.CancelScope(id);
    public void ForgetScope(string id)=>_scheduler.ForgetScope(id);
    private StreamWriter? _writer;
    private volatile bool _disposed;

    public RobotRpcServer(string pipeName,Func<JsonElement,Task<object?>> handler,Action disconnected)
    {
        _pipeName=pipeName;_handler=handler;_disconnected=disconnected;
        _uiPump=Task.Run(DrainUiEventsAsync);
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
            root=BindAuthorityDeadline(root,op,out var authorityDeadline);
            var data=await _scheduler.Schedule(op,scope,()=>{
                RequireAuthorityDeadline(authorityDeadline);
                return _handler(root);
            }).ConfigureAwait(false);
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

    internal static JsonElement BindAuthorityDeadline(JsonElement root,string op,out long deadline)
    {
        deadline=0;if(op!="desktop.text.chunk")return root;
        if(!root.TryGetProperty("authorityBudgetMs",out var node)||node.ValueKind!=JsonValueKind.Number||!node.TryGetInt32(out var budget)||budget is <1 or >1000)
            throw new InvalidOperationException("desktop_write_native_authority_budget_required");
        deadline=System.Diagnostics.Stopwatch.GetTimestamp()+budget*System.Diagnostics.Stopwatch.Frequency/1000;
        var guarded=System.Text.Json.Nodes.JsonNode.Parse(root.GetRawText())!.AsObject();
        // The receiving process owns this monotonic deadline, including queue
        // time. A caller cannot extend it with a forged absolute timestamp.
        guarded["nativeAuthorityDeadline"]=deadline;return JsonSerializer.SerializeToElement(guarded);
    }
    internal static void RequireAuthorityDeadline(long deadline)
    {
        if(deadline>0&&System.Diagnostics.Stopwatch.GetTimestamp()>=deadline)
            throw new InvalidOperationException("desktop_write_authority_expired_before_native_admission");
    }
    internal static bool AuthoritySelfTest()
    {
        var root=JsonSerializer.SerializeToElement(new {authorityBudgetMs=1000,nativeAuthorityDeadline=long.MaxValue});
        var bound=BindAuthorityDeadline(root,"desktop.text.chunk",out var deadline);
        if(bound.GetProperty("nativeAuthorityDeadline").GetInt64()!=deadline||deadline>=long.MaxValue-System.Diagnostics.Stopwatch.Frequency)return false;
        RequireAuthorityDeadline(deadline);
        try{RequireAuthorityDeadline(System.Diagnostics.Stopwatch.GetTimestamp()-1);return false;}catch(InvalidOperationException){}
        foreach(var budget in new[]{0,1001}) {
            try{BindAuthorityDeadline(JsonSerializer.SerializeToElement(new {authorityBudgetMs=budget}),"desktop.text.chunk",out _);return false;}catch(InvalidOperationException){}
        }
        return true;
    }

    public void PublishEvent(object value) => PublishEvent("ui.changed",value);

    public void PublishEvent(string eventName,object value)
    {
        if(_writer is null||_disposed) return;
        // Generic UI signals are latest-state hints, not a semantic journal.
        // Coalesce key-induced WinEvents without delaying request replies behind
        // thousands of fire-and-forget writes. Semantic deltas retain their path.
        if(eventName=="ui.changed") {Interlocked.Increment(ref _uiProduced);_uiEvents.Writer.TryWrite(value);return;}
        _=Task.Run(async()=>{
            try { await SendAsync(new {type="event",eventName,data=value}); } catch {}
        });
    }

    private async Task DrainUiEventsAsync()
    {
        await foreach(var item in _uiEvents.Reader.ReadAllAsync()) {
            var latest=item;await Task.Delay(40).ConfigureAwait(false);
            while(_uiEvents.Reader.TryRead(out var next))latest=next;
            if(_disposed)return;
            try {await SendAsync(new {type="event",eventName="ui.changed",data=latest}).ConfigureAwait(false);Interlocked.Increment(ref _uiForwarded);}catch{}
        }
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
        _uiEvents.Writer.TryComplete();
        _writer=null;
        _scheduler.Dispose(); // outstanding writes can still release their gate
    }

    [DllImport("kernel32.dll",SetLastError=true)]
    private static extern bool PeekNamedPipe(SafePipeHandle pipe,IntPtr buffer,uint size,IntPtr read,out uint available,IntPtr left);
}
