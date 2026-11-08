using System.IO;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace GptOperator.RealRemoteV2;

internal sealed record BrowserSemanticEvent(
    long Seq,
    long At,
    string Kind,
    string Detail,
    bool ResyncRecommended
);

internal sealed class BrowserSemanticProvider : IDisposable
{
    private const int MaxSessions=4;
    private const int JournalCapacity=512;
    private const int MaxRead=200;
    private const int SignalDebounceMs=40;
    private const int MaxHttpBytes=2*1024*1024;
    private const int MaxWsBytes=4*1024*1024;

    private sealed record BrowserTarget(
        string Id,
        string Type,
        string Title,
        string Url,
        Uri WebSocketUrl
    );

    private sealed class Session : IDisposable
    {
        public required string Id { get; init; }
        public required string Epoch { get; init; }
        public required Uri Endpoint { get; init; }
        public required string TargetId { get; set; }
        public required string TargetTitle { get; set; }
        public required string TargetUrl { get; set; }
        public required int MaxDepth { get; init; }
        public required int MaxNodes { get; init; }
        public required long AttachedAt { get; init; }
        public required ClientWebSocket Socket { get; init; }
        public object Gate { get; }=new();
        public SemaphoreSlim SendGate { get; }=new(1,1);
        public ConcurrentDictionary<long,TaskCompletionSource<JsonElement>> Pending { get; }=new();
        public CancellationTokenSource Cancellation { get; }=new();
        public List<BrowserSemanticEvent> Journal { get; }=new(JournalCapacity);
        public System.Threading.Timer? SignalTimer { get; set; }
        public Task? Receiver { get; set; }
        public long NextCommandId;
        public long StateSeq=1;
        public long DroppedBeforeSeq;
        public bool PendingResync;
        public bool Closed;

        public void Dispose()
        {
            lock(Gate)
            {
                if(Closed) return;
                Closed=true;
            }
            try { SignalTimer?.Dispose(); } catch {}
            try { Cancellation.Cancel(); } catch {}
            foreach(var pair in Pending)
                if(Pending.TryRemove(pair.Key,out var pending))
                    pending.TrySetException(new InvalidOperationException("browser_cdp_closed"));
            try
            {
                if(Socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                    Socket.CloseAsync(WebSocketCloseStatus.NormalClosure,"detach",CancellationToken.None).GetAwaiter().GetResult();
            }
            catch {}
            try { Socket.Dispose(); } catch {}
            try { Cancellation.Dispose(); } catch {}
            try { SendGate.Dispose(); } catch {}
        }
    }

    private static readonly HttpClient Http=CreateHttpClient();
    private readonly object _gate=new();
    private readonly Dictionary<string,Session> _sessions=new(StringComparer.Ordinal);
    private bool _disposed;

    public event Action<object>? Changed;

    public object Attach(
        string cdpEndpoint,
        string targetId="",
        string urlMatch="",
        int maxDepth=8,
        int maxNodes=600)
    {
        ThrowIfDisposed();
        maxDepth=Math.Clamp(maxDepth,1,16);
        maxNodes=Math.Clamp(maxNodes,1,1500);
        targetId=Limit(targetId,256);
        urlMatch=Limit(urlMatch,1024);

        var endpoint=ValidateHttpEndpoint(cdpEndpoint);
        var target=SelectTarget(endpoint,targetId,urlMatch);
        var socket=Connect(target.WebSocketUrl);
        var session=new Session {
            Id="bsem_"+Guid.NewGuid().ToString("N"),
            Epoch="bepoch_"+Guid.NewGuid().ToString("N"),
            Endpoint=endpoint,
            TargetId=target.Id,
            TargetTitle=target.Title,
            TargetUrl=target.Url,
            MaxDepth=maxDepth,
            MaxNodes=maxNodes,
            AttachedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Socket=socket
        };
        session.SignalTimer=new System.Threading.Timer(_=>FlushSignal(session),null,Timeout.Infinite,Timeout.Infinite);

        lock(_gate)
        {
            if(_sessions.Count>=MaxSessions)
            {
                session.Dispose();
                throw new InvalidOperationException("browser_session_limit");
            }
            _sessions.Add(session.Id,session);
        }

        try
        {
            session.Receiver=Task.Run(()=>ReceiveLoop(session));
            _=Command(session,"Accessibility.enable");
            _=Command(session,"DOM.enable");
            _=Command(session,"Page.enable");
            try { _=Command(session,"Page.setLifecycleEventsEnabled",new {enabled=true}); } catch {}
            return SnapshotCore(session,true);
        }
        catch
        {
            lock(_gate) _sessions.Remove(session.Id);
            session.Dispose();
            throw;
        }
    }

