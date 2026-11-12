using System.Threading.Channels;

namespace GptOperator.RealRemoteV2;

// Named-pipe reads never wait behind a synchronous native operation. Input and
// semantic state stay ordered; capture and bounded status/cancel use other lanes.
internal sealed class RpcWorkScheduler : IDisposable
{
    private sealed record Work(string Scope,long Epoch,Func<Task<object?>> Run,
        TaskCompletionSource<object?> Reply,long EnqueuedAt);
    private readonly Channel<Work> _ordered=Queue(16),_capture=Queue(2);
    private readonly SemaphoreSlim _fast=new(4,4);
    private readonly object _gate=new();
    private readonly Dictionary<string,long> _epochs=new(StringComparer.Ordinal);
    private volatile bool _disposed;
    private static Channel<Work> Queue(int size)=>Channel.CreateBounded<Work>(new BoundedChannelOptions(size){SingleReader=true,FullMode=BoundedChannelFullMode.Wait});
    public RpcWorkScheduler()
    {
        foreach(var (queue,name) in new[]{(_ordered,"RM ordered input"),(_capture,"RM frame capture")}) {
            var worker=new Thread(()=>Drain(queue)){IsBackground=true,Name=name};
            worker.SetApartmentState(ApartmentState.MTA);worker.Start();
        }
    }
    private long Epoch(string scope) { lock(_gate)return _epochs.GetValueOrDefault(scope); }
    public void CancelScope(string scope) { lock(_gate)_epochs[scope]=_epochs.GetValueOrDefault(scope)+1; }
    public void ForgetScope(string scope) { lock(_gate)_epochs.Remove(scope); }
    public Task<object?> Schedule(string op,string scope,Func<Task<object?>> run)
    {
        if(_disposed)return Task.FromException<object?>(new ObjectDisposedException(nameof(RpcWorkScheduler)));
        if(op is "ping" or "status" or "desktop.status" or "desktop.cancel")return Fast(run);
        var frame=op is "desktop.frame" or "desktop.visual.frame" or "desktop-visual-frame";
        var reply=new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var row=new Work(scope,Epoch(scope),run,reply,System.Diagnostics.Stopwatch.GetTimestamp());
        if(!(frame?_capture:_ordered).Writer.TryWrite(row))reply.TrySetException(new InvalidOperationException("native_request_queue_busy"));
        return reply.Task;
    }
    private async Task<object?> Fast(Func<Task<object?>> run)
    {
        if(!_fast.Wait(0))throw new InvalidOperationException("native_control_lane_busy");
        try { return await Task.Run(run).ConfigureAwait(false); } finally { _fast.Release(); }
    }
    private void Drain(Channel<Work> queue)
    {
        while(queue.Reader.WaitToReadAsync().AsTask().GetAwaiter().GetResult())
        while(queue.Reader.TryRead(out var row)) {
            try {
                if(_disposed)throw new ObjectDisposedException(nameof(RpcWorkScheduler));
                if(row.Scope.Length>0&&Epoch(row.Scope)!=row.Epoch)throw new InvalidOperationException("operation_cancelled_before_start");
                var queueMs=System.Diagnostics.Stopwatch.GetElapsedTime(row.EnqueuedAt).TotalMilliseconds;
                var clock=System.Diagnostics.Stopwatch.StartNew();
                var result=row.Run().GetAwaiter().GetResult();
                var node=System.Text.Json.JsonSerializer.SerializeToNode(result);
                if(node is System.Text.Json.Nodes.JsonObject obj) {
                    obj["nativeQueueMs"]=queueMs;obj["nativeHandlerMs"]=clock.Elapsed.TotalMilliseconds;
                }
                row.Reply.TrySetResult(node is null?result:node);
            } catch(Exception error) { row.Reply.TrySetException(error); }
        }
    }
    public void Dispose() { _disposed=true;_ordered.Writer.TryComplete();_capture.Writer.TryComplete(); }
    internal static bool SelfTest()=>SelfTestAsync().GetAwaiter().GetResult();
    private static async Task<bool> SelfTestAsync()
    {
        using var scheduler=new RpcWorkScheduler();
        var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var first=scheduler.Schedule("desktop.input","scope",async()=>{entered.SetResult();await release.Task;return new {done=true};});
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(3));
        var executed=false;
        var queued=scheduler.Schedule("desktop.input","scope",()=>{executed=true;return Task.FromResult<object?>(new {done=true});});
        var status=await scheduler.Schedule("desktop.status","",()=>Task.FromResult<object?>(new {ready=true})).WaitAsync(TimeSpan.FromSeconds(3));
        var frame=await scheduler.Schedule("desktop.frame","",()=>Task.FromResult<object?>(new {frame=true})).WaitAsync(TimeSpan.FromSeconds(3));
        if(first.IsCompleted||queued.IsCompleted||executed||status is null||frame is null)return false;
        scheduler.CancelScope("scope");release.SetResult();await first.WaitAsync(TimeSpan.FromSeconds(3));
        try { await queued;return false; } catch(InvalidOperationException error) when(error.Message=="operation_cancelled_before_start") {}
        if(executed)return false;
        var next=await scheduler.Schedule("desktop.input","scope",()=>Task.FromResult<object?>(new {fresh=true}));
        return next is not null;
    }
}
