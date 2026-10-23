import crypto from 'node:crypto';
import { createNdjsonReader, createNdjsonWriter, DEVICE_DUPLEX_PROTOCOL, DEVICE_DUPLEX_SERVER_EPOCH, DeviceDuplexError } from './device-duplex-transport.mjs';

const ACTIVE_STREAMS=new Map();
const RESUME_STATE=new Map();
const RESUME_TTL_MS=10*60_000;
const resumeKey=(deviceId,transportEpoch)=>String(deviceId)+'|'+String(transportEpoch);
function resumeRow(deviceId,transportEpoch,now=Date.now()){
  for(const [key,row] of RESUME_STATE)if(now-row.updatedAt>RESUME_TTL_MS)RESUME_STATE.delete(key);
  const key=resumeKey(deviceId,transportEpoch),current=RESUME_STATE.get(key);
  if(current){current.updatedAt=now;return current;}
  const row={lastClientSeq:0,updatedAt:now};RESUME_STATE.set(key,row);return row;
}
function commitClientSeq(row,seq){row.lastClientSeq=Math.max(row.lastClientSeq,Math.max(0,Number(seq)||0));row.updatedAt=Date.now();return row.lastClientSeq;}

let serial=0;
const CONFIDENTIAL_MAX_REPLY=12000;
const CONFIDENTIAL_LIMIT=6;
export async function confidentialProjectRequest({deviceId,sessionId,projectId,query='',maxChars=8000,timeoutMs=10000,proof,requestId}={}){
  const stream=ACTIVE_STREAMS.get(String(deviceId||''));
  if(!stream?.projectRead)throw new DeviceDuplexError('continuity_device_stream_unavailable',503);
  if(typeof projectId!=='string'||!/^[a-f0-9-]{36}$/.test(projectId))throw new DeviceDuplexError('continuity_project_id_invalid',400);
  if(typeof sessionId!=='string'||sessionId.length>160||!sessionId)throw new DeviceDuplexError('continuity_session_invalid',400);
  if(typeof query!=='string'||query.length>300)throw new DeviceDuplexError('continuity_query_invalid',400);
  if(!Number.isInteger(maxChars)||maxChars<512||maxChars>8000)throw new DeviceDuplexError('continuity_context_limit',400);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>15000)throw new DeviceDuplexError('continuity_timeout_invalid',400);
  // The signed proof must bind the EXACT requestId that is sent to the
  // device; never permit the Duplex stream to replace it after signing.
  if(!proof||typeof requestId!=='string'||!/^[a-f0-9-]{36}$/.test(requestId))
   throw new DeviceDuplexError('continuity_operator_delegation_required',403);
  return stream.projectRead({sessionId,projectId,query,maxChars,proof,requestId},timeoutMs);
}


function cleanError(error){
  return {error:String(error?.message||error||'duplex_error').slice(0,160),status:Number(error?.status)||500};
}
function helloTimeout(reader,ms=8000){
  let timer;
  return Promise.race([
    reader.next(),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new DeviceDuplexError('duplex_hello_timeout',408)),ms);timer.unref?.();})
  ]).finally(()=>{if(timer)clearTimeout(timer);});
}

