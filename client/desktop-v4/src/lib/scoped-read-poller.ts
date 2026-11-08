/**
 * Owner-scoped native read scheduler. No overlapping IPC, no stale apply after
 * unmount/account switch, and no forged success on errors. A forced refresh
 * invalidates in-flight projections and runs immediately AFTER their settlement.
 *
 * This does not cache signed grants or replace native Owner revocation checks.
 */
export type ScopedReadPoller = Readonly<{
  refreshNow: () => void;
  stop: () => void;
}>;
export function startScopedReadPoller<T>(options: {
  intervalMs: number;
  task: () => Promise<T>;
  apply: (value: T) => void;
  healthy: (value: T) => boolean;
  unavailable: () => T;
  maxRetryMs?: number;
}): ScopedReadPoller {
  const {intervalMs,task,apply,healthy,unavailable}=options;
  if (!Number.isSafeInteger(intervalMs) || intervalMs<1000)
    throw Error('scoped_read_poll_interval_invalid');
  const maxRetryMs=Math.max(intervalMs,options.maxRetryMs??60000);
  let active=true;
  let inFlight=false;
  let pending=false;
  let revision=0;
  let failures=0;
  let timer:ReturnType<typeof setTimeout>|null=null;
  const cancelTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
  const schedule=(delay:number)=>{
    cancelTimer();
    if(!active||document.hidden)return;
    timer=setTimeout(()=>{timer=null;void run();},delay);
  };
  const run=async()=>{
    if(!active||document.hidden||inFlight)return;
    inFlight=true;
    const requestRevision=revision;
    try{
      let reply:T;
      try{reply=await task();}
      catch{reply=unavailable();}
      if(active&&!document.hidden&&requestRevision===revision){
        apply(reply);
        failures=healthy(reply)?0:Math.min(failures+1,3);
      }
    }finally{
      inFlight=false;
      if(!active)return;
      if(pending){
        pending=false;
        if(!document.hidden)void run();
      }else{
        const delay=Math.min(maxRetryMs,intervalMs*2**failures);
        schedule(delay);
      }
    }
  };
  const refreshNow=()=>{
    if(!active)return;
    revision+=1;
    cancelTimer();
    if(document.hidden)return;
    if(inFlight){pending=true;return;}
    void run();
  };
  const onVisibility=()=>{
    if(document.hidden){
      revision+=1;
      pending=false;
      cancelTimer();
    }else refreshNow();
  };
  document.addEventListener('visibilitychange',onVisibility);
  refreshNow();
  return Object.freeze({
    refreshNow,
    stop:()=>{
      if(!active)return;
      active=false;
      revision+=1;
      pending=false;
      cancelTimer();
      document.removeEventListener('visibilitychange',onVisibility);
    }
  });
}
