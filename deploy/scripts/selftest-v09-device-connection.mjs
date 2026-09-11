import fs from 'node:fs';
import { DeviceConnectionRegistry, DeviceConnectionError } from '../../operator-host/device-connection-registry.mjs';

let now=1_000_000;
const file=`/tmp/lrm-device-connection-${process.pid}.json`;
fs.rmSync(file,{force:true});
const events=[];
const registry=new DeviceConnectionRegistry({stateFile:file,now:()=>now,emit:e=>events.push(e)});
function expectError(fn,message){
  try{fn();}catch(error){if(!(error instanceof DeviceConnectionError)||error.message!==message)throw error;return;}
  throw new Error(`expected_${message}`);
}
const free=registry.connect({accountId:'acct-a',deviceId:'device-a',plan:'free',requestedLeaseMs:2*60*60*1000,reconnectGraceMs:15*60*1000});
if(free.state!=='connected'||free.plan!=='free'||free.hardExpiresAt-now!==2*60*60*1000)throw new Error('free_connect_failed');
expectError(()=>registry.connect({accountId:'acct-a',deviceId:'device-b',plan:'free',requestedLeaseMs:5*60*60*1000}),'invalid_device_connection_lease');
expectError(()=>registry.setGrace('device-a',14*60*1000),'invalid_reconnect_grace');
expectError(()=>registry.setGrace('device-a',61*60*1000),'invalid_reconnect_grace');
registry.setGrace('device-a',30*60*1000);
now+=29*60*1000;
if(registry.reap({activeSessionsForDevice:()=>0}).length!==0)throw new Error('idle_closed_too_early');
now+=2*60*1000;
const idleClosed=registry.reap({activeSessionsForDevice:()=>0});
if(idleClosed[0]?.reason!=='idle_grace_expired')throw new Error('idle_close_failed');const pro=registry.connect({accountId:'acct-a',deviceId:'device-pro',plan:'pro',requestedLeaseMs:24*60*60*1000,reconnectGraceMs:60*60*1000});
if(pro.hardExpiresAt-now!==24*60*60*1000)throw new Error('pro_cap_failed');
now+=23*60*60*1000;
registry.touch('device-pro','agent_activity');
now+=60*60*1000+1;
const hardClosed=registry.reap({activeSessionsForDevice:id=>id==='device-pro'?2:0});
if(hardClosed.find(x=>x.deviceId==='device-pro')?.reason!=='hard_lease_expired')throw new Error('hard_lease_not_absolute');
expectError(()=>registry.assertConnected('device-pro'),'device_connection_required');
const vip=registry.connect({accountId:'acct-a',deviceId:'device-vip',plan:'vip'});
if(vip.planCapMs!==72*60*60*1000)throw new Error('vip_cap_failed');
registry.disconnect('device-vip','user_disconnect');
if(registry.get('device-vip').state!=='dormant')throw new Error('disconnect_failed');
const restored=new DeviceConnectionRegistry({stateFile:file,now:()=>now});
if(restored.get('device-vip').closeReason!=='user_disconnect')throw new Error('connection_state_persistence_failed');
if(!events.some(e=>e.type==='device_connection_opened')||!events.some(e=>e.type==='device_connection_closed'))throw new Error('connection_events_missing');
fs.rmSync(file,{force:true});
console.log(JSON.stringify({ok:true,freeMaxHours:4,proMaxHours:24,vipMaxHours:72,reconnectGraceMinutes:[15,60],unlimited:false},null,2));