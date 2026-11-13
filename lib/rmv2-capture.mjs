export function normalizeCaptureRegion(region){
  if(region==null)return undefined;
  if(typeof region!=='object'||Array.isArray(region))throw Error('desktop_frame_region_invalid');
  const out={};
  for(const key of ['x','y','width','height']){
    const value=region[key];
    if(!Number.isInteger(value)||value<(key==='x'||key==='y'?0:1)||value>32768)throw Error('desktop_frame_region_invalid');
    out[key]=value;
  }
  if(out.width*out.height>16*1024*1024)throw Error('desktop_frame_pixel_budget');
  return out;
}

// Only Agent-held metadata from a successful scoped native capture is accepted.
// Caller cannot submit an affine matrix or claim a trusted capture timestamp.
export function frameCoordinateInput(request,frame,{now=performance.now()}={}){
  if(request.coordinateSpace!=='frame')return request;
  const budget=request.maxFrameAgeMs??15000;
  if(!Number.isInteger(budget)||budget<1000||budget>45000)throw Error('desktop_frame_invalid_age_budget');
  if(!frame||!Number.isFinite(frame.capturedMono)||frame.frameSeq!==request.frameSeq||now<frame.capturedMono||now-frame.capturedMono>budget)
    throw Error('desktop_frame_stale_reobserve_before_input');
  if(request.displayTopologyId&&request.displayTopologyId!==frame.displayTopologyId)throw Error('desktop_frame_topology_mismatch');
  const {width,height,bounds}=frame;
  if(![width,height,bounds?.x,bounds?.y,bounds?.width,bounds?.height].every(Number.isInteger)||width<1||height<1||bounds.width<1||bounds.height<1)
    throw Error('desktop_frame_mapping_unavailable');
  const point=(x,y)=>{
    if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=width||y>=height)throw Error('desktop_frame_coordinates_outside_image');
    return {x:bounds.x+Math.min(bounds.width-1,Math.max(0,Math.round((x+0.5)*bounds.width/width-0.5))),
      y:bounds.y+Math.min(bounds.height-1,Math.max(0,Math.round((y+0.5)*bounds.height/height-0.5)))};
  };
  if(!Array.isArray(request.events)||!request.events.length)throw Error('desktop_frame_coordinate_events_required');
  const events=request.events.map(event=>{
    if(!['move','click','wheel','drag'].includes(event.type)||event.screen!=null||event.toScreen!=null)throw Error('desktop_frame_event_or_coordinate_space_conflict');
    const first=point(event.x,event.y),next={...event,...first};
    if(event.type==='drag'){const end=point(event.toX,event.toY);next.toX=end.x;next.toY=end.y;}
    return next;
  });
  const {coordinateSpace,frameSeq,maxFrameAgeMs,...rest}=request;
  return {...rest,events,displayTopologyId:frame.displayTopologyId};
}
