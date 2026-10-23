import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clean=(value,max=256)=>String(value??'').slice(0,max);
export const DEVICE_DUPLEX_PROTOCOL='light-remote-duplex-v1';

export class CommandExecutionCoordinator{
  constructor(){this.active=new Map();}
  async run(commandId,transport,execute){
    const id=clean(commandId,160);if(!id)throw new Error('command_id_required');
    const current=this.active.get(id);
    if(current)return {owner:false,transport:current.transport,result:await current.promise};
    const row={transport:clean(transport,40)||'unknown',promise:null};
    row.promise=Promise.resolve().then(execute);this.active.set(id,row);
    try{return {owner:true,transport:row.transport,result:await row.promise};}
    finally{if(this.active.get(id)===row)this.active.delete(id);}
  }
  size(){return this.active.size;}
}

export class DeviceDuplexClient{
  constructor({hub,hello,onCommand,onProjectRequest,onHelloAck,onHeartbeatAck,heartbeatPayload,log=()=>{},maxPending=128,heartbeatMs=5000,responseIdleMs=35000,executionStaleMs=0}={}){
    this.hub=String(hub||'').replace(/\/$/,'');this.hello=hello;this.onCommand=onCommand;this.onProjectRequest=onProjectRequest;this.onHelloAck=onHelloAck;this.onHeartbeatAck=onHeartbeatAck;this.heartbeatPayload=heartbeatPayload;this.log=log;
    this.maxPending=Math.max(16,Math.min(Number(maxPending)||128,512));this.heartbeatMs=Math.max(2000,Math.min(Number(heartbeatMs)||5000,15000));this.responseIdleMs=Math.max(3000,Math.min(Number(responseIdleMs)||35000,120000));this.executionStaleMs=Number(executionStaleMs)>0?Math.max(1000,Math.min(Number(executionStaleMs),7300000)):0;
    this.transportEpoch='dte_'+crypto.randomBytes(12).toString('base64url');this.running=false;this.ready=false;this.req=null;this.loop=null;this.buffer='';this.first=true;
    this.clientSeq=0;this.ackedClientSeq=0;this.lastServerSeq=0;this.serverEpoch=null;this.pending=new Map();this.commandRuns=new Map();this.commandResults=new Map();this.unresolvedExecutions=new Set();this.heartbeatTimer=null;this.responseWatchdogTimer=null;this.lastInboundMonotonic=0;this.readyWaiters=[];
    this.metrics={connects:0,reconnects:0,disconnects:0,commands:0,results:0,suppressedResults:0,liveFrames:0,heartbeatFrames:0,acks:0,replays:0,backpressure:0,bytesSent:0,bytesReceived:0,serverEpochChanges:0,lastReadyAt:0,lastDisconnectAt:0,lastInboundAt:0,receiveStaleDisconnects:0,executorStallDetections:0,lastConnectionErrorCode:null,lastConnectionErrorAt:0,readyTimeouts:0};
  }
  status(){return {active:this.running,ready:this.ready,transportEpoch:this.transportEpoch,clientSeq:this.clientSeq,ackedClientSeq:this.ackedClientSeq,lastServerSeq:this.lastServerSeq,serverEpoch:this.serverEpoch,pending:this.pending.size,activeCommands:this.commandRuns.size,responseIdleMs:this.responseIdleMs,executorDegraded:this.unresolvedExecutions.size>0,unresolvedExecutions:this.unresolvedExecutions.size,...this.metrics};}
  start(){if(!this.running){this.running=true;this.loop=this._loop();}return this;}
  async waitReady(timeoutMs=1500){if(this.ready)return true;this.start();return new Promise(resolve=>{const row={resolve,timer:null};row.timer=setTimeout(()=>{this.readyWaiters=this.readyWaiters.filter(x=>x!==row);resolve(false);},Math.max(50,Number(timeoutMs)||1500));row.timer.unref?.();this.readyWaiters.push(row);});}
  _settleReady(value){for(const row of this.readyWaiters.splice(0)){clearTimeout(row.timer);row.resolve(Boolean(value));}}
  async close(reason='closed'){this.running=false;this._stopHeartbeat();this._settleReady(false);try{if(this.ready&&this.req&&!this.req.destroyed){await this._sendTracked('close',{reason:clean(reason,80)});await sleep(80);}}catch{}this.ready=false;try{this.req?.end();}catch{}this.req=null;try{await Promise.race([this.loop||Promise.resolve(),sleep(1000)]);}catch{}this.transportEpoch='dte_'+crypto.randomBytes(12).toString('base64url');this.clientSeq=0;this.ackedClientSeq=0;this.lastServerSeq=0;this.serverEpoch=null;this.pending.clear();}
  async sendLive(payload={}){if(!this.ready)return false;await this._sendTracked('live',{payload});this.metrics.liveFrames++;return true;}
  async sendHeartbeat(payload={}){if(!this.ready)return false;await this._sendTracked('heartbeat',{payload});this.metrics.heartbeatFrames++;return true;}
  async _loop(){let delay=200;while(this.running){try{await this._connect();delay=200;}catch(error){if(this.running){const raw=String(error?.message||'');const errorCode=/^device_duplex_[a-z0-9_]{1,90}$/.test(raw)?raw:/^[A-Z0-9_]{2,64}$/.test(String(error?.code||''))?String(error.code):'transport_error';this.metrics.lastConnectionErrorCode=errorCode;this.metrics.lastConnectionErrorAt=Date.now();if(errorCode==='device_duplex_ready_timeout')this.metrics.readyTimeouts++;this.log({event:'device_duplex_connection_lost',error:String(error?.message||error)});}}if(!this.running)break;this.ready=false;this._stopHeartbeat();this.metrics.disconnects++;this.metrics.lastDisconnectAt=Date.now();this.first=false;await sleep(delay);delay=Math.min(delay*2,4000);}}
  _connect(){return new Promise((resolve,reject)=>{let finished=false,readyTimer=null;const done=error=>{if(finished)return;finished=true;if(readyTimer)clearTimeout(readyTimer);this.ready=false;this._stopHeartbeat();this.req=null;error?reject(error):resolve();};const url=new URL('/device-channel/stream',this.hub),transport=url.protocol==='http:'?http:https;
    const req=transport.request(url,{method:'POST',headers:{'content-type':'application/x-ndjson','accept':'application/x-ndjson','cache-control':'no-store'},agent:false},res=>{if(res.statusCode!==200){res.resume();done(new Error('device_duplex_http_'+res.statusCode));return;}res.setEncoding('utf8');this.buffer='';res.on('data',chunk=>{this.metrics.bytesReceived+=Buffer.byteLength(chunk);this.buffer+=chunk;if(this.buffer.length>8*1024*1024){req.destroy(new Error('device_duplex_response_too_large'));return;}for(;;){const at=this.buffer.indexOf('\n');if(at<0)break;const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);if(line.trim())void this._handleLine(line).catch(error=>{this.log({event:'device_duplex_frame_failed',error:String(error?.message||error)});try{req.destroy(error);}catch{}});}});res.on('end',()=>done(new Error('device_duplex_response_ended')));res.on('error',done);});
    this.req=req;this.metrics.connects++;if(this.metrics.connects>1)this.metrics.reconnects++;req.setNoDelay?.(true);req.on('error',done);req.flushHeaders?.();let hello;try{hello=this.hello?.({protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:this.transportEpoch,resumeClientSeq:this.ackedClientSeq,clientSeq:this.clientSeq})||null;}catch(error){done(error);return;}if(!hello){done(new Error('device_duplex_hello_required'));return;}try{this._writeRaw(hello);}catch(error){done(error);return;}readyTimer=setTimeout(()=>{if(!this.ready)req.destroy(new Error('device_duplex_ready_timeout'));},10000);readyTimer.unref?.();});}
  async _handleLine(line){let frame;try{frame=JSON.parse(line);}catch{throw new Error('device_duplex_invalid_json');}if(!frame||typeof frame!=='object'||Array.isArray(frame))throw new Error('device_duplex_invalid_frame');const type=String(frame.type||'');
    if(type==='hello-ack'){const old=this.serverEpoch,next=clean(frame.serverEpoch,160)||null,changed=Boolean(old&&next&&old!==next);if(changed)this.metrics.serverEpochChanges++;this.serverEpoch=next;this.lastServerSeq=0;this._ackClient(Math.max(0,Number(frame.lastClientSeq)||0));this.ready=true;this.metrics.lastReadyAt=Date.now();this.metrics.lastInboundAt=this.metrics.lastReadyAt;this.lastInboundMonotonic=performance.now();this._settleReady(true);this._startHeartbeat();try{await this.onHelloAck?.(frame,{serverEpochChanged:changed,first:!old});}catch(error){this.log({event:'device_duplex_hello_callback_failed',error:String(error?.message||error)});}await this._ackServer(frame);await this._replayPending(Math.max(0,Number(frame.lastClientSeq)||0));this.log({event:'device_duplex_ready',serverEpoch:this.serverEpoch,lastClientSeq:Number(frame.lastClientSeq)||0});return;}
    if(!this.ready)return;
    if(['client-ack','result-ack','live-ack','heartbeat-ack','command','project-request','heartbeat','error','close'].includes(type)){this.metrics.lastInboundAt=Date.now();this.lastInboundMonotonic=performance.now();}
    if(['client-ack','result-ack','live-ack','heartbeat-ack'].includes(type)){this._ackClient(Math.max(Number(frame.lastClientSeq)||0,Number(frame.clientSeq)||0));if(type==='heartbeat-ack')try{await this.onHeartbeatAck?.(frame);}catch{}if(frame.needReplay)await this._replayPending(Math.max(0,Number(frame.lastClientSeq)||0));return;}
    if(type==='command'){await this._ackServer(frame);void this._runCommand(frame.command).catch(error=>this.log({event:'device_duplex_command_failed',commandId:clean(frame.command?.commandId,128),error:String(error?.message||error)}));return;}
    if(type==='project-request'){
      await this._ackServer(frame);
      // Do not put request or response content into commandResults/replay
      // buffers that are designed for ordinary job receipts.
      void this._runProjectRead(frame.request).catch(()=>{
        this.log({event:'continuity_project_read_failed',errorCode:'continuity_remote_read_failed'});
      });
      return;
    }
    if(type==='heartbeat'){await this._ackServer(frame);return;}
    if(type==='error'){await this._ackServer(frame);throw new Error(clean(frame.error,512)||'device_duplex_server_error');}
    if(type==='close'){await this._ackServer(frame);try{this.req?.destroy(new Error('device_duplex_server_close'));}catch{}return;}
  }
  async _runProjectRead(request={}){
    const requestId=String(request?.requestId||'');
    if(!/^[a-f0-9-]{36}$/.test(requestId))return;
    let response={requestId,ok:false,error:'continuity_remote_unavailable'};
    try{
      if(typeof this.onProjectRequest==='function'){
        const result=await this.onProjectRequest(request);
        if(result&&typeof result==='object'&&typeof result.content==='string'
          &&result.content.length<=8000){
          response={requestId,ok:true,data:result};
        }else response={requestId,ok:false,error:'continuity_device_read_failed'};
      }
    }catch(error){
      const allowed=new Set(['continuity_remote_read_denied','continuity_memory_disabled','continuity_project_missing','continuity_remote_unavailable']);
      const msg=String(error?.message||'');
      response={requestId,ok:false,error:allowed.has(msg)?msg:'continuity_device_read_failed'};
    }
    // No retry beyond transport reconnect; fail closed on broken channel.
    if(this.ready)await this._sendTracked('project-result',{response});
  }
  _executionDeadline(command={}){
    if(this.executionStaleMs>0)return this.executionStaleMs;
    // Detect stalled execution before Operator's exec timeout + two channel TTLs,
    // leaving time for an authenticated heartbeat to carry the negative evidence.
    // Do not flag a legitimate multi-hour exec merely because it runs >10 min.
    const timeout=Number(command.payload?.timeoutMs);
    const base=command.payload?.type==='exec'&&Number.isFinite(timeout)&&timeout>=1000
      ? Math.max(1000,Math.min(timeout,7200000)):600000;
    return base+20000;
  }
  async _runCommand(command={}){
    const commandId=clean(command.commandId,160);
    if(!commandId)return;
    if(this.commandResults.has(commandId)){
      await this._sendTracked('result',{result:this.commandResults.get(commandId)});
      return;
    }
    let run=this.commandRuns.get(commandId);
    let recoveredFromStall=false;
    if(!run){
      this.metrics.commands++;
      let staleTimer;
      const deadline=this._executionDeadline(command);
      run=Promise.resolve().then(()=>this.onCommand(command)).catch(()=>{
        this.log({event:'device_duplex_executor_rejected',commandId,errorCode:'executor_unhandled_rejection'});
        return {commandId,status:'error',exitCode:125,stdout:'',stderr:'agent execution outcome unknown\n',durationMs:0,executionOutcome:'unknown',data:{ok:false,errorCode:'executor_unhandled_rejection',executionOutcome:'unknown'}};
      });
      this.commandRuns.set(commandId,run);
      staleTimer=setTimeout(()=>{
        // This does NOT cancel execution or invent a result. Its external effect
        // remains unresolved, so new dispatch must not be admitted.
        if(this.commandRuns.get(commandId)!==run)return;
        this.unresolvedExecutions.add(commandId);
        this.metrics.executorStallDetections++;
        this.log({event:'device_duplex_executor_stalled',commandId,deadlineMs:deadline});
      },deadline);
      staleTimer.unref?.();
      void run.finally(()=>{
        clearTimeout(staleTimer);
        if(this.commandRuns.get(commandId)===run)this.commandRuns.delete(commandId);
        if(this.unresolvedExecutions.delete(commandId))recoveredFromStall=true;
      });
    }
    const result=await run;
    // Publish recovered Agent readiness before the result unblocks server
    // commandPump. Otherwise an old poll snapshot can transiently restore
    // executor_unavailable until the next periodic heartbeat.
    if(recoveredFromStall&&this.unresolvedExecutions.size===0&&this.ready){
      try{const payload=await this.heartbeatPayload?.();if(payload)await this.sendHeartbeat(payload);}
      catch(error){this.log({event:'device_duplex_recovery_heartbeat_failed',commandId,errorCode:'heartbeat_unavailable'});}
    }
    if(result===undefined){this.metrics.suppressedResults++;return;}
    this.commandResults.set(commandId,result);
    while(this.commandResults.size>64)this.commandResults.delete(this.commandResults.keys().next().value);
    await this._sendTracked('result',{result});
    this.metrics.results++;
  }
  _startHeartbeat(){this._stopHeartbeat();this.heartbeatTimer=setInterval(async()=>{if(!this.ready)return;try{const payload=await this.heartbeatPayload?.();if(payload)await this.sendHeartbeat(payload);}catch(error){this.log({event:'device_duplex_heartbeat_failed',error:String(error?.message||error)});}},this.heartbeatMs);this.heartbeatTimer.unref?.();this._startResponseWatchdog();}
  _startResponseWatchdog(){
    this._stopResponseWatchdog();
    this.responseWatchdogTimer=setInterval(()=>{
      if(!this.ready||!this.req||this.req.destroyed||!this.lastInboundMonotonic)return;
      const idleMs=performance.now()-this.lastInboundMonotonic;
      if(idleMs<this.responseIdleMs)return;
      this.metrics.receiveStaleDisconnects++;
      this.log({event:'device_duplex_response_stale',idleMs:Math.round(idleMs)});
      this.req.destroy(new Error('device_duplex_response_stale'));
    },Math.max(750,Math.min(Math.round(this.responseIdleMs/3),5000)));
    this.responseWatchdogTimer.unref?.();
  }
  _stopResponseWatchdog(){if(this.responseWatchdogTimer){clearInterval(this.responseWatchdogTimer);this.responseWatchdogTimer=null;}}
  _stopHeartbeat(){if(this.heartbeatTimer){clearInterval(this.heartbeatTimer);this.heartbeatTimer=null;}this._stopResponseWatchdog();}
  async _ackServer(frame){const seq=Math.max(0,Number(frame.serverSeq)||0);if(!seq||seq<=this.lastServerSeq)return;this.lastServerSeq=seq;await this._sendTracked('ack',{serverSeq:seq});this.metrics.acks++;}
  _ackClient(seq){const value=Math.max(0,Number(seq)||0);if(!value)return;this.ackedClientSeq=Math.max(this.ackedClientSeq,value);for(const key of [...this.pending.keys()])if(key<=this.ackedClientSeq)this.pending.delete(key);}
  async _replayPending(afterSeq){const floor=Math.max(0,Number(afterSeq)||0),rows=[...this.pending.entries()].filter(([seq])=>seq>floor).sort((a,b)=>a[0]-b[0]);for(const [,frame] of rows){await this._writeRaw(frame);this.metrics.replays++;}}
  async _sendTracked(type,data={}){if(!this.ready||!this.req||this.req.destroyed)throw new Error('device_duplex_not_ready');if(this.pending.size>=this.maxPending){this.metrics.backpressure++;try{this.req.destroy(new Error('device_duplex_backpressure'));}catch{}throw new Error('device_duplex_backpressure');}const frame={type,clientSeq:++this.clientSeq,transportEpoch:this.transportEpoch,...data};this.pending.set(frame.clientSeq,frame);await this._writeRaw(frame);return frame.clientSeq;}
  _writeRaw(frame){if(!this.req||this.req.destroyed||this.req.writableEnded)throw new Error('device_duplex_not_connected');const data=JSON.stringify(frame)+'\n',bytes=Buffer.byteLength(data);if(bytes>20*1024*1024)throw new Error('device_duplex_frame_too_large');this.metrics.bytesSent+=bytes;if(this.req.write(data))return Promise.resolve();this.metrics.backpressure++;return new Promise((resolve,reject)=>{let settled=false;const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);this.req?.off('drain',onDrain);this.req?.off('error',onError);error?reject(error):resolve();},onDrain=()=>finish(),onError=error=>finish(error),timer=setTimeout(()=>finish(new Error('device_duplex_drain_timeout')),2000);timer.unref?.();this.req.once('drain',onDrain);this.req.once('error',onError);});}
}
