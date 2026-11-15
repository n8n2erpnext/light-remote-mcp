import {observationOptions,observationPacket,observationMetadata,observationTicket} from './rmv2-observation.mjs';
export async function runObservation(row,owner,request,{requestNative,isCurrent,send,mono=()=>performance.now()}={}){
 const options=observationOptions(request,request.op);
 const guard=()=>{if(row.desktopSessionId!==options.desktopSessionId||row.sessionId!==owner.sessionId||row.agentId!==owner.agentId||row.closing||row.nativeStale||!isCurrent(row)||Date.now()>=row.expiresAt)throw Error('observation_scope_unavailable');};
 guard();if(row.observationBusy)throw Error('observation_busy');row.observationBusy=true;
 const nativeArgs={visualSessionId:row.visualSessionId,leaseToken:row.leaseToken,...options};
 try{
  if(request.op==='observe-start'){
   if(row.observationId)throw Error('observation_already_started_stop_first');
   const result=await requestNative('observation-start',nativeArgs,{timeoutMs:7000});guard();
   if(!/^obs_[a-f0-9]{32}$/.test(result.observationId||'')||result.epoch!==row.nativeEpoch)throw Error('observation_start_binding_invalid');
   row.observationId=result.observationId;
   const identity={sessionId:row.sessionId,agentId:row.agentId,desktopSessionId:row.desktopSessionId,observationId:result.observationId};
   row.closeObservationRelay=()=>send({...identity,closed:true});
   return {...result,closeRequired:true,readTool:'light_remote_desktop_observation_read',backgroundRenewsLease:false};
  }
  if(options.observationId!==row.observationId)throw Error('observation_id_mismatch');
  if(request.op==='observe-stop'){
   const result=await requestNative('observation-stop',nativeArgs,{timeoutMs:7000});guard();
   try{await row.closeObservationRelay?.();}finally{row.closeObservationRelay=null;row.observationId=null;}
   return result;
  }
  const readStarted=mono();const native=await requestNative('observation-read',nativeArgs,{timeoutMs:7000});guard();
  const packet=observationPacket(native),o=packet.observation;
  if(packet.epoch!==row.nativeEpoch||packet.displayTopologyId!==row.displayTopologyId||o.observationId!==row.observationId)throw Error('observation_frame_binding_invalid');
  if(o.image){
   if(!Number.isFinite(o.sourceValidationAgeMs)||o.sourceValidationAgeMs<0||o.sourceValidationAgeMs>3000)throw Error('observation_source_stale');
   // The source revalidated the cached pixels. Preserve capturedAt separately;
   // input freshness uses source validation, never an invented capture time.
   row.lastFrameMap={frameSeq:packet.frameSeq,capturedMono:readStarted-o.sourceValidationAgeMs,displayTopologyId:packet.displayTopologyId,width:o.width,height:o.height,bounds:o.physicalBounds};
   await send({sessionId:row.sessionId,agentId:row.agentId,desktopSessionId:row.desktopSessionId,observationId:row.observationId,...packet});guard();
  }
  return {...observationMetadata(packet),...(o.image?{imageTicket:observationTicket(packet)}:{}),imageDelivery:o.image?'mcp-image-content':'no-new-image',backgroundRenewsLease:false};
 }finally{row.observationBusy=false;}
}
