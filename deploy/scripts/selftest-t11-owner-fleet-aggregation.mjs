import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {SessionRegistry} from '../../operator-host/session-manager.mjs';
import {DeviceRegistry} from '../../operator-host/device-registry.mjs';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
import {createDesktopV4OwnerSnapshot} from '../../operator-host/desktop-v4-owner-snapshot.mjs';

const now=Date.UTC(2026,10,7,8,0,0);
const owner='account-owner',foreign='account-foreign';
const sessionId='acctsess_123e4567-e89b-42d3-a456-426614174000';

function fixture(count){
  const devices=new DeviceRegistry({now:()=>now});
  const sessions=new SessionRegistry({now:()=>now,maxActive:1000});
  const grants=new DeviceAccessGrantRegistry({now:()=>now});
  const owned=Math.min(2,count);
  for(let i=0;i<count;i++){
    const id='device-'+i,nodeId='node-'+i,accountId=i<owned?owner:foreign;
    devices.register({accountId,deviceId:id,nodeId,displayName:'Host '+i,platform:'linux'});
    sessions.sessions.set('session-'+i,{id:'session-'+i,accountId,deviceId:id,nodeId,
      lastSeenAt:now,graceMs:60*60_000,activeJobs:new Set(),closedAt:null,expiredAt:null,
      holdReason:null,openId:null});
    grants.grants.set('grant-'+i,{grantId:'grant-'+i,accountId,deviceId:id,
      connectionId:'connection-'+i,agentId:'agent-'+i,purpose:'device',
      approvedAt:now-1000,expiresAt:now+30*60_000,absoluteExpiresAt:now+60*60_000,
      closedAt:null,activationPending:false});
  }
  // Never expose cross-account grants, closed grants or a Guest purpose on Owner read.
  grants.grants.set('bad-guest',{grantId:'bad-guest',accountId:owner,deviceId:'device-0',
    purpose:'pro-share-guest',approvedAt:now-1000,expiresAt:now+60_000,absoluteExpiresAt:now+120_000});
  grants.grants.set('bad-closed',{grantId:'bad-closed',accountId:owner,deviceId:'device-0',
    purpose:'device',approvedAt:now-1000,expiresAt:now+60_000,absoluteExpiresAt:now+120_000,
    closedAt:now-100});
  grants.grants.set('bad-pending',{grantId:'bad-pending',accountId:owner,deviceId:'device-0',
    purpose:'device',approvedAt:now-1000,expiresAt:now+60_000,absoluteExpiresAt:now+120_000,
    activationPending:true});
  grants.grants.set('bad-expired',{grantId:'bad-expired',accountId:owner,deviceId:'device-0',
    purpose:'device',approvedAt:now-1000,expiresAt:now-1,absoluteExpiresAt:now+120_000});
  return {devices,sessions,grants,owned};
}

for(const n of [1000,10000]){
  const {devices,sessions,grants,owned}=fixture(n);
  const started=performance.now();
  const counts=sessions.activeCountsByNode();
  assert.equal(counts.size,n,'one node count per synthetic active session');
  assert.equal(counts.get('node-'+(n-1)),1);
  assert.equal(sessions.activeCountByNode('node-0'),counts.get('node-0'));
  let projections=0;
  const ownerRows=devices.list({accountId:owner,activeSessionsForNode:nodeId=>{
    projections++;
    return counts.get(nodeId)||0;
  }});
  assert.equal(ownerRows.length,owned,'foreign devices filtered before projections');
  assert.equal(projections,owned,'one projection per owned device');
  assert.ok(ownerRows.every(row=>row.accountId===owner&&row.activeSessions===1));
  assert.equal(devices.list({accountId:'unknown',activeSessionsForNode:()=>0}).length,0);
  const byDevice=grants.activeGrantsForDevices(ownerRows.map(row=>row.deviceId));
  assert.ok(byDevice instanceof Map);
  assert.equal([...byDevice.values()].reduce((sum,rows)=>sum+rows.length,0),owned+1,'batch includes active Guest; Owner projection filters purpose');
  assert.ok(byDevice.get('device-0').some(row=>row.purpose==='pro-share-guest'),'batch must preserve original grant semantics');
  for(let i=0;i<owned;i++)
    assert.deepEqual(byDevice.get('device-'+i),grants.activeGrantsForDevice('device-'+i),
      'batch and original single-device grant projection must agree');
  const elapsed=performance.now()-started;
  console.log('T11_P03_SYNTHETIC_'+n+'_NODES_BATCH_PASS elapsed_ms='+elapsed.toFixed(2));
}

const {devices,sessions,grants}=fixture(1000);
let observedAccount=null,legacyCalls=0;
const snap=createDesktopV4OwnerSnapshot({
  accounts:{desktopOwnerSessionActive:(a,s)=>a===owner&&s===sessionId,
    account:a=>({accountId:a,isOwner:true,emailVerified:true,status:'active',plan:'pro'})},
  allDeviceViews:({accountId}={})=>{
    observedAccount=accountId;
    const counts=sessions.activeCountsByNode();
    return devices.list({accountId,activeSessionsForNode:id=>counts.get(id)||0});
  },
  sessions:{list:()=>[]},
  accessGrants:{
    activeGrantsForDevices:ids=>grants.activeGrantsForDevices(ids),
    activeGrantsForDevice:()=>{legacyCalls++;throw new Error('unnecessary_per_device_grant_scan');}
  },
  usage:{summary:()=>({currentMonth:'2026-11',toolCallsThisMonth:0,devices:[]})},
  planEntitlements:()=>({plan:'pro',toolCallLimit:1000}),
  jobs:new Map(),recentEvents:()=>[],now:()=>now,
  lookupShortIds:async ({accountId,deviceIds})=>{
    assert.equal(accountId,owner);
    assert.deepEqual(deviceIds.sort(),['device-0','device-1']);
    return new Map(deviceIds.map((id,i)=>[id,i===0?'R01KAP':'R01KAQ']));
  }
});
const view=await snap({accountId:owner,accountSessionId:sessionId});
assert.equal(observedAccount,owner,'Owner key passed into scope before projection');
assert.equal(view.devices.length,2);
assert.equal(view.grants.length,2,'no Guest, closed, pending or expired grants');
assert.equal(legacyCalls,0,'Owner snapshot must use one batch grant scan');
assert.ok(view.grants.every(row=>row.deviceId==='device-0'||row.deviceId==='device-1'));
assert.ok(!JSON.stringify(view).includes(foreign),'foreign accounts hidden');
await assert.rejects(()=>snap({accountId:foreign,accountSessionId:sessionId}),/desktop_snapshot_owner_required/);

const root=new URL('../../',import.meta.url);
for(const [file,needle] of [
 ['operator-host/executor.mjs','sessions.activeCountsByNode()'],
 ['operator-host/executor.mjs','devices.list({accountId,activeSessionsForNode:'],
 ['operator-host/desktop-v4-owner-snapshot.mjs','allDeviceViews({accountId})'],
 // F14: page the full current Owner fleet but exclude revoked devices from grant authority.
 // This retains P03 single batched grants lookup without silently trimming to 200 rows.
 ['operator-host/desktop-v4-owner-snapshot.mjs',"accessGrants.activeGrantsForDevices(rawDevices.filter(d=>d.state!=='revoked').map(d=>d.deviceId))"]
]){
 const text=fs.readFileSync(new URL(file,root),'utf8');
 assert.ok(text.includes(needle),'source binding absent: '+file+' '+needle);
}
console.log('T11_P03_OWNER_SCOPE_GRANT_BATCH_AND_LEGACY_PARITY=PASS');