    public object Snapshot(string browserSessionId)
    {
        var session=Get(browserSessionId);
        return SnapshotCore(session,false);
    }

    public object Events(string browserSessionId,long afterSeq,int limit=100)
    {
        var session=Get(browserSessionId);
        BrowserSemanticEvent[] page;
        long stateSeq;
        long droppedBeforeSeq;
        bool gap;
        bool hasMore;
        string targetId;
        string targetTitle;
        string targetUrl;

        lock(session.Gate)
        {
            if(afterSeq<0) throw new InvalidOperationException("browser_after_seq_invalid");
            if(afterSeq>session.StateSeq) throw new InvalidOperationException("browser_after_seq_ahead");
            limit=Math.Clamp(limit,1,MaxRead);
            gap=session.DroppedBeforeSeq>0 && afterSeq<session.DroppedBeforeSeq;
            var available=session.Journal.Where(x=>x.Seq>afterSeq).ToArray();
            page=available.Take(limit).ToArray();
            hasMore=available.Length>page.Length;
            stateSeq=session.StateSeq;
            droppedBeforeSeq=session.DroppedBeforeSeq;
            targetId=session.TargetId;
            targetTitle=session.TargetTitle;
            targetUrl=session.TargetUrl;
        }

        return new {
            provider="browser-cdp-v2",
            browserSessionId=session.Id,
            epoch=session.Epoch,
            stateSeq,
            afterSeq,
            gap,
            droppedBeforeSeq,
            hasMore,
            resyncRecommended=gap || page.Any(x=>x.ResyncRecommended),
            target=new {id=targetId,title=targetTitle,url=targetUrl},
            events=page
        };
    }

    public object Detach(string browserSessionId)
    {
        Session session;
        lock(_gate)
        {
            if(!_sessions.Remove(browserSessionId,out session!))
                throw new InvalidOperationException("browser_session_missing");
        }
        long finalSeq;
        lock(session.Gate) finalSeq=session.StateSeq;
        session.Dispose();
        return new {
            provider="browser-cdp-v2",
            browserSessionId=session.Id,
            epoch=session.Epoch,
            detached=true,
            finalStateSeq=finalSeq
        };
    }

    private object SnapshotCore(Session session,bool attached)
    {
        EnsureOpen(session);
        RefreshTargetMetadata(session);
        var result=Command(session,"Accessibility.getFullAXTree",new {depth=session.MaxDepth});
        var nodes=ParseAxNodes(result,session.MaxNodes,out var truncated);
        long stateSeq;
        string targetId;
        string targetTitle;
        string targetUrl;
        lock(session.Gate)
        {
            stateSeq=++session.StateSeq;
            targetId=session.TargetId;
            targetTitle=session.TargetTitle;
            targetUrl=session.TargetUrl;
        }
        return new {
            provider="browser-cdp-v2",
            browserSessionId=session.Id,
            epoch=session.Epoch,
            attached,
            stateSeq,
            scope="target",
            target=new {id=targetId,title=targetTitle,url=targetUrl},
            subscriptions=new {accessibility=true,dom=true,page=true},
            maxDepth=session.MaxDepth,
            maxNodes=session.MaxNodes,
            truncated,
            nodes,
            nextObservation=new {mode="events",afterSeq=stateSeq}
        };
    }

    private static object[] ParseAxNodes(JsonElement result,int maxNodes,out bool truncated)
    {
        if(!result.TryGetProperty("nodes",out var nodes)||nodes.ValueKind!=JsonValueKind.Array)
            throw new InvalidOperationException("browser_ax_nodes_missing");

