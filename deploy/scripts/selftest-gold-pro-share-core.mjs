import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GoldProShareStore,ProShareError} from '../../operator-host/pro-share-store.mjs';
import {PRO_TEAM_MAX_SEATS} from '../../operator-host/pro-team-registry.mjs';

const owner='owner-1',guest='guest-1',stranger='guest-2';
let clock=1800000000000,plan='pro',active=true,approvedPurpose='pro-share-guest';
const addons=new Map(),seats=new Map(),shared=new Set(),events=new Map();
const snap={};
const result=(rows)=>({rows,rowCount:rows.length});
function query(sql,args=[]){
 const q=sql.replace(/\s+/g,' ').trim();
 if(['BEGIN','COMMIT','ROLLBACK'].includes(q))return result([]);
 if(q.startsWith('INSERT INTO lr_gold_pro_share_addons')){
  const [o,t,b]=args;const old=addons.get(o);
  const a={owner_account_id:o,state:'trial',valid_until_ms:t,
   monthly_guest_call_budget:b,source:'explicit-uat',revision:(old?.revision??0)+1};
  addons.set(o,a);return result([a]);
 }
 if(q.startsWith('SELECT * FROM lr_gold_pro_share_addons')){
  const a=addons.get(args[0]);return result(a?[a]:[]);
 }
 if(q.startsWith('SELECT owner_account_id FROM lr_gold_pro_share_addons')){
  const a=addons.get(args[0]);return result(a?[a]:[]);
 }
 if(q.startsWith('SELECT status FROM lr_gold_pro_share_seats')){
  const a=seats.get(args[0]);return result(a?[a]:[]);
 }
 if(q.startsWith('SELECT * FROM lr_gold_pro_share_seats')){
  const a=seats.get(args[0]);return result(a?[a]:[]);
 }
 if(q.startsWith('INSERT INTO lr_gold_pro_share_seats')&&q.includes("'invited'")){
  const [o,email,digest,exp]=args;
  seats.set(o,{owner_account_id:o,status:'invited',guest_account_id:null,
   invited_email:email,invite_hash:digest,invite_expires_ms:exp});
  return result([]);
 }
 if(q.startsWith('INSERT INTO lr_gold_pro_share_seats')&&q.includes("'empty'")){
  seats.set(args[0],{owner_account_id:args[0],status:'empty',
   guest_account_id:null,invite_hash:null,invited_email:null,invite_expires_ms:null});
  return result([]);
 }
 if(q.startsWith('UPDATE lr_gold_pro_share_seats')){
  const [o,g]=args;seats.set(o,{owner_account_id:o,status:'accepted',
   guest_account_id:g,invite_hash:null,invited_email:null,invite_expires_ms:null});
  return result([]);
 }
 if(q.startsWith('UPDATE lr_gold_pro_share_addons')){
  const a=addons.get(args[0]);a.revision++;return result([]);
 }
 if(q.startsWith('INSERT INTO lr_gold_pro_share_devices')){
  const [o,d]=args;
  if(o!==owner||d==='foreign-device'||shared.has(o+':'+d))return result([]);
  shared.add(o+':'+d);return result([{device_id:d}]);
 }
 if(q.startsWith('SELECT 1 FROM lr_gold_pro_share_devices')){
  const [o,d]=args;return result(shared.has(o+':'+d)?[{'?column?':1}]:[]);
 }
 if(q.startsWith('DELETE FROM lr_gold_pro_share_devices')){
  shared.delete(args[0]+':'+args[1]);return result([]);
 }
 if(q.startsWith('SELECT a.owner_account_id')){
  const [o,g,d,t]=args,a=addons.get(o),seat=seats.get(o);
  if(a&&['trial','active'].includes(a.state)&&a.valid_until_ms>t&&
     seat?.status==='accepted'&&seat.guest_account_id===g&&shared.has(o+':'+d))
   return result([{...a,guest_account_id:g}]);
  return result([]);
 }
 if(q.startsWith('SELECT guest_account_id,device_id,agent_id')){
  const e=events.get(args[0]+':'+args[1]);return result(e?[e]:[]);
 }
 if(q.startsWith('SELECT COALESCE(SUM(units)')){
  const [o,period]=args;let used=0;
  for(const e of events.values())if(e.owner_account_id===o&&e.period_utc===period)used+=e.units;
  return result([{used:BigInt(used)}]);
 }
 if(q.startsWith('INSERT INTO lr_gold_pro_share_usage_events')){
  const [o,id,g,d,a,grant,conn,period,units]=args;
  events.set(o+':'+id,{owner_account_id:o,operation_id:id,
   guest_account_id:g,device_id:d,agent_id:a,grant_id:grant,
   connection_id:conn,period_utc:period,units});
  return result([]);
 }
 throw Error('Unmodelled SQL: '+q.slice(0,110));
}
const pg={query:async(...args)=>query(...args),connect:async()=>({
 query:async(...args)=>query(...args),release(){}
})};
const opts={pool:pg,now:()=>clock,env:{
 LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_ADMIN_UAT:'1'},
 planFor:account=>account===owner?plan:'free',
 accountActive:()=>active,accountVerified:()=>true,
 emailFor:account=>account===owner?'owner@example.test':
  account===guest?'guest@example.test':'other@example.test'};
