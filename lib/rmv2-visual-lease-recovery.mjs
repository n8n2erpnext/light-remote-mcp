// Read-only RM V2 visual recovery. The public desktopSessionId remains owner-bound;
// native lease tokens never leave the Agent and never authorize replay of input.
export function recoverableVisualFrameError(error){
  const message=String(error?.message||error||'');
  return /(?:^|\b)(?:visual_session_missing|visual_lease_expired|real_remote_helper_(?:closed|exited|timeout)|real_remote_pipe_(?:closed|unavailable)|real_remote_ready_timeout|connect ENOENT)(?:\b|$)/.test(message);
}

export async function reacquireNativeVisual(row,{requestNative,isCurrent,onRecovered=()=>{}}){
  if(typeof requestNative!=='function'||typeof isCurrent!=='function')
    throw new TypeError('visual_recovery_dependencies_required');
  if(row.recovering)return row.recovering;
  const recovery=(async()=>{
    if(!isCurrent(row)||row.stopping||Date.now()>=row.expiresAt)
      throw new Error('desktop_session_missing');
    const attached=await requestNative('visual-attach',{
      screen:row.screen,maxWidth:row.maxWidth,maxHeight:row.maxHeight,
      quality:row.quality,leaseMs:row.idleTimeoutMs,
      owner:(row.sessionId+':'+row.agentId).slice(0,80)
    },{timeoutMs:10000});
    const nextId=String(attached?.visualSessionId||'');
    const nextToken=String(attached?.leaseToken||'');
    const nextTopology=String(attached?.displayTopologyId||'');
    const valid=Boolean(nextId&&nextToken&&nextTopology&&nextTopology===row.displayTopologyId&&
      isCurrent(row)&&!row.stopping&&Date.now()<row.expiresAt);
    if(!valid){
      if(nextId&&nextToken){
        try{await requestNative('visual-detach',{visualSessionId:nextId,leaseToken:nextToken},{timeoutMs:3000});}
        catch{}
      }
      throw new Error(nextTopology&&nextTopology!==row.displayTopologyId
        ?'desktop_display_topology_changed_requires_attach':'desktop_visual_recovery_aborted');
    }
    row.visualSessionId=nextId;
    row.leaseToken=nextToken;
    row.nativeEpoch=String(attached.epoch||'');
    row.nativeStale=false;
    row.lastFrameSha=null;
    await onRecovered(row);
    return {recovered:true,epochChanged:true};
  })();
  row.recovering=recovery;
  try{return await recovery;}
  finally{if(row.recovering===recovery)row.recovering=null;}
}