        var list=new List<object>(Math.Min(maxNodes,512));
        var total=nodes.GetArrayLength();
        foreach(var node in nodes.EnumerateArray())
        {
            if(list.Count>=maxNodes) break;
            var nodeId=JsonString(node,"nodeId",128);
            var backend=JsonLong(node,"backendDOMNodeId");
            var role=AxText(node,"role",128);
            var name=AxText(node,"name",512);
            var value=AxText(node,"value",1024);
            var description=AxText(node,"description",512);
            var ignored=node.TryGetProperty("ignored",out var ignoredNode)
                && ignoredNode.ValueKind is JsonValueKind.True or JsonValueKind.False
                && ignoredNode.GetBoolean();
            var parentId=JsonString(node,"parentId",128);
            var childIds=Array.Empty<string>();
            if(node.TryGetProperty("childIds",out var children)&&children.ValueKind==JsonValueKind.Array)
                childIds=children.EnumerateArray()
                    .Where(x=>x.ValueKind==JsonValueKind.String)
                    .Select(x=>Limit(x.GetString()??"",128))
                    .Where(x=>x.Length>0)
                    .Take(256)
                    .ToArray();

            var focusable=AxPropertyBool(node,"focusable");
            var focused=AxPropertyBool(node,"focused");
            var disabled=AxPropertyBool(node,"disabled");
            var editable=AxPropertyBool(node,"editable");

            list.Add(new {
                nodeId,
                backendDOMNodeId=backend,
                parentId,
                childIds,
                role,
                name,
                value,
                description,
                ignored,
                focusable,
                focused,
                disabled,
                editable
            });
        }
        truncated=total>list.Count;
        return list.ToArray();
    }

    private static bool AxPropertyBool(JsonElement node,string name)
    {
        if(!node.TryGetProperty("properties",out var props)||props.ValueKind!=JsonValueKind.Array) return false;
        foreach(var prop in props.EnumerateArray())
        {
            if(JsonString(prop,"name",64)!=name) continue;
            if(!prop.TryGetProperty("value",out var value)||value.ValueKind!=JsonValueKind.Object) return false;
            if(!value.TryGetProperty("value",out var scalar)) return false;
            return scalar.ValueKind switch {
                JsonValueKind.True=>true,
                JsonValueKind.False=>false,
                JsonValueKind.String=>string.Equals(scalar.GetString(),"true",StringComparison.OrdinalIgnoreCase),
                _=>false
            };
        }
        return false;
    }

    private static string AxText(JsonElement node,string name,int max)
    {
        if(!node.TryGetProperty(name,out var value)||value.ValueKind!=JsonValueKind.Object) return "";
        if(!value.TryGetProperty("value",out var scalar)) return "";
        var text=scalar.ValueKind==JsonValueKind.String?scalar.GetString()??"":scalar.ToString();
        return Limit(text,max);
    }

    private static string JsonString(JsonElement node,string name,int max)
    {
        if(!node.TryGetProperty(name,out var value)||value.ValueKind!=JsonValueKind.String) return "";
        return Limit(value.GetString()??"",max);
    }

    private static long JsonLong(JsonElement node,string name)
    {
        if(!node.TryGetProperty(name,out var value)) return 0;
        if(value.TryGetInt64(out var n)) return n;
        return 0;
    }

    private void RefreshTargetMetadata(Session session)
    {
        BrowserTarget? current=null;
        try
        {
            current=ListTargets(session.Endpoint)
                .FirstOrDefault(x=>string.Equals(x.Id,session.TargetId,StringComparison.Ordinal));
        }
        catch
        {
            return;
        }
        if(current is null)
        {
            AppendEvent(session,"target","missing",true);
            throw new InvalidOperationException("browser_target_missing");
        }
        lock(session.Gate)
        {
            session.TargetTitle=current.Title;
            session.TargetUrl=current.Url;
        }
    }

