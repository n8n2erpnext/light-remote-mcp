import {performance} from 'node:perf_hooks';

export const RM_VIDEO_MAX_BYTES=650*1024;
export function videoOptions(request={}){
  if(typeof request.desktopSessionId!=='string'||!/^desk_[A-Za-z0-9_-]{8,160}$/.test(request.desktopSessionId))throw Error('video_desktop_session_required');
  const fps=request.fps??15;
  if(!Number.isInteger(fps)||fps<1||fps>30)throw Error('video_fps_invalid');
  for(const key of ['preferHardware','preferGpuCapture','includeData'])if(request[key]!=null&&typeof request[key]!=='boolean')throw Error('video_option_invalid');
  return {desktopSessionId:request.desktopSessionId,fps,preferHardware:request.preferHardware!==false,preferGpuCapture:request.preferGpuCapture!==false,includeData:request.includeData===true};
}
export function validateVideoPacket(packet){
  if(!packet||packet.mime!=='video/h264'||packet.format!=='annexb'||packet.keyFrame!==true||!/^avc1\.[0-9a-f]{6}$/i.test(packet.codec||''))throw Error('video_packet_codec_invalid');
  if(!Number.isInteger(packet.width)||!Number.isInteger(packet.height)||packet.width<2||packet.width>1280||packet.height<2||packet.height>720||(packet.width&1)||(packet.height&1))throw Error('video_packet_geometry_invalid');
  if(!Number.isInteger(packet.fps)||packet.fps<1||packet.fps>30||!Number.isSafeInteger(packet.capturedAt)||!['media-foundation-hardware','media-foundation-software'].includes(packet.encoderBackend)||typeof packet.hardwareEncoding!=='boolean'||typeof packet.gpuResize!=='boolean'||packet.hardwareEncoding!==(packet.encoderBackend==='media-foundation-hardware'))throw Error('video_packet_metadata_invalid');
  if(!Number.isSafeInteger(packet.timestampUs)||packet.timestampUs<0||!Number.isInteger(packet.dataBytes)||packet.dataBytes<1||packet.dataBytes>RM_VIDEO_MAX_BYTES||typeof packet.data!=='string'||packet.data.length!==4*Math.ceil(packet.dataBytes/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(packet.data))throw Error('video_packet_budget_invalid');
  return packet;
}
export async function captureAuthorizedVideo(row,owner,request,{requestNative,isCurrent,sendVideo,now=Date.now,mono=()=>performance.now()}={}){
  const options=videoOptions(request);
  const guard=()=>{
    if(row.desktopSessionId!==options.desktopSessionId||row.sessionId!==String(owner.sessionId||'')||row.agentId!==String(owner.agentId||'')||row.closing||row.nativeStale||!isCurrent(row)||now()>=row.expiresAt)throw Error('video_scope_unavailable');
  };
  guard();if(row.videoInFlight)throw Error('video_capture_busy');
  if(row.videoReadAt!=null&&now()-row.videoReadAt<1000/options.fps)throw Error('video_capture_throttled');
  row.videoInFlight=true;const capturedMono=mono();
  try{
    const native=await requestNative('visual-video',{visualSessionId:row.visualSessionId,leaseToken:row.leaseToken,fps:options.fps,preferHardware:options.preferHardware,preferGpuCapture:options.preferGpuCapture},{timeoutMs:7000});
    guard();const video=validateVideoPacket(native?.video);
    if(!Number.isSafeInteger(native.frameSeq)||native.frameSeq<=0||native.displayTopologyId!==row.displayTopologyId||native.epoch!==row.nativeEpoch)throw Error('video_frame_binding_invalid');
    row.videoReadAt=now();row.latestVideo={desktopSessionId:row.desktopSessionId,frameSeq:native.frameSeq,epoch:native.epoch,receivedAt:now(),video};
    row.lastFrameMap={frameSeq:native.frameSeq,capturedMono,displayTopologyId:native.displayTopologyId,width:video.width,height:video.height,bounds:video.bounds};
    if(sendVideo)await sendVideo(native);
    guard();
    const metadata={...video};delete metadata.data;
    return {...native,video:metadata,payloadOmitted:true,localViewerAvailable:true};
  }finally{row.videoInFlight=false;}
}
// Local Owner observer reads only recent already-authorized packets. It cannot
// capture, resume, renew a lease or keep any AI indicator/session alive.
export function recentLocalVideo(rows,{now=Date.now(),desktopAllowed=true,desktopSessionId='',afterSeq=0,afterEpoch=''}={}){
  if(!desktopAllowed)return [];
  return [...rows].filter(row=>!row.closing&&now<row.expiresAt&&row.latestVideo&&now-row.latestVideo.receivedAt<=2000)
    .slice(0,4).map((row,index)=>{
      const packet=row.latestVideo;
      if((desktopSessionId?row.desktopSessionId===desktopSessionId:index===0)&&(packet.epoch!==afterEpoch||packet.frameSeq>afterSeq))return packet;
      const video={...packet.video};delete video.data;return {...packet,video,unchanged:true};
    });
}