export async function handleDeviceDuplexSession(req,res,{
  authorizeHello,
  resume,
  poll,
  onResult,
  onLive,
  onHeartbeat,
  onEvent=()=>{},
  waitMs=15000
}={}){
  const reader=createNdjsonReader(req,{maxFrameBytes:20*1024*1024,maxQueuedFrames:256});
  const hello=await helloTimeout(reader);
  if(!hello)throw new DeviceDuplexError('duplex_hello_required',400);
  const authorized=await authorizeHello(hello);
  const deviceId=String(authorized?.deviceId||''),transportEpoch=String(authorized?.transportEpoch||'');
  if(!deviceId||!transportEpoch)throw new DeviceDuplexError('duplex_identity_required',400);

  res.writeHead(200,{
    'content-type':'application/x-ndjson; charset=utf-8',
    'cache-control':'no-store',
    'connection':'keep-alive',
    'x-accel-buffering':'no'
  });
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);
  res.socket?.setKeepAlive?.(true,10000);
  const writer=createNdjsonWriter(res,{maxPendingBytes:4*1024*1024,maxFrameBytes:2*1024*1024});

  const streamId=`ds_${(++serial).toString(36)}_${Date.now().toString(36)}`,resumeState=resumeRow(deviceId,transportEpoch);
  let closed=false,serverSeq=0,lastClientSeq=resumeState.lastClientSeq,lastAckedServerSeq=0,pendingCommandId=null,pendingResolve=null;
  const pendingProjects=new Map();
  let closeResolve;
  const closedPromise=new Promise(resolve=>{closeResolve=resolve;});
  const send=(type,data={})=>writer.send({type,protocol:DEVICE_DUPLEX_PROTOCOL,serverEpoch:DEVICE_DUPLEX_SERVER_EPOCH,streamId,serverSeq:++serverSeq,...data});
  const close=reason=>{
    if(closed)return;
    closed=true;
    if(pendingResolve){pendingResolve({closed:true,reason});pendingResolve=null;}
    for(const [id,waiting] of pendingProjects){clearTimeout(waiting.timer);waiting.reject(new DeviceDuplexError('continuity_device_stream_closed',503));}
    pendingProjects.clear();
    const current=ACTIVE_STREAMS.get(deviceId);
    if(current?.streamId===streamId)ACTIVE_STREAMS.delete(deviceId);
    try{writer.close();}catch{}
    closeResolve?.({reason});
    onEvent({type:'device_duplex_closed',deviceId,streamId,reason:String(reason||'closed').slice(0,80),serverSeq,lastClientSeq,lastAckedServerSeq});
  };

  const prior=ACTIVE_STREAMS.get(deviceId);
  if(prior)prior.close('replaced');
  const projectRead=(data,timeoutMs)=>new Promise((resolve,reject)=>{
    if(closed)return reject(new DeviceDuplexError('continuity_device_stream_closed',503));
    if(pendingProjects.size>=CONFIDENTIAL_LIMIT)return reject(new DeviceDuplexError('continuity_too_many_requests',429));
    const requestId=data.requestId;
    if(typeof requestId!=='string'||pendingProjects.has(requestId))
     return reject(new DeviceDuplexError('continuity_operator_request_reused',409));
    const timer=setTimeout(()=>{
      pendingProjects.delete(requestId);
      reject(new DeviceDuplexError('continuity_device_response_timeout',504));
    },timeoutMs);
    timer.unref?.();
    pendingProjects.set(requestId,{resolve,reject,timer});
    // This bypasses Gold persisted jobs entirely. It is still transiently
    // visible in server memory and the HTTPS/LAN transport.
    Promise.resolve(send('project-request',{request:{requestId,...data}})).catch(()=>{
      const waiter=pendingProjects.get(requestId);
      if(!waiter)return;
      pendingProjects.delete(requestId);clearTimeout(waiter.timer);
      waiter.reject(new DeviceDuplexError('continuity_device_send_failed',503));
    });
  });
  ACTIVE_STREAMS.set(deviceId,{streamId,close,projectRead});
  onEvent({type:'device_duplex_opened',deviceId,streamId,serverEpoch:DEVICE_DUPLEX_SERVER_EPOCH,transportEpoch});

  try{
    await resume?.(authorized);
    await send('hello-ack',{accepted:true,transportEpoch,lastClientSeq,...(authorized.helloAck||{})});

    const frameLoop=(async()=>{
      for(;;){
        const frame=await reader.next();
        if(closed)return;
        if(frame==null){close('request_end');return;}
        const frameEpoch=String(frame.transportEpoch||transportEpoch);
        if(frameEpoch!==transportEpoch)throw new DeviceDuplexError('duplex_transport_epoch_mismatch',409);
        const clientSeq=Number(frame.clientSeq);
        if(!Number.isSafeInteger(clientSeq)||clientSeq<1)throw new DeviceDuplexError('invalid_duplex_client_seq',400);
        if(clientSeq<=lastClientSeq){
          await send('client-ack',{clientSeq,duplicate:true,lastClientSeq});
          continue;
        }
        if(clientSeq>lastClientSeq+1){
          await send('client-ack',{clientSeq,accepted:false,needReplay:true,lastClientSeq});
          continue;
        }
        const type=String(frame.type||'');
        if(type==='ack'){
          const ackSeq=Math.max(0,Number(frame.serverSeq)||0);
          lastAckedServerSeq=Math.max(lastAckedServerSeq,ackSeq);
          lastClientSeq=commitClientSeq(resumeState,clientSeq);
          await send('client-ack',{clientSeq,lastClientSeq});
          continue;
        }
        if(type==='result'){
          let ack;
          try{ack=await onResult?.(authorized,frame.result||{});}
          catch(error){
            if(String(error?.message||'')==='command_not_found'){
              lastClientSeq=commitClientSeq(resumeState,clientSeq);
              await send('result-ack',{clientSeq,lastClientSeq,commandId:String(frame.result?.commandId||''),accepted:true,orphan:true});
              if(pendingCommandId===String(frame.result?.commandId||'')){pendingResolve?.({orphan:true});pendingResolve=null;pendingCommandId=null;}
              continue;
            }
            const clean=cleanError(error);
            await send('result-ack',{clientSeq,lastClientSeq,commandId:String(frame.result?.commandId||''),accepted:false,...clean});
            throw error;
          }
          lastClientSeq=commitClientSeq(resumeState,clientSeq);
          await send('result-ack',{clientSeq,lastClientSeq,commandId:String(frame.result?.commandId||''),accepted:ack?.accepted!==false,duplicate:Boolean(ack?.duplicate)});
          if(pendingCommandId===String(frame.result?.commandId||'')){pendingResolve?.({accepted:true});pendingResolve=null;pendingCommandId=null;}
          continue;
        }
        if(type==='project-result'){
          // One-shot in-memory result, never put in job stdout/resultData,
          // activity rings, metrics events, PostgreSQL or Redis.
          const reply=frame.response;
          const requestId=String(reply?.requestId||'');
          const waiter=pendingProjects.get(requestId);
          if(waiter){
            pendingProjects.delete(requestId);clearTimeout(waiter.timer);
            const bytes=Buffer.byteLength(JSON.stringify(reply||{}));
            if(bytes>CONFIDENTIAL_MAX_REPLY)waiter.reject(new DeviceDuplexError('continuity_reply_too_large',413));
            else if(reply?.ok===true&&reply?.data&&typeof reply.data.content==='string'
               &&reply.data.content.length<=8000)waiter.resolve(reply.data);
            else waiter.reject(new DeviceDuplexError(
              ['continuity_remote_read_denied','continuity_memory_disabled','continuity_project_missing','continuity_remote_unavailable'].includes(reply?.error)
              ?reply.error:'continuity_device_read_failed',403));
          }
          lastClientSeq=commitClientSeq(resumeState,clientSeq);
          await send('client-ack',{clientSeq,lastClientSeq});
          continue;
        }
        if(type==='live'){
          const live=await onLive?.(authorized,frame.payload||{});
          lastClientSeq=commitClientSeq(resumeState,clientSeq);
          await send('live-ack',{clientSeq,lastClientSeq,stateSeq:Number(live?.live?.stateSeq)||0,inputSeq:Number(live?.live?.inputSeq)||0,rootEpoch:Number(live?.live?.rootEpoch)||0});
          continue;
        }
        if(type==='heartbeat'){
          const heartbeat=await onHeartbeat?.(authorized,frame.payload||{});
          lastClientSeq=commitClientSeq(resumeState,clientSeq);
          await send('heartbeat-ack',{clientSeq,lastClientSeq,...(heartbeat||{})});
          continue;
        }
        if(type==='close'){
          lastClientSeq=commitClientSeq(resumeState,clientSeq);
          await send('client-ack',{clientSeq,lastClientSeq,closing:true});
          close('client_close');return;
        }
        throw new DeviceDuplexError('duplex_frame_type_unsupported',400);
      }
    })();

    const commandPump=(async()=>{
      while(!closed){
        const channel=await poll(authorized,waitMs,()=>closed);
        if(closed)return;
        if(channel?.command){
          pendingCommandId=String(channel.command.commandId||'');
          const settled=new Promise(resolve=>{pendingResolve=resolve;});
          await send('command',{command:channel.command});
          await Promise.race([settled,closedPromise]);
          continue;
        }
        await send('heartbeat',{idle:true,lastClientSeq,lastAckedServerSeq});
      }
    })();

    let thrown=null;
    try{await Promise.race([frameLoop,commandPump]);}
    catch(error){thrown=error;try{await send('error',cleanError(error));}catch{}}
    finally{close(thrown?'error':'closed');await Promise.allSettled([frameLoop,commandPump]);}
    if(thrown)onEvent({type:'device_duplex_error',deviceId,streamId,...cleanError(thrown)});
    return {streamId,closed:true};
  }catch(error){
    close('setup_error');
    throw error;
  }
}

export function activeDeviceDuplexStreams(){
  return [...ACTIVE_STREAMS.values()].map(row=>({streamId:row.streamId}));
}
