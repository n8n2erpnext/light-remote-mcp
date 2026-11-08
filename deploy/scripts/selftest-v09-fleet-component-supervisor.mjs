import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FleetComponentSupervisor} from '../../device-agent/fleet-component-supervisor.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-fleet-supervisor-')),runtime1=path.join(dir,'runtime1.mjs'),runtime2=path.join(dir,'runtime2.mjs');
for(const file of [runtime1,runtime2])fs.writeFileSync(file,"process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);\n");
let desired=true,intentError=false,installError=false,version='1.0.0',runtime=runtime1,installs=0,intentCalls=0;
const manager={current:()=>({version,release:dir,runtime}),ensureInstalled:async()=>{installs++;if(installError)throw new Error('signed_feed_unavailable');return{installed:false,version,release:dir,runtime};}};
const state={enrollment:{deviceId:'dev_supervisor_test'}};
const events=[];
const supervisor=new FleetComponentSupervisor({manager,stateProvider:()=>state,requestIntent:async()=>{intentCalls++;if(intentError){const error=new Error('rate_limited');error.status=429;error.retryAfterMs=35;throw error;}return{desired,reason:desired?'main_device':'not_main'};},updateCheckMs:60_000,intentBaseBackoffMs:20,intentMaxBackoffMs:40,emit:e=>events.push(e)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let out=await supervisor.reconcile();if(!out.running||!supervisor.running()||installs!==1)throw new Error('fleet_supervisor_startup_update_check_failed');
  const pid1=supervisor.child.pid;installError=true;supervisor.lastUpdateCheckAt=0;out=await supervisor.reconcile();if(!out.running||supervisor.child.pid!==pid1||installs!==2||!events.some(e=>e.event==='fleet_component_update_check_failed'))throw new Error('fleet_supervisor_cached_fallback_failed');
  installError=false;intentError=true;out=await supervisor.reconcile();if(!out.running||supervisor.child.pid!==pid1||out.retryInMs<35)throw new Error('intent_error_must_not_kill_authorized_runtime');
  const callsAfterFailure=intentCalls;out=await supervisor.reconcile();if(intentCalls!==callsAfterFailure||!out.backoffUntil)throw new Error('fleet_intent_backoff_must_skip_request');
  await sleep(45);intentError=false;desired=false;out=await supervisor.reconcile();if(out.running||supervisor.running()||intentCalls!==callsAfterFailure+1)throw new Error('fleet_supervisor_stop_failed');
  desired=true;version='1.0.1';runtime=runtime2;supervisor.lastUpdateCheckAt=0;out=await supervisor.reconcile();if(!out.running||supervisor.runtime!==runtime2||supervisor.child.pid===pid1||installs!==3)throw new Error('fleet_supervisor_component_restart_failed');
  await supervisor.close();if(supervisor.running())throw new Error('fleet_supervisor_close_failed');
  if(!events.some(e=>e.event==='fleet_component_started')||!events.some(e=>e.event==='fleet_component_stopping'))throw new Error('fleet_supervisor_events_missing');
  const agentSource=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');
  for(const token of ["get?.('retry-after')",'retryAfterSeconds','e.retryAfterMs=responseRetryAfterMs(response,json)','Number(error.retryAfterMs)||0'])if(!agentSource.includes(token))throw new Error(`device_retry_after_contract_missing:${token}`);
  console.log('v09-fleet-supervisor-startup-update-check=PASS');
  console.log('v09-fleet-supervisor-cached-fallback=PASS');
  console.log('v09-fleet-supervisor-start-stop=PASS');
  console.log('v09-fleet-supervisor-intent-error-keeps-runtime=PASS');
  console.log('v09-fleet-supervisor-intent-backoff=PASS');
  console.log('v09-device-retry-after-honored=PASS');
  console.log('v09-fleet-supervisor-component-restart=PASS');
}finally{try{await supervisor.close();}catch{}await sleep(50);fs.rmSync(dir,{recursive:true,force:true});}
