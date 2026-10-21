// Local Wall: one remote status read per device/time window, shared by tabs.
export function createWallStatusCache({fetchRemote,clock=()=>Date.now(),minIntervalMs=12000}={}){
  if(typeof fetchRemote!=='function')throw Error('wall_status_fetch_required');
  if(!Number.isSafeInteger(minIntervalMs)||minIntervalMs<1000||minIntervalMs>60000)throw Error('wall_status_interval_invalid');
  let identity='',last=null,lastAt=0,nextAt=0,inFlight=null,lastError=null;
  const reset=()=>{last=null;lastAt=0;nextAt=0;inFlight=null;lastError=null;};
  const result=()=>lastError?{...(last||{}),ok:false,status:lastError.status,error:lastError.error,
    retryAfterSeconds:lastError.status===429?Math.max(1,Math.ceil((nextAt-clock())/1000)):lastError.retryAfterSeconds||null,scope:lastError.scope||null,
    stale:last!==null,cachedAt:lastAt||null}:last;
  return {
    async get({connected,deviceId,force=false}={}){
      if(!connected){identity='';reset();return null;}
      const device=String(deviceId||'');
      if(device!==identity){identity=device;reset();}
      if(inFlight)return inFlight;
      if(clock()<nextAt&&!force)return result();
      const requestedIdentity=identity;
      const op=(async()=>{
        try{
          const value=await fetchRemote();
          if(requestedIdentity===identity){
            last=value;lastAt=clock();lastError=null;nextAt=lastAt+minIntervalMs;
          }
        }catch(error){
          if(requestedIdentity===identity){
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
      try{return await op;}finally{if(inFlight===op)inFlight=null;}
    }
  };
}
