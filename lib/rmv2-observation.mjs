import crypto from 'node:crypto';
import {normalizeCaptureRegion} from './rmv2-capture.mjs';

export function observationOptions(request,op){
 if(!/^desk_[A-Za-z0-9_-]{8,160}$/.test(request.desktopSessionId||''))throw Error('observation_desktop_session_required');
 const out={desktopSessionId:request.desktopSessionId};
 if(op==='observe-start'){
  const profile=request.profile??'precision',fps=request.fps??15,region=normalizeCaptureRegion(request.region);
  if(!['precision','overview'].includes(profile)||!Number.isInteger(fps)||fps<1||fps>30)throw Error('observation_options_invalid');
  if(profile==='precision'&&(!region||region.width>384||region.height>384))throw Error('observation_precision_region_required_max384');
  return {...out,profile,fps,...(region?{region}:{})};
 }
 if(!/^obs_[a-f0-9]{32}$/.test(request.observationId||''))throw Error('observation_id_invalid');
 out.observationId=request.observationId;
 if(op==='observe-read'){
  const afterSeq=request.afterSeq??0,waitMs=request.waitMs??1000;
  if(!Number.isSafeInteger(afterSeq)||afterSeq<0||!Number.isInteger(waitMs)||waitMs<0||waitMs>1500)throw Error('observation_read_invalid');
  return {...out,afterSeq,waitMs};
 }
 if(op!=='observe-stop')throw Error('observation_operation_invalid');
 return out;
}
function dimensions(bytes,mime){
 if(mime==='image/png'){
  if(bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR')throw Error('observation_png_invalid');
  return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
 }
 if(bytes[0]!==255||bytes[1]!==216)throw Error('observation_jpeg_invalid');
 for(let i=2;i+8<bytes.length;){
  if(bytes[i++]!==255)throw Error('observation_jpeg_invalid');while(bytes[i]===255)i++;const marker=bytes[i++];
  if(marker===0xda||marker===0xd9)break;if(marker===1||marker>=0xd0&&marker<=0xd7)continue;
  const n=bytes.readUInt16BE(i);if(n<2||i+n>bytes.length)break;
  if([0xc0,0xc1,0xc2].includes(marker))return [bytes.readUInt16BE(i+5),bytes.readUInt16BE(i+3)];i+=n;
 }
 throw Error('observation_jpeg_dimensions_missing');
}
// Validate at both trust boundaries. Never route image bytes through a job.
export function observationPacket(value){
 const o=value?.observation;
 if(!o||!/^obs_[a-f0-9]{32}$/.test(o.observationId||'')||!/^oepoch_[a-f0-9]{32}$/.test(o.observationEpoch||'')||!Number.isSafeInteger(o.sourceSeq)||o.sourceSeq<0||!Number.isSafeInteger(value.frameSeq)||value.frameSeq<1||typeof value.epoch!=='string'||value.epoch.length>160||typeof value.displayTopologyId!=='string'||value.displayTopologyId.length>160)throw Error('observation_binding_invalid');
 const precision=o.profile==='precision',b=o.physicalBounds;
 if(!['precision','overview'].includes(o.profile)||o.sourceBackend!=='dxgi-d3d11'||o.gpuCapture!==true||o.lossless!==precision||o.resampled===precision||!b||![b.x,b.y,b.width,b.height,o.width,o.height].every(Number.isInteger)||b.width<1||b.height<1||o.width<1||o.height<1||o.width>(precision?384:640)||o.height>(precision?384:360)||(precision&&(o.width!==b.width||o.height!==b.height)))throw Error('observation_geometry_invalid');
 if(!['changed','no_change','starting','source_lost','stopped'].includes(o.state)||!Number.isFinite(o.sourceValidationAgeMs)&&o.sourceValidationAgeMs!==null)throw Error('observation_state_invalid');
 const image=o.image;
 if(image){
  if(o.state!=='changed'||o.sourceSeq<1||image.mimeType!==(precision?'image/png':'image/jpeg')||!Number.isInteger(image.dataBytes)||image.dataBytes<1||image.dataBytes>650*1024||typeof image.data!=='string'||image.data.length!==4*Math.ceil(image.dataBytes/3))throw Error('observation_image_budget_invalid');
  const bytes=Buffer.from(image.data,'base64');
  if(bytes.length!==image.dataBytes||bytes.toString('base64')!==image.data||crypto.createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('observation_image_integrity_invalid');
  const [w,h]=dimensions(bytes,image.mimeType);if(w!==o.width||h!==o.height)throw Error('observation_image_dimensions_invalid');
 }else if(o.state==='changed')throw Error('observation_image_missing');
 return {epoch:value.epoch,frameSeq:value.frameSeq,displayTopologyId:value.displayTopologyId,observation:{
  observationId:o.observationId,observationEpoch:o.observationEpoch,sourceSeq:o.sourceSeq,state:o.state,reason:typeof o.reason==='string'?o.reason.slice(0,120):null,
  capturedAt:o.capturedAt,validatedAt:o.validatedAt,capturedAgeMs:o.capturedAgeMs,sourceValidationAgeMs:o.sourceValidationAgeMs,
  sourceBackend:o.sourceBackend,gpuCapture:true,profile:o.profile,lossless:precision,resampled:!precision,width:o.width,height:o.height,physicalBounds:{x:b.x,y:b.y,width:b.width,height:b.height},
  stats:{changedFrames:o.sourceSeq,intermediateChangesSinceRead:Number(o.stats?.intermediateChangesSinceRead)||0,backgroundRenewsLease:false},
  image:image?{mimeType:image.mimeType,data:image.data,dataBytes:image.dataBytes,sha256:image.sha256}:null,storedOnDisk:false}};
}
export function observationMetadata(packet){const clean=structuredClone(packet);if(clean.observation.image)delete clean.observation.image.data;return clean;}
export function observationTicket(packet){const o=packet.observation;return {epoch:packet.epoch,frameSeq:packet.frameSeq,observationId:o.observationId,observationEpoch:o.observationEpoch,sourceSeq:o.sourceSeq};}
