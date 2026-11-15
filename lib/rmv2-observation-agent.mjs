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
   row.observationMap=null;
   const identity={sessionId:row.sessionId,agentId:row.agentId,desktopSessionId:row.desktopSessionId,observationId:result.observationId};
   row.closeObservationRelay=()=>send({...identity,closed:true});
   return {...result,closeRequired:true,readTool:'light_remote_desktop_observation_read',backgroundRenewsLease:false};
  }
  if(options.observationId!==row.observationId)throw Error('observation_id_mismatch');
  if(request.op==='observe-stop'){
   const result=await requestNative('observation-stop',nativeArgs,{timeoutMs:7000});guard();
   try{await row.closeObservationRelay?.();}finally{row.closeObservationRelay=null;row.observationId=null;row.observationMap=null;}
   return result;
  }
  const readStarted=mono();const native=await requestNative('observation-read',nativeArgs,{timeoutMs:7000});guard();
  const packet=observationPacket(native),o=packet.observation;
  if(packet.epoch!==row.nativeEpoch||packet.displayTopologyId!==row.displayTopologyId||o.observationId!==row.observationId)throw Error('observation_frame_binding_invalid');
  const validationFresh=Number.isFinite(o.sourceValidationAgeMs)&&o.sourceValidationAgeMs>=0&&o.sourceValidationAgeMs<=3000;
  const base=row.observationMap;
  const knownUnchanged=o.state==='no_change'&&base?.observationId===o.observationId&&base?.observationEpoch===o.observationEpoch&&base?.sourceSeq===o.sourceSeq;
  if(o.image&&!validationFresh)throw Error('observation_source_stale');
  let frameMap;
  if(validationFresh&&(o.image||knownUnchanged)){
   // The source revalidated the cached pixels. Preserve capturedAt separately;
   // input freshness uses source validation, never an invented capture time.
   frameMap={frameSeq:packet.frameSeq,capturedMono:readStarted-o.sourceValidationAgeMs,displayTopologyId:packet.displayTopologyId,width:o.width,height:o.height,bounds:o.physicalBounds};
  }
  if(o.image){
   await send({sessionId:row.sessionId,agentId:row.agentId,desktopSessionId:row.desktopSessionId,observationId:row.observationId,...packet});guard();
  }
  if(frameMap){row.lastFrameMap=frameMap;row.observationMap={observationId:o.observationId,observationEpoch:o.observationEpoch,sourceSeq:o.sourceSeq};}
  const frameCoordinatesAvailable=Boolean(validationFresh&&(o.image||knownUnchanged));
  return {...observationMetadata(packet),frameSeq:frameCoordinatesAvailable?packet.frameSeq:null,frameCoordinatesAvailable,...(o.image?{imageTicket:observationTicket(packet)}:{}),imageDelivery:o.image?'mcp-image-content':'no-new-image',backgroundRenewsLease:false};
 }finally{row.observationBusy=false;}
}
