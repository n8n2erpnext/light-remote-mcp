import test from 'node:test';
import assert from 'node:assert/strict';
import {GoldPgDeviceChannelAuthority} from '../src/storage/gold-device-channel-authority.mjs';

const NOW=Date.parse('2026-10-17T12:00:00.000Z');
const OWNER='acct_owner',DEVICE='dev_home',NODE='node_home';
function setup(){
 const calls=[],connections=new Map();
 const state={now:NOW,deviceState:'offline',accountState:'active',
  plan:'free',authorized:true,owner:OWNER,device:DEVICE,node:NODE,
  payload:{leaseMs:3600000,reconnectGraceMs:1800000}};
 const query=async(sql,p=[])=>{
  calls.push({sql,p});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||
     sql.includes('SELECT pg_advisory_xact_lock'))return{rows:[]};
  if(sql.startsWith('SELECT connection_id,account_id,device_id FROM lr_device_connections')){
   return{rows:[...connections.values()].filter(row=>!row.closed_at&&
    row.expiresAt<=state.now).slice(0,p[0]).map(row=>({
     connection_id:row.connectionId,account_id:row.accountId,
     device_id:row.deviceId}))};
  }
  if(sql.startsWith('SELECT device_id FROM lr_devices WHERE device_id=')){
   return{rows:p[0]===DEVICE&&p[1]===OWNER?[{device_id:DEVICE}]:[]};
  }
  if(sql.startsWith('SELECT connection_id,hard_expires_at,closed_at FROM lr_device_connections')){
   const row=connections.get(p[0]);
   return{rows:row&&row.accountId===p[1]&&row.deviceId===p[2]?[{
    connection_id:row.connectionId,hard_expires_at:new Date(row.expiresAt),
    closed_at:row.closed_at}]:[]};
  }
  if(sql.startsWith('SELECT d.device_id,d.node_id,d.state,a.status,a.plan')){
   return{rows:p[0]===DEVICE&&p[1]===OWNER&&p[2]===NODE?
    [{device_id:DEVICE,node_id:NODE,state:state.deviceState,
      status:state.accountState,plan:state.plan}]:[]};
  }
  if(sql.startsWith('SELECT connection_id,hard_expires_at,reconnect_grace_ms')&&
   sql.includes('WHERE account_id=$1')){
   return{rows:[...connections.values()].filter(x=>
    x.accountId===p[0]&&x.deviceId===p[1]&&!x.closed_at).map(x=>({
     connection_id:x.connectionId,hard_expires_at:new Date(x.expiresAt),
     reconnect_grace_ms:x.reconnectGraceMs}))};
  }
  if(sql.includes('COUNT(DISTINCT device_id)')){
   return{rows:[{count:[...connections.values()].filter(x=>
    x.accountId===p[0]&&!x.closed_at&&x.expiresAt>state.now).length}]};
  }
  if(sql.startsWith('INSERT INTO lr_device_connections(')){
   connections.set(p[0],{connectionId:p[0],accountId:p[1],deviceId:p[2],
    expiresAt:p[4],reconnectGraceMs:p[5],closed_at:null});
   return{rows:[{connection_id:p[0]}]};
  }
  if(sql.startsWith('UPDATE lr_device_connections SET last_activity_at'))
   return{rows:[]};
  if(sql.startsWith('UPDATE lr_devices SET state=')){
   state.deviceState=sql.includes("state='offline'")?'offline':'online';
   return{rows:[]};
  }
  if(sql.startsWith('SELECT connection_id,hard_expires_at,reconnect_grace_ms,closed_at')){
   const x=connections.get(p[0]);
   return{rows:x&&x.accountId===p[1]&&x.deviceId===p[2]?[{
    connection_id:x.connectionId,hard_expires_at:new Date(x.expiresAt),
    reconnect_grace_ms:x.reconnectGraceMs,closed_at:x.closed_at}]:[]};
  }
  if(sql.startsWith('SELECT connection_id FROM lr_device_connections ')){
   return{rows:[...connections.values()].filter(row=>row.deviceId===p[0]&&
    row.accountId===p[1]&&row.connectionId!==p[2]&&!row.closed_at&&
    row.expiresAt>state.now).map(row=>({connection_id:row.connectionId}))};
  }
  if(sql.startsWith('UPDATE lr_device_connections SET reconnect_grace_ms=')){
   connections.get(p[0]).reconnectGraceMs=p[1];return{rows:[]};
  }
  if(sql.startsWith('UPDATE lr_ab_requests SET state=')||
     sql.startsWith('UPDATE lr_ab_grants SET closed_at=')||
     sql.startsWith('UPDATE lr_remote_sessions SET closed_at=')||
     sql.startsWith('UPDATE lr_jobs SET state='))return{rows:[]};
  if(sql.startsWith('UPDATE lr_device_connections SET closed_at=')){
   connections.get(p[0]).closed_at=new Date(state.now);
   return{rows:[]};
  }
  throw Error('unmocked_device_channel_sql '+sql.slice(0,110));
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const svc=new GoldPgDeviceChannelAuthority({pool,now:()=>state.now,
  verifyChannelEnvelope:async({purpose,signedEnvelope})=>{
   calls.push({sql:'SIGNED_PROOF_VERIFIED',p:[purpose,signedEnvelope]});
   return state.authorized&&signedEnvelope==='device-signature'?
    {authorized:true,ownerAccountId:state.owner,deviceId:state.device,
     nodeId:state.node,payload:state.payload}:null;
  }});
 const call=(action,options={})=>svc[action]({signedEnvelope:'device-signature',...options});
 return {svc,state,calls,connections,call};
}