    private async Task ReceiveLoop(Session session)
    {
        var buffer=new byte[64*1024];
        Exception? failure=null;
        try
        {
            while(!session.Cancellation.IsCancellationRequested && session.Socket.State==WebSocketState.Open)
            {
                using var stream=new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result=await session.Socket.ReceiveAsync(new ArraySegment<byte>(buffer),session.Cancellation.Token);
                    if(result.MessageType==WebSocketMessageType.Close)
                        throw new InvalidOperationException("browser_cdp_closed");
                    stream.Write(buffer,0,result.Count);
                    if(stream.Length>MaxWsBytes)
                        throw new InvalidOperationException("browser_cdp_message_too_large");
                } while(!result.EndOfMessage);

                if(result.MessageType!=WebSocketMessageType.Text) continue;
                using var doc=JsonDocument.Parse(stream.ToArray());
                var root=doc.RootElement;
                if(root.TryGetProperty("id",out var idNode)&&idNode.TryGetInt64(out var id))
                {
                    if(session.Pending.TryRemove(id,out var pending))
                        pending.TrySetResult(root.Clone());
                    continue;
                }
                if(root.TryGetProperty("method",out var methodNode)&&methodNode.ValueKind==JsonValueKind.String)
                    HandleEvent(session,methodNode.GetString()??"",root.TryGetProperty("params",out var p)?p:default);
            }
        }
        catch(OperationCanceledException) when(session.Cancellation.IsCancellationRequested) {}
        catch(Exception ex)
        {
            failure=ex;
        }
        finally
        {
            foreach(var pair in session.Pending)
                if(session.Pending.TryRemove(pair.Key,out var pending))
                    pending.TrySetException(new InvalidOperationException("browser_cdp_receive_failed"));
            if(failure is not null && !session.Cancellation.IsCancellationRequested)
                AppendEvent(session,"connection","closed",true);
        }
    }

    private void HandleEvent(Session session,string method,JsonElement parameters)
    {
        switch(method)
        {
            case "Accessibility.nodesUpdated":
                var count=parameters.TryGetProperty("nodes",out var n)&&n.ValueKind==JsonValueKind.Array?n.GetArrayLength():0;
                AppendEvent(session,"accessibility","nodesUpdated:"+count,false);
                break;
            case "Accessibility.loadComplete":
                AppendEvent(session,"accessibility","loadComplete",true);
                break;
            case "DOM.documentUpdated":
                AppendEvent(session,"structure","documentUpdated",true);
                break;
            case "Page.frameNavigated":
                AppendEvent(session,"navigation","frameNavigated",true);
                break;
            case "Page.navigatedWithinDocument":
                AppendEvent(session,"navigation","sameDocument",true);
                break;
            case "Page.lifecycleEvent":
                var name=parameters.TryGetProperty("name",out var nameNode)&&nameNode.ValueKind==JsonValueKind.String
                    ? Limit(nameNode.GetString()??"",64)
                    : "lifecycle";
                AppendEvent(session,"lifecycle",name,false);
                break;
            case "Page.loadEventFired":
                AppendEvent(session,"lifecycle","loadEventFired",false);
                break;
        }
    }

    private void AppendEvent(Session session,string kind,string detail,bool resync)
    {
        long seq;
        lock(session.Gate)
        {
            if(session.Closed) return;
            seq=++session.StateSeq;
            session.Journal.Add(new BrowserSemanticEvent(
                seq,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                kind,
                Limit(detail,512),
                resync
            ));
            if(session.Journal.Count>JournalCapacity)
            {
                var removed=session.Journal[0];
                session.Journal.RemoveAt(0);
                session.DroppedBeforeSeq=Math.Max(session.DroppedBeforeSeq,removed.Seq);
            }
            session.PendingResync|=resync;
            session.SignalTimer?.Change(SignalDebounceMs,Timeout.Infinite);
        }
    }

    private void FlushSignal(Session session)
    {
        if(_disposed) return;
        long stateSeq;
        bool resync;
        lock(session.Gate)
        {
            if(session.Closed) return;
            stateSeq=session.StateSeq;
            resync=session.PendingResync;
            session.PendingResync=false;
        }
        try
        {
            Changed?.Invoke(new {
                provider="browser-cdp-v2",
                browserSessionId=session.Id,
                stateSeq,
                resyncRecommended=resync
            });
        }
        catch {}
    }

