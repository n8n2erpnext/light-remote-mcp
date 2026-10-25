// Local Wall: one remote status read per device/time window, shared by tabs.
export function createWallStatusCache({fetchRemote,clock=()=>Date.now(),minIntervalMs=12000,maxUiWaitMs=1200}={}){
  if(typeof fetchRemote!=='function')throw Error('wall_status_fetch_required');
  if(!Number.isSafeInteger(minIntervalMs)||minIntervalMs<1000||minIntervalMs>60000)throw Error('wall_status_interval_invalid');
  if(!Number.isSafeInteger(maxUiWaitMs)||maxUiWaitMs<50||maxUiWaitMs>10000)throw Error('wall_status_ui_wait_invalid');
  let identity='',last=null,lastAt=0,nextAt=0,inFlight=null,lastError=null,generation=0;
  const reset=()=>{generation++;last=null;lastAt=0;nextAt=0;inFlight=null;lastError=null;};
  const result=()=>lastError?{...(last||{}),ok:false,status:lastError.status,error:lastError.error,
    retryAfterSeconds:lastError.status===429?Math.max(1,Math.ceil((nextAt-clock())/1000)):lastError.retryAfterSeconds||null,scope:lastError.scope||null,
    stale:last!==null,cachedAt:lastAt||null}:last;
  // Return LOCAL Wall status promptly even if the observer request is stuck
  // behind RM/Activity or a slow remote network. One background upstream
  // request remains in flight; never start a storm of duplicate status polls.
  async function bounded(op){
    let timer;
    const pending=Symbol('upstream_pending');
    try{
      const value=await Promise.race([op,new Promise(resolve=>{
        timer=setTimeout(()=>resolve(pending),maxUiWaitMs);timer.unref?.();
      })]);
      if(value!==pending)return value;
      return { ...((last&&typeof last==='object')?last:{}),ok:false,status:202,
        error:'remote_status_pending',scope:'device-channel-observer',
        stale:last!==null,cachedAt:lastAt||null};
    }finally{if(timer)clearTimeout(timer);}
  }
  return {
    invalidate(){reset();},
    async get({connected,deviceId,force=false}={}){
      if(!connected){identity='';reset();return null;}
      const device=String(deviceId||'');
      if(device!==identity){identity=device;reset();}
      if(inFlight)return bounded(inFlight);
      if(clock()<nextAt&&!force)return result();
      const requestedIdentity=identity,requestedGeneration=generation;
      const op=(async()=>{
        try{
          const value=await fetchRemote();
          if(requestedIdentity===identity&&requestedGeneration===generation){
            last=value;lastAt=clock();lastError=null;nextAt=lastAt+minIntervalMs;
          }
        }catch(error){
          if(requestedIdentity===identity&&requestedGeneration===generation){
            const status=Number(error.status)||null,retryAfterSeconds=
              Math.max(1,Math.min(120,Math.ceil(Number(error.payload?.retryAfterSeconds)||20)));
            lastError={status,error:String(error.message||'remote_status_unavailable').slice(0,90),
              retryAfterSeconds,scope:error.payload?.scope||null};
            nextAt=clock()+(status===429?retryAfterSeconds*1000:minIntervalMs);
          }
        }
        return result();
      })();
      inFlight=op;
      void op.then(()=>{if(inFlight===op)inFlight=null;},()=>{if(inFlight===op)inFlight=null;});
      return bounded(op);
    }
  };
}