test('Gold device channel requires PG and signed verifier, not caller owner',()=>{
 assert.throws(()=>new GoldPgDeviceChannelAuthority(),/gold_channel_pg_pool_required/);
 assert.throws(()=>new GoldPgDeviceChannelAuthority({
  pool:{connect(){},query(){}}}),/gold_channel_signed_device_verifier_required/);
});
test('Signed device opens new PG connection and reconnect reuses same lease without extending expiry',async()=>{
 const f=setup();
 const first=await f.call('connect');
 assert.match(first.connectionId,/^conn_/);
 assert.equal(first.deviceId,DEVICE);
 assert.equal(first.accountId,OWNER);
 assert.equal(first.reconnectGraceMs,1800000);
 assert.equal(first.expiresAt,NOW+3600000);
 assert.equal(f.state.deviceState,'online');
 const ownerLock=f.calls.find(x=>x.sql.includes('pg_advisory_xact_lock(hashtext($1))'));
 assert.deepEqual(ownerLock?.p,['gold:connect:'+OWNER],
  'owner lock must match Core connectDevice to serialize account device cap');
 assert(f.calls.some(x=>x.sql.includes('pg_advisory_xact_lock(hashtextextended')));
 const reused=await f.call('connect');
 assert.equal(reused.connectionId,first.connectionId);
 assert.equal(reused.expiresAt,first.expiresAt);
 assert.equal(reused.reused,true);
 assert.equal(f.connections.size,1);
 assert.equal(f.calls.at(-1).sql,'COMMIT');
});
test('Gold device channel rejects incorrect owner or revoked device before writing connection',async()=>{
 const f=setup();f.state.owner='acct_attacker';
 await assert.rejects(()=>f.call('connect'),/gold_channel_owner_device_disabled/);
 assert.equal(f.connections.size,0);
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');
 f.state.owner=OWNER;f.state.deviceState='revoked';
 await assert.rejects(()=>f.call('connect'),/gold_channel_owner_device_disabled/);
 assert.equal(f.connections.size,0);
});
test('Channel lease recovery expires the OLD grant, A/B request, remote session and queued jobs',async()=>{
 const f=setup();
 const first=await f.call('connect');
 f.state.now+=3600001;
 const second=await f.call('connect');
 assert.notEqual(second.connectionId,first.connectionId);
 assert(f.connections.get(first.connectionId).closed_at);
 const sql=f.calls.map(c=>c.sql);
 for(const required of ['UPDATE lr_ab_requests SET state=',
  'UPDATE lr_ab_grants SET closed_at=',
  'UPDATE lr_remote_sessions SET closed_at=',
  "UPDATE lr_jobs SET state='canceled'"]){
  assert(sql.some(x=>x.startsWith(required)),required);
 }
 assert(!sql.some(x=>x.includes('DELETE FROM lr_ab_team_actor_grants')),
  'never delete Team actor FK used by Gold 019');
 assert.equal(f.state.deviceState,'online');
});
test('Renew and grace update connection only with new signed purpose, cannot extend hard lease',async()=>{
 const f=setup(),conn=await f.call('connect');
 f.state.payload={connectionId:conn.connectionId,reconnectGraceMs:900000};
 const renewed=await f.call('renew',{connectionId:'conn_forged'});
 assert.equal(renewed.connectionId,conn.connectionId,
  'caller connection override must be ignored; signed payload controls request');
 assert.equal(renewed.expiresAt,conn.expiresAt);
 f.state.payload={connectionId:conn.connectionId,reconnectGraceMs:900000};
 const grace=await f.call('setGrace');
 assert.equal(grace.reconnectGraceMs,900000);
 assert.equal(grace.expiresAt,conn.expiresAt);
 const x=await f.call('renew');
 assert.equal(x.reconnectGraceMs,900000);
 f.state.now+=3600001;
 await assert.rejects(()=>f.call('renew'),/gold_channel_connection_invalid_or_expired/);
});
test('Device disconnect closes PG grants/session/queued jobs and rejects replay after closure',async()=>{
 const f=setup(),conn=await f.call('connect');
 f.state.payload={connectionId:conn.connectionId,reason:'client_disconnect'};
 const response=await f.call('disconnect');
 assert.equal(response.closed,true);
 assert.equal(f.state.deviceState,'offline');
 assert(f.connections.get(conn.connectionId).closed_at);
 assert(f.calls.some(x=>x.sql.includes("hold_reason=$2")));
 assert(f.calls.some(x=>x.sql.includes("state='queued'")));
 await assert.rejects(()=>f.call('disconnect'),/gold_channel_connection_invalid_or_expired/);
});
test('Channel verification fails closed on unsigned request and disallowed lease/grace',async()=>{
 const f=setup();f.state.authorized=false;
 await assert.rejects(()=>f.call('connect'),/gold_channel_device_proof_invalid/);
 assert.equal(f.connections.size,0);
 f.state.authorized=true;f.state.payload={leaseMs:1000};
 await assert.rejects(()=>f.call('connect'),/gold_channel_invalid_lease/);
 f.state.payload={connectionId:'conn_bad',reason:'fake_reason'};
 await assert.rejects(()=>f.call('disconnect'),/gold_channel_disconnect_reason_invalid/);
 assert.equal(f.connections.size,0);
});

