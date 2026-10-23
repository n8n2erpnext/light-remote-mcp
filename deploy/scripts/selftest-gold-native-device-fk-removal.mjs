import assert from 'node:assert/strict';
import {GoldNativeAccountDevice} from '../../lib/gold-native-account-device.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';

const original={device_id:'dev_target',owner_account_id:'acct_fixture',node_id:'node_fixture',
 state:'offline',policy_profile:'infra',revoked_ms:null,
 display_name:'Fixture Device',platform:'win32',architecture:'x64',
 agent_version:'rc49',first_seen_ms:1000,last_seen_ms:2000,offline_ms:2000,
 created_at:new Date(1000),last_seen_at:new Date(2000),capabilities:[]};
const records=new Map([[original.device_id,{...original}]]);
const historicalConnections=new Map([['conn_fixture','dev_target']]);
const queries=[];
const client={
 async query(sql,args=[]){
  const q=String(sql);queries.push({q,args});
  if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK')return {rowCount:0,rows:[]};
  if(q.startsWith('UPDATE lr_devices SET')){
   for(const [id,row] of records){
    if(args[0].includes(id)||row.state==='revoked'&&row.policy_profile===args[2])continue;
    row.state='revoked';row.revoked_ms??=args[1];row.policy_profile=args[2];
   }
   return {rowCount:1,rows:[]};
  }
  if(q.startsWith('INSERT INTO lr_devices')){
   const cols=q.slice(q.indexOf('(')+1,q.indexOf(')')).split(',');
   const incoming=Object.fromEntries(cols.map((c,i)=>[c.trim(),args[i]]));
   records.set(incoming.device_id,{...records.get(incoming.device_id),...incoming});
   return {rowCount:1,rows:[]};
  }
  if(q.includes('SELECT * FROM lr_devices')){
   return {rows:[...records.values()].filter(r=>!(r.state==='revoked'&&r.policy_profile==='__gold_removed_v1__'))};
  }
  if(/SELECT \* FROM lr_accounts|SELECT \* FROM lr_gold_account_entitlements|SELECT \* FROM lr_gold_fleet_provisioning/.test(q))
    return {rows:[]};
  throw Error('unexpected_query:'+q.slice(0,110));
 },
 release(){}
};
const pool={connect:async()=>client,query:(...args)=>client.query(...args)};
const store=new GoldNativeAccountDevice({pool,accounts:[],devices:[]});
await store.writeDevices(new Map());
assert(records.has('dev_target'),'FK-dependent Device history must remain in DB');
assert.equal(historicalConnections.get('conn_fixture'),'dev_target');
assert.equal(records.get('dev_target').state,'revoked');
assert.equal(records.get('dev_target').policy_profile,'__gold_removed_v1__');
assert(!queries.some(x=>/DELETE FROM lr_devices/i.test(x.q)),'must not hard-delete devices');
assert.equal((await GoldNativeAccountDevice.open({pool})).devices.length,0,'removed device must not return after restart');
const relink={deviceId:'dev_target',accountId:'acct_fixture',nodeId:'node_fixture',
 displayName:'Fixture Device',platform:'win32',architecture:'x64',agentVersion:'rc49',
 firstSeenAt:1000,lastSeenAt:3000,offlineAt:3000,revokedAt:null,
 capabilities:['filesystem'],policyProfile:'infra'};
await store.writeDevices(new Map([['dev_target',relink]]));
const restored=await GoldNativeAccountDevice.open({pool});
assert.equal(restored.devices.length,1,'re-enrollment may restore the original device id');
assert.equal(restored.devices[0].deviceId,'dev_target');
assert.equal(records.get('dev_target').state,'offline');
assert.equal(historicalConnections.size,1,'historic foreign keys preserved');
class AccountError extends Error{constructor(message,status){super(message);this.status=status}}
const changes=[];
const deps={
 AccountError,DEVICE_ID:'hub_other',accounts:{assertOperational:()=>{},account:()=>({accountId:'acct_fixture'})},
 devices:{get:()=>({accountId:'acct_fixture',deviceId:'dev_target'}),
  remove:()=>{changes.push('device_removed');return {removed:true}}},
 clearMainIfMatches:()=>{changes.push('main_cleared');return null},
 removeRuntimeForDevice:()=>changes.push('runtime_removed'),
 enrollments:{remove:()=>{changes.push('binding_removed');return {removed:true}}},
 wakeDeviceChannelForDevice:()=>changes.push('channel_woken'),
 readJson:async()=>({reason:'relink'}),
 planEntitlements:()=>({}),
 sendJson:(res,status,body)=>{res.status=status;return body},
 deviceHasHistoricalReferences:()=>{throw Error('obsolete FK hard-delete guard must not block Remove')}
};
const res={};
const reply=await handleAccountRoutes({method:'POST'},res,
 new URL('http://operator/v1/plugin/accounts/acct_fixture/devices/dev_target/remove'),deps);
assert.equal(res.status,200);
assert.equal(reply.removed.removed,true);
assert.deepEqual(changes,['main_cleared','runtime_removed','binding_removed','device_removed','channel_woken']);
console.log('GOLD_DEVICE_REMOVE_TOMBSTONE_PASS FK_history_retained,hidden_after_restart,re_enrollment,existing_Device_ID,owner_remove_works');
