import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';

// This is an independent *process spawn* canary, not proof that arbitrary
// filesystem/desktop effects completed. Never rerun a customer command.
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
      timer=setTimeout(()=>{
        try{child.kill('SIGKILL');}catch{}
        finish(false);
      },Math.max(1000,Math.min(Number(timeoutMs)||5000,20000)));
      timer.unref?.();
    }catch{finish(false);}
  });
}

export class ExecutorReadinessProbe{
  constructor({runner=spawnExecutorCanary,intervalMs=30000,timeoutMs=5000,failuresToDegrade=2,onTransition=()=>{}}={}){
    if(typeof runner!=='function')throw Error('executor_probe_runner_required');
    this.runner=runner;
    this.intervalMs=Math.max(5000,Math.min(Number(intervalMs)||30000,300000));
    this.timeoutMs=Math.max(1000,Math.min(Number(timeoutMs)||5000,20000));
    this.failuresToDegrade=Math.max(1,Math.min(Number(failuresToDegrade)||2,5));
    this.onTransition=onTransition;
    this.ready=null;
    this.checks=0;
    this.failures=0;
    this.consecutiveFailures=0;
    this.lastCheckedAt=null;
    this.lastHealthyAt=null;
    this.lastLatencyMs=null;
    this.timer=null;
    this.pending=null;
    this.generation=0;
  }
  status(){return {ready:this.ready,state:this.ready===true?'healthy':this.ready===false?'unavailable':'unknown',
    checks:this.checks,failures:this.failures,consecutiveFailures:this.consecutiveFailures,
    lastCheckedAt:this.lastCheckedAt,lastHealthyAt:this.lastHealthyAt,lastLatencyMs:this.lastLatencyMs};}
  async check(){
    if(this.pending)return this.pending;
    const generation=this.generation,begin=performance.now();
    const work=(async()=>{
      let ok=false;
      try{ok=await this.runner({timeoutMs:this.timeoutMs})===true;}catch{ok=false;}
      if(generation!==this.generation)return this.status();
      this.checks++;
      this.lastCheckedAt=Date.now();
      this.lastLatencyMs=Math.max(0,Math.round(performance.now()-begin));
      const prior=this.ready;
      if(ok){
        this.consecutiveFailures=0;
        this.lastHealthyAt=this.lastCheckedAt;
        this.ready=true;
      }else{
        this.failures++;
        this.consecutiveFailures++;
        if(this.consecutiveFailures>=this.failuresToDegrade)this.ready=false;
      }
      if(prior!==this.ready){
        try{this.onTransition(this.status());}catch{}
      }
      return this.status();
    })();
    this.pending=work;
    try{return await work;}finally{if(this.pending===work)this.pending=null;}
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
  }
}