test('Cleanup of expired duplicate connection cannot cancel jobs on active same-device lease',async()=>{
 const f=setup(),first=await f.call('connect');
 const old=f.connections.get(first.connectionId);
 old.expiresAt=NOW-1; // externally persisted expired row still unclosed
 const active='conn_other_active';
 f.connections.set(active,{connectionId:active,accountId:OWNER,
  deviceId:DEVICE,expiresAt:NOW+600000,reconnectGraceMs:900000,closed_at:null});
 const before=f.calls.length;
 const reused=await f.call('connect');
 assert.equal(reused.connectionId,active);
 assert(f.connections.get(first.connectionId).closed_at);
 assert(!f.calls.slice(before).some(x=>x.sql.startsWith("UPDATE lr_jobs SET state='canceled'")),
  'V20 job rows cannot be scoped to the expired connection without its FK');
});
test('Gold refuses multiple simultaneous active device connections rather than arbitrarily choosing',async()=>{
 const f=setup(),first=await f.call('connect');
 f.connections.set('conn_duplicate',{connectionId:'conn_duplicate',accountId:OWNER,
  deviceId:DEVICE,expiresAt:NOW+600000,reconnectGraceMs:900000,closed_at:null});
 await assert.rejects(()=>f.call('connect'),/gold_channel_multiple_active_connections/);
 assert(!f.connections.get(first.connectionId).closed_at);
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});