    private JsonElement Command(Session session,string method,object? parameters=null)
    {
        EnsureOpen(session);
        var id=Interlocked.Increment(ref session.NextCommandId);
        var pending=new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        if(!session.Pending.TryAdd(id,pending))
            throw new InvalidOperationException("browser_cdp_command_collision");

        var payload=JsonSerializer.SerializeToUtf8Bytes(new {id,method,@params=parameters??new{}});
        try
        {
            session.SendGate.Wait(session.Cancellation.Token);
            try
            {
                session.Socket.SendAsync(
                    new ArraySegment<byte>(payload),
                    WebSocketMessageType.Text,
                    true,
                    session.Cancellation.Token
                ).GetAwaiter().GetResult();
            }
            finally
            {
                session.SendGate.Release();
            }

            JsonElement root;
            try
            {
                root=pending.Task.WaitAsync(TimeSpan.FromSeconds(3)).GetAwaiter().GetResult();
            }
            catch(TimeoutException)
            {
                throw new InvalidOperationException("browser_cdp_timeout");
            }

            if(root.TryGetProperty("error",out var error))
            {
                var code=error.TryGetProperty("code",out var codeNode)?codeNode.ToString():"";
                var message=error.TryGetProperty("message",out var msgNode)?msgNode.ToString():"";
                throw new InvalidOperationException("browser_cdp_error:"+Limit(code+":"+message,256));
            }
            if(!root.TryGetProperty("result",out var result))
                throw new InvalidOperationException("browser_cdp_result_missing");
            return result.Clone();
        }
        finally
        {
            session.Pending.TryRemove(id,out _);
        }
    }

