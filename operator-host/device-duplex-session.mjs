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
  let closeResolve;
  const closedPromise=new Promise(resolve=>{closeResolve=resolve;});
  const send=(type,data={})=>writer.send({type,protocol:DEVICE_DUPLEX_PROTOCOL,serverEpoch:DEVICE_DUPLEX_SERVER_EPOCH,streamId,serverSeq:++serverSeq,...data});
  const close=reason=>{
    if(closed)return;
    closed=true;
    if(pendingResolve){pendingResolve({closed:true,reason});pendingResolve=null;}
    const current=ACTIVE_STREAMS.get(deviceId);
    if(current?.streamId===streamId)ACTIVE_STREAMS.delete(deviceId);
    try{writer.close();}catch{}
    closeResolve?.({reason});
    onEvent({type:'device_duplex_closed',deviceId,streamId,reason:String(reason||'closed').slice(0,80),serverSeq,lastClientSeq,lastAckedServerSeq});
  };

  const prior=ACTIVE_STREAMS.get(deviceId);
  if(prior)prior.close('replaced');
  ACTIVE_STREAMS.set(deviceId,{streamId,close});
  onEvent({type:'device_duplex_opened',deviceId,streamId,serverEpoch:DEVICE_DUPLEX_SERVER_EPOCH,transportEpoch});

  try{
    await resume?.(authorized);
    await send('hello-ack',{accepted:true,transportEpoch,lastClientSeq,...(authorized.helloAck||{})});

    const frameLoop=(async()=>{
      for(;;){
        const frame=await reader.next();
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
        const channel=await poll(authorized,waitMs);
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