test('Disconnect one of two imported live leases leaves other online and queued jobs intact',async()=>{
 const f=setup(),first=await f.call('connect');
 f.connections.set('conn_still_live',{connectionId:'conn_still_live',
  accountId:OWNER,deviceId:DEVICE,
  expiresAt:NOW+600000,reconnectGraceMs:900000,closed_at:null});
 f.state.payload={connectionId:first.connectionId,reason:'client_disconnect'};
 const before=f.calls.length;
 const result=await f.call('disconnect');
 assert.equal(result.closed,true);
 assert(f.connections.get(first.connectionId).closed_at);
 assert.equal(f.state.deviceState,'online');
 assert(!f.calls.slice(before).some(x=>x.sql.startsWith("UPDATE lr_jobs SET state='canceled'")));
});

test('Gold PG channel reaper closes abandoned lease, A/B authority and queued work with no signed device online',async()=>{
 const f=setup(),connection=await f.call('connect');
 f.state.now+=3600001;
 const begin=f.calls.length;
 const result=await f.svc.reapExpired({limit:12});
 assert.deepEqual(result,{scanned:1,expired:1,skipped:0});
 assert(f.connections.get(connection.connectionId).closed_at);
 assert.equal(f.state.deviceState,'offline');
 const cleaned=f.calls.slice(begin);
 assert(cleaned.some(x=>x.sql.startsWith("UPDATE lr_ab_grants SET closed_at")));
 assert(cleaned.some(x=>x.sql.startsWith("UPDATE lr_remote_sessions SET closed_at")));
 const canceled=cleaned.find(x=>x.sql.startsWith("UPDATE lr_jobs SET state='canceled'"));
 assert(canceled?.sql.includes('(device_id,owner_account_id)'));
 assert.equal(cleaned.at(-1).sql,'COMMIT');
 const twice=await f.svc.reapExpired({limit:12});
 assert.deepEqual(twice,{scanned:0,expired:0,skipped:0});
});
test('Gold reaper preserves a still-live replacement connection and queued jobs',async()=>{
 const f=setup(),first=await f.call('connect');
 f.state.now+=3600001;
 const other='conn_active_signed_new';
 f.connections.set(other,{connectionId:other,accountId:OWNER,deviceId:DEVICE,
  expiresAt:f.state.now+600000,reconnectGraceMs:900000,closed_at:null});
 const begin=f.calls.length;
 const result=await f.svc.reapExpired();
 assert.equal(result.expired,1);
 assert(f.connections.get(first.connectionId).closed_at);
 assert.equal(f.state.deviceState,'online');
 assert(!f.calls.slice(begin).some(x=>x.sql.startsWith("UPDATE lr_jobs SET state='canceled'")));
});
test('Gold reaper refuses out-of-range batch sizes and propagates PostgreSQL failures',async()=>{
 const f=setup();
 await assert.rejects(()=>f.svc.reapExpired({limit:0}),/gold_channel_reaper_limit_invalid/);
 await assert.rejects(()=>f.svc.reapExpired({limit:129}),/gold_channel_reaper_limit_invalid/);
 const previous=f.svc.pool.query;
 f.svc.pool.query=async()=>{throw Error('real_pg_unavailable')};
 await assert.rejects(()=>f.svc.reapExpired(),/real_pg_unavailable/);
 f.svc.pool.query=previous;
});