    private static ClientWebSocket Connect(Uri endpoint)
    {
        var socket=new ClientWebSocket();
        socket.Options.KeepAliveInterval=TimeSpan.FromSeconds(20);
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(3));
        try
        {
            socket.ConnectAsync(endpoint,timeout.Token).GetAwaiter().GetResult();
            return socket;
        }
        catch
        {
            socket.Dispose();
            throw new InvalidOperationException("browser_cdp_connect_failed");
        }
    }

    private static BrowserTarget SelectTarget(Uri endpoint,string targetId,string urlMatch)
    {
        var targets=ListTargets(endpoint).Where(x=>x.Type=="page").ToList();
        if(targets.Count==0) throw new InvalidOperationException("browser_target_not_found");

        if(targetId.Length>0)
            return targets.FirstOrDefault(x=>string.Equals(x.Id,targetId,StringComparison.Ordinal))
                ?? throw new InvalidOperationException("browser_target_not_found");

        if(urlMatch.Length>0)
            return targets.FirstOrDefault(x=>x.Url.Contains(urlMatch,StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("browser_target_not_found");

        var foreground=NativeInput.ReadForeground().Title;
        if(foreground.Length>0)
        {
            var byTitle=targets.FirstOrDefault(x=>
                x.Title.Length>0 &&
                (foreground.Contains(x.Title,StringComparison.OrdinalIgnoreCase)
                 || x.Title.Contains(foreground,StringComparison.OrdinalIgnoreCase)));
            if(byTitle is not null) return byTitle;
        }
        return targets[0];
    }

    private static List<BrowserTarget> ListTargets(Uri endpoint)
    {
        var uri=new Uri(endpoint,"/json/list");
        HttpResponseMessage response;
        try
        {
            response=Http.GetAsync(uri).GetAwaiter().GetResult();
        }
        catch
        {
            throw new InvalidOperationException("browser_cdp_http_failed");
        }
        using(response)
        {
            if(!response.IsSuccessStatusCode)
                throw new InvalidOperationException("browser_cdp_http_"+(int)response.StatusCode);
            if(response.Content.Headers.ContentLength is long length && length>MaxHttpBytes)
                throw new InvalidOperationException("browser_cdp_http_too_large");
            var bytes=response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
            if(bytes.Length>MaxHttpBytes) throw new InvalidOperationException("browser_cdp_http_too_large");
            using var doc=JsonDocument.Parse(bytes);
            if(doc.RootElement.ValueKind!=JsonValueKind.Array)
                throw new InvalidOperationException("browser_target_list_invalid");

            var targets=new List<BrowserTarget>();
            foreach(var item in doc.RootElement.EnumerateArray())
            {
                var type=JsonString(item,"type",32);
                var id=JsonString(item,"id",256);
                var title=JsonString(item,"title",512);
                var url=JsonString(item,"url",2048);
                var ws=JsonString(item,"webSocketDebuggerUrl",4096);
                if(id.Length==0||ws.Length==0) continue;
                if(url.StartsWith("devtools://",StringComparison.OrdinalIgnoreCase)) continue;
                targets.Add(new BrowserTarget(id,type,title,url,ValidateWebSocketEndpoint(ws)));
            }
            return targets;
        }
    }

    private Session Get(string id)
    {
        ThrowIfDisposed();
        if(string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("browser_session_id_required");
        lock(_gate)
        {
            if(!_sessions.TryGetValue(id,out var session))
                throw new InvalidOperationException("browser_session_missing");
            return session;
        }
    }

    private static void EnsureOpen(Session session)
    {
        lock(session.Gate)
        {
            if(session.Closed) throw new InvalidOperationException("browser_cdp_closed");
        }
        if(session.Socket.State!=WebSocketState.Open)
            throw new InvalidOperationException("browser_cdp_not_connected");
    }

    private static HttpClient CreateHttpClient()
    {
        var client=new HttpClient(new HttpClientHandler{UseProxy=false});
        client.Timeout=TimeSpan.FromSeconds(3);
        return client;
    }

    private static Uri ValidateHttpEndpoint(string raw)
    {
        if(!Uri.TryCreate((raw??"").Trim(),UriKind.Absolute,out var uri)
           || !string.Equals(uri.Scheme,Uri.UriSchemeHttp,StringComparison.OrdinalIgnoreCase)
           || !IsLoopbackHost(uri.Host)
           || !string.IsNullOrEmpty(uri.UserInfo)
           || uri.Port<1||uri.Port>65535)
            throw new InvalidOperationException("browser_cdp_endpoint_invalid");
        return new UriBuilder(Uri.UriSchemeHttp,uri.Host,uri.Port).Uri;
    }

    private static Uri ValidateWebSocketEndpoint(string raw)
    {
        if(!Uri.TryCreate((raw??"").Trim(),UriKind.Absolute,out var uri)
           || !string.Equals(uri.Scheme,"ws",StringComparison.OrdinalIgnoreCase)
           || !IsLoopbackHost(uri.Host)
           || !string.IsNullOrEmpty(uri.UserInfo)
           || uri.Port<1||uri.Port>65535)
            throw new InvalidOperationException("browser_cdp_websocket_invalid");
        return uri;
    }

    private static bool IsLoopbackHost(string host)
    {
        if(string.Equals(host,"localhost",StringComparison.OrdinalIgnoreCase)) return true;
        return IPAddress.TryParse(host,out var ip)&&IPAddress.IsLoopback(ip);
    }

    private static string Limit(string value,int max)
    {
        value??="";
        return value.Length<=max?value:value[..max];
    }

    private void ThrowIfDisposed()
    {
        if(_disposed) throw new ObjectDisposedException(nameof(BrowserSemanticProvider));
    }

    public static bool SelfTest()
    {
        try
        {
            var a=ValidateHttpEndpoint("http://127.0.0.1:9222");
            var b=ValidateHttpEndpoint("http://localhost:9223");
            var c=ValidateWebSocketEndpoint("ws://[::1]:9224/devtools/page/test");
            if(a.Port!=9222||b.Port!=9223||c.Port!=9224) return false;

            try { _=ValidateHttpEndpoint("http://8.8.8.8:9222"); return false; }
            catch(InvalidOperationException) {}
            try { _=ValidateWebSocketEndpoint("ws://example.com/devtools/page/test"); return false; }
            catch(InvalidOperationException) {}
            try { _=ValidateHttpEndpoint("https://127.0.0.1:9222"); return false; }
            catch(InvalidOperationException) {}
            return true;
        }
        catch
        {
            return false;
        }
    }

    public void Dispose()
    {
        if(_disposed) return;
        _disposed=true;
        Session[] sessions;
        lock(_gate)
        {
            sessions=_sessions.Values.ToArray();
            _sessions.Clear();
        }
        foreach(var session in sessions) session.Dispose();
    }
}