const store=new GoldProShareStore(opts),off=new GoldProShareStore({...opts,env:{}});
await assert.rejects(off.inviteEmail({authenticatedOwnerAccountId:owner,
 guestEmail:'guest@example.test'}),/pro_share_disabled/);
assert.equal(PRO_TEAM_MAX_SEATS,5,'Pro Team remains unchanged and frozen');
await store.grantUatEntitlement({ownerAccountId:owner,
 validUntil:clock+86400000,monthlyGuestCallBudget:2});
const invite=await store.inviteEmail({authenticatedOwnerAccountId:owner,
 guestEmail:'Guest@Example.Test'});
assert.match(invite.inviteCode,/^[A-Za-z0-9_-]{32}$/);
assert.equal(invite.seatLimit,1);
await assert.rejects(store.acceptInvite({authenticatedGuestAccountId:stranger,
 ownerAccountId:owner,inviteCode:invite.inviteCode}),/pro_share_invite_invalid/);
assert.equal((await store.acceptInvite({authenticatedGuestAccountId:guest,
 ownerAccountId:owner,inviteCode:invite.inviteCode})).accepted,true);
await assert.rejects(store.inviteEmail({authenticatedOwnerAccountId:owner,
 guestEmail:'other@example.test'}),/pro_share_one_guest_limit/);
await assert.rejects(store.shareDevice({authenticatedOwnerAccountId:owner,
 deviceId:'foreign-device'}),/pro_share_device_not_owned/);
await store.shareDevice({authenticatedOwnerAccountId:owner,deviceId:'device-1'});
const device={deviceId:'device-1',accountId:owner,state:'online'};
const connection={connectionId:'connection-1',accountId:owner,
 state:'connected',hardExpiresAt:clock+86400000};
const grant={grantId:'guest-grant-1',accountId:guest,agentId:'agent-1',
 deviceId:'device-1',connectionId:'connection-1',purpose:approvedPurpose,
 approvedAt:clock-3000,expiresAt:clock+3600000,
 absoluteExpiresAt:clock-3000+86400000,closedAt:null};
const accessGrants={assert:(id,scope)=>{
 assert.equal(id,grant.grantId);
 assert.equal(scope.accountId,guest);
 assert.equal(scope.agentId,'agent-1');
 assert.equal(scope.touch,false);
 return {...grant,purpose:approvedPurpose};
}};
const authority={authenticatedActorAccountId:guest,authenticatedAgentId:'agent-1',
 device,connection,grantId:grant.grantId,accessGrants};
assert.equal((await store.authorize(authority)).billedAccountId,owner);
assert.equal((await store.authorize(authority)).maxGuestConcurrentJobs,1);
approvedPurpose='team-member';
await assert.rejects(store.authorize(authority),/pro_share_guest_independent_ab_required/);
approvedPurpose='pro-share-guest';
const op='operation-1234567890';
assert.equal((await store.billOnce({...authority,operationId:op})).charged,true);
assert.equal((await store.billOnce({...authority,operationId:op})).idempotent,true);
assert.equal(events.size,1);
await assert.rejects(store.billOnce({...authority,operationId:op,units:2}),
 /pro_share_operation_id_conflict/);
assert.equal((await store.billOnce({...authority,operationId:'operation-9999999999'})).charged,true);
await assert.rejects(store.billOnce({...authority,operationId:'operation-2222222222'}),
 /pro_share_guest_monthly_budget_exhausted/);
assert.equal(events.size,2);
await store.revoke({authenticatedOwnerAccountId:owner,deviceId:'device-1'});
await assert.rejects(store.authorize(authority),/pro_share_guest_device_or_addon_required/);
plan='free';
await assert.rejects(store.inviteEmail({authenticatedOwnerAccountId:owner,
 guestEmail:'new@example.test'}),/pro_share_owner_not_eligible/);
plan='pro';
await store.revoke({authenticatedOwnerAccountId:owner,removeGuest:true});
assert.equal(seats.get(owner).status,'empty');
assert.equal(events.size,2,'revocation never mutates settled usage events');
const schema=fs.readFileSync(new URL('../../platform-v2/sql/044_gold_pro_share.sql',import.meta.url),'utf8');
assert.match(schema,/PRIMARY KEY\(owner_account_id,operation_id\)/);
assert.match(schema,/guest_account_id <> owner_account_id/);
assert.match(schema,/status = 'accepted'/);
assert.match(schema,/SOURCE CANDIDATE ONLY/);
console.log('GOLD_P2I4_PRO_SHARE_ONE_GUEST_DEVICE_ISOLATION_BUDGET_IDEMPOTENCY=PASS');
console.log('GOLD_P2I4_PRO_SHARE_TEAM_FROZEN_AND_DEFAULT_OFF=PASS');
