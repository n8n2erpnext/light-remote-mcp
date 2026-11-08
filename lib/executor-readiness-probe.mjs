import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';

// Independent bounded OS process spawn canary; never execute or replay user work.
export function spawnExecutorCanary({timeoutMs=5000,execPath=process.execPath}={}){
  return new Promise(resolve=>{
    let child=null,finished=false,timer=null;
    const finish=ok=>{
      if(finished)return;
      finished=true;
      if(timer)clearTimeout(timer);
      resolve(ok===true);
    };
    try{
      child=spawn(execPath,['-e','process.exit(0)'],{
        stdio:'ignore',windowsHide:true
      });
      child.once('error',()=>finish(false));
      child.once('close',(code,signal)=>finish(code===0&&!signal));
      if(!finished){
        timer=setTimeout(()=>{
          try{child.kill('SIGKILL');}catch{}
          finish(false);
        },Math.max(1000,Math.min(Number(timeoutMs)||5000,20000)));
        timer.unref?.();
      }
    }catch{finish(false);}
  });
}

export class ExecutorReadinessProbe{
  constructor({runner=spawnExecutorCanary,intervalMs=30000,timeoutMs=5000,failuresToDegrade=2,maxAgeMs=0,onTransition=()=>{}}={}){
    if(typeof runner!=='function')throw Error('executor_probe_runner_required');
    this.runner=runner;
    this.intervalMs=Math.max(5000,Math.min(Number(intervalMs)||30000,300000));
    this.timeoutMs=Math.max(1000,Math.min(Number(timeoutMs)||5000,20000));
    this.maxAgeMs=Math.max(15000,Math.min(Number(maxAgeMs)>0?Number(maxAgeMs):this.intervalMs*3+this.timeoutMs,930000));
    this.failuresToDegrade=Math.max(1,Math.min(Number(failuresToDegrade)||2,5));
    this.onTransition=onTransition;
    this.ready=null;
    this.checks=0;
    this.failures=0;
    this.probeTimeouts=0;
    this.consecutiveFailures=0;
    this.lastCheckedAt=null;
    this.lastHealthyAt=null;
    this.lastLatencyMs=null;
    this.timer=null;
    this.pending=null;
    this.generation=0;
  }
  status(){
    const stale=this.ready===true&&(!this.lastCheckedAt||Date.now()-this.lastCheckedAt>this.maxAgeMs);
    const ready=stale?false:this.ready;
    return {ready,state:stale?'stale':ready===true?'healthy':ready===false?'unavailable':'unknown',
      stale,checks:this.checks,failures:this.failures,probeTimeouts:this.probeTimeouts,
      consecutiveFailures:this.consecutiveFailures,maxAgeMs:this.maxAgeMs,
      lastCheckedAt:this.lastCheckedAt,lastHealthyAt:this.lastHealthyAt,lastLatencyMs:this.lastLatencyMs};
  }
  async check(){
    if(this.pending)return this.pending;
    const generation=this.generation,begin=performance.now();
    let timeoutId=null;
    const work=(async()=>{
      let runnerResponse;
      try{runnerResponse=Promise.resolve(this.runner({timeoutMs:this.timeoutMs}));}
      catch{runnerResponse=Promise.resolve(false);}
      // An injectable runner (or broken process bridge) may never settle.
      // Race independently against a real bounded timer. The late promise
      // is observed but its eventual result cannot modify readiness.
      const completion=runnerResponse.then(
        value=>({ok:value===true,timedOut:false}),
        ()=>({ok:false,timedOut:false})
      );
      const deadline=new Promise(resolve=>{
        timeoutId=setTimeout(()=>resolve({ok:false,timedOut:true}),this.timeoutMs);
      });
      const result=await Promise.race([completion,deadline]);
      if(timeoutId)clearTimeout(timeoutId);
      if(generation!==this.generation)return this.status();
      const prior=this.status().ready;
      this.checks++;
      if(result.timedOut)this.probeTimeouts++;
      this.lastCheckedAt=Date.now();
      this.lastLatencyMs=Math.max(0,Math.round(performance.now()-begin));
      if(result.ok){
        this.consecutiveFailures=0;
        this.lastHealthyAt=this.lastCheckedAt;
        this.ready=true;
      }else{
        this.failures++;
        this.consecutiveFailures++;
        if(this.consecutiveFailures>=this.failuresToDegrade)this.ready=false;
      }
      const next=this.status();
      if(prior!==next.ready){
        try{this.onTransition(next);}catch{}
      }
      return next;
    })();
    this.pending=work;
    try{return await work;}finally{
      if(timeoutId)clearTimeout(timeoutId);
      if(this.pending===work)this.pending=null;
    }
  }
  start(){
    if(this.timer)return;
    void this.check();
    this.timer=setInterval(()=>{void this.check();},this.intervalMs);
    this.timer.unref?.();
  }
  stop(){
    if(this.timer){clearInterval(this.timer);this.timer=null;}
    this.generation++;
    this.pending=null;
    this.ready=null;
    this.lastCheckedAt=null;
  }
}
