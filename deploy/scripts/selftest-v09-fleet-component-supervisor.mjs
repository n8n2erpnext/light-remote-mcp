import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FleetComponentSupervisor} from '../../device-agent/fleet-component-supervisor.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-fleet-supervisor-')),runtime1=path.join(dir,'runtime1.mjs'),runtime2=path.join(dir,'runtime2.mjs');
for(const file of [runtime1,runtime2])fs.writeFileSync(file,"process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);\n");
let desired=true,intentError=false,version='1.0.0',runtime=runtime1,installs=0;
const manager={current:()=>({version,release:dir,runtime}),ensureInstalled:async()=>{installs++;return{installed:false,version,release:dir,runtime};}};
const state={enrollment:{deviceId:'dev_supervisor_test'}};
const events=[];
const supervisor=new FleetComponentSupervisor({manager,stateProvider:()=>state,requestIntent:async()=>{if(intentError)throw new Error('intent_offline');return{desired,reason:desired?'main_device':'not_main'};},updateCheckMs:60_000,emit:e=>events.push(e)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let out=await supervisor.reconcile();if(!out.running||!supervisor.running()||installs!==0)throw new Error('fleet_supervisor_cached_start_failed');
  const pid1=supervisor.child.pid;intentError=true;out=await supervisor.reconcile();if(!out.running||supervisor.child.pid!==pid1)throw new Error('intent_error_must_not_kill_authorized_runtime');intentError=false;
  desired=false;out=await supervisor.reconcile();if(out.running||supervisor.running())throw new Error('fleet_supervisor_stop_failed');
  desired=true;version='1.0.1';runtime=runtime2;supervisor.lastUpdateCheckAt=0;out=await supervisor.reconcile();if(!out.running||supervisor.runtime!==runtime2||supervisor.child.pid===pid1||installs!==1)throw new Error('fleet_supervisor_component_restart_failed');
  await supervisor.close();if(supervisor.running())throw new Error('fleet_supervisor_close_failed');
  if(!events.some(e=>e.event==='fleet_component_started')||!events.some(e=>e.event==='fleet_component_stopping'))throw new Error('fleet_supervisor_events_missing');
  console.log('v09-fleet-supervisor-cached-start=PASS');
  console.log('v09-fleet-supervisor-start-stop=PASS');
  console.log('v09-fleet-supervisor-intent-error-keeps-runtime=PASS');
  console.log('v09-fleet-supervisor-component-restart=PASS');
}finally{try{await supervisor.close();}catch{}await sleep(50);fs.rmSync(dir,{recursive:true,force:true});}
