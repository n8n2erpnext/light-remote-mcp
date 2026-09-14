import {spawn} from 'node:child_process';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class FleetComponentSupervisor{
  constructor({manager,stateProvider,requestIntent,execPath=process.execPath,env={},updateCheckMs=6*60*60*1000,intentBaseBackoffMs=15_000,intentMaxBackoffMs=300_000,emit=()=>{}}={}){
    if(!manager||typeof stateProvider!=='function'||typeof requestIntent!=='function')throw new Error('fleet_supervisor_config_required');
    this.manager=manager;this.stateProvider=stateProvider;this.requestIntent=requestIntent;this.execPath=execPath;this.env=env;this.updateCheckMs=Math.max(60_000,Number(updateCheckMs)||6*60*60*1000);this.emit=emit;
    this.child=null;this.runtime=null;this.lastUpdateCheckAt=this.manager.current()?Date.now():0;this.closed=false;this.intentFailures=0;this.nextIntentAt=0;this.intentBaseBackoffMs=Math.max(10,Number(intentBaseBackoffMs)||15_000);this.intentMaxBackoffMs=Math.max(this.intentBaseBackoffMs,Number(intentMaxBackoffMs)||300_000);
  }
  running(){return Boolean(this.child&&this.child.exitCode==null&&!this.child.killed);}
  async stop(reason='fleet_not_desired'){
    const child=this.child;this.child=null;this.runtime=null;if(!child||child.exitCode!=null)return false;
    this.emit({event:'fleet_component_stopping',reason});try{child.kill('SIGTERM');}catch{return false;}
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(3000)]);
    if(child.exitCode==null){try{child.kill('SIGKILL');}catch{}}
    return true;
  }
  _start(runtime){
    if(this.closed)throw new Error('fleet_supervisor_closed');
    const child=spawn(this.execPath,[runtime],{env:{...process.env,...this.env,LIGHT_REMOTE_FLEET_PARENT_PID:String(process.pid)},stdio:['ignore','pipe','pipe']});
    this.child=child;this.runtime=runtime;
    child.stdout?.on('data',data=>this.emit({event:'fleet_component_stdout',detail:String(data).trim().slice(0,500)}));
    child.stderr?.on('data',data=>this.emit({event:'fleet_component_stderr',detail:String(data).trim().slice(0,500)}));
    child.on('exit',(code,signal)=>{if(this.child===child){this.child=null;this.runtime=null;}this.emit({event:'fleet_component_exit',code,signal});});
    this.emit({event:'fleet_component_started',runtime,pid:child.pid});return child;
  }
  async reconcile(){
    if(this.closed)return{desired:false,running:false,closed:true};
    const state=this.stateProvider();if(!state?.enrollment?.deviceId){await this.stop('device_not_enrolled');return{desired:false,running:false,reason:'device_not_enrolled'};}
    const now=Date.now();if(this.nextIntentAt>now)return{desired:this.running(),running:this.running(),backoffUntil:this.nextIntentAt,retryInMs:this.nextIntentAt-now};
    let intent;try{intent=await this.requestIntent(state);this.intentFailures=0;this.nextIntentAt=0;}catch(error){this.intentFailures++;const exponential=Math.min(this.intentBaseBackoffMs*(2**Math.min(this.intentFailures-1,5)),this.intentMaxBackoffMs),retryInMs=Math.max(exponential,Math.max(0,Number(error.retryAfterMs)||0));this.nextIntentAt=Date.now()+retryInMs;this.emit({event:'fleet_intent_failed',error:error.message,status:error.status||null,failures:this.intentFailures,retryInMs});return{desired:this.running(),running:this.running(),error:error.message,backoffUntil:this.nextIntentAt,retryInMs};}
    if(!intent?.desired){await this.stop(intent?.reason||'fleet_not_desired');return{desired:false,running:false,reason:intent?.reason||'fleet_not_desired'};}
    let current=this.manager.current(),updateNow=Date.now();
    if(!current||updateNow-this.lastUpdateCheckAt>=this.updateCheckMs){const installed=await this.manager.ensureInstalled();this.lastUpdateCheckAt=updateNow;current={version:installed.version,release:installed.release,runtime:installed.runtime};}
    if(this.running()&&this.runtime===current.runtime)return{desired:true,running:true,version:current.version};
    if(this.running())await this.stop('fleet_component_changed');this._start(current.runtime);
    return{desired:true,running:true,version:current.version};
  }
  async close(){this.closed=true;return this.stop('agent_shutdown');}
}
