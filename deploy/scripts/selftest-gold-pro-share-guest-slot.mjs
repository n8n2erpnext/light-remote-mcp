import assert from 'node:assert/strict';
import {GoldProShareGuestSlotPg} from '../../operator-host/pro-share-guest-slot-pg.mjs';
const results=rows=>({rowCount:rows.length,rows});
const slots=new Map(),acks=new Map(),commands=[];
let txHeld=false;
const active=x=>['reserved','unknown','submitted'].includes(x.state);
const p=async(sql,args=[])=>{
 const q=sql.replace(/\s+/g,' ').trim();
 commands.push(q);
 if(q==='BEGIN'){assert.equal(txHeld,false,'fixture transactions serialized');txHeld=true;return results([])}
 if(q==='COMMIT'||q==='ROLLBACK'){assert.equal(txHeld,true);txHeld=false;return results([])}
 if(q.startsWith('SELECT pg_advisory_xact_lock'))return results([{acquired:true}]);
 if(q.startsWith('SELECT * FROM lr_gold_pro_share_guest_slots WHERE operation_id=')){
  const x=slots.get(args[0]);return results(x?[{...x}]:[]);
 }
 if(q.startsWith('SELECT operation_id FROM lr_gold_pro_share_guest_slots WHERE device_id=')){
  return results([...slots.values()].filter(x=>x.device_id===args[0]&&active(x))
   .map(x=>({operation_id:x.operation_id})));
 }
 if(q.startsWith('INSERT INTO lr_gold_pro_share_guest_slots')){
  const [op,owner,guest,dev,job,grant,conn]=args;
  if(slots.has(op)||[...slots.values()].some(x=>x.job_id===job||
    x.device_id===dev&&active(x)))return results([]);
  slots.set(op,{operation_id:op,owner_account_id:owner,guest_account_id:guest,
   device_id:dev,job_id:job,grant_id:grant,connection_id:conn,
   state:'reserved',process_id:null,terminal_state:null,terminal_acked_at:null});
  return results([{operation_id:op}]);
 }
 if(q.startsWith("UPDATE lr_gold_pro_share_guest_slots s")){
  const changed=[];
  for(const x of slots.values()){
   if(!['unknown','submitted'].includes(x.state)||!x.process_id)continue;
   if(q.includes('s.device_id=$1')&&x.device_id!==args[0])continue;
   if(q.includes('s.owner_account_id=$1')&&(x.owner_account_id!==args[0]||
     x.device_id!==args[1]||x.job_id!==args[2]||x.process_id!==args[3]))continue;
   if(q.includes('($2::text IS NULL OR s.owner_account_id=$2)')&&
      args[1]!=null&&x.owner_account_id!==args[1])continue;
   const k=[x.owner_account_id,x.device_id,x.job_id,x.process_id].join('|');
   const ack=acks.get(k);
   if(!ack)continue;
   x.state='terminal';x.terminal_state=ack.state;x.terminal_acked_at=Date.now();changed.push({operation_id:x.operation_id});
  }
  if(q.includes('RETURNING s.operation_id'))return results(changed);
  return results(changed);
 }
 if(q.startsWith("UPDATE lr_gold_pro_share_guest_slots")&&
    q.includes("state='cancelled'")){
  const [op,dev,owner,guest,job,grant,conn]=args,x=slots.get(op);
  if(!x||x.state!=='reserved'||x.device_id!==dev||x.owner_account_id!==owner||
     x.guest_account_id!==guest||x.job_id!==job||x.grant_id!==grant||
     x.connection_id!==conn)return results([]);
  x.state='cancelled';return results([{operation_id:op}]);
 }
 if(q.startsWith("UPDATE lr_gold_pro_share_guest_slots")&&
    q.includes("state='unknown'")){
  const [op,dev,owner,guest,job,grant,conn]=args,x=slots.get(op);
  if(!x||x.state!=='reserved'||x.device_id!==dev||x.owner_account_id!==owner||
     x.guest_account_id!==guest||x.job_id!==job||x.grant_id!==grant||
     x.connection_id!==conn)return results([]);
  x.state='unknown';return results([{operation_id:op}]);
 }
 if(q.startsWith('UPDATE lr_gold_pro_share_guest_slots')&&
    q.includes("state='submitted'")){
  const [owner,dev,job,pid]=args;
  const x=[...slots.values()].find(x=>x.owner_account_id===owner&&x.device_id===dev&&
   x.job_id===job&&['unknown','submitted'].includes(x.state)&&
   (!x.process_id||x.process_id===pid));
  if(!x)return results([]);
  x.process_id=pid;x.state='submitted';return results([{operation_id:x.operation_id}]);
 }
 if(q.startsWith('SELECT operation_id,job_id,state,process_id FROM lr_gold_pro_share_guest_slots')){
  return results([...slots.values()].filter(x=>x.device_id===args[0]&&active(x))
   .map(x=>({operation_id:x.operation_id,job_id:x.job_id,state:x.state,
    process_id:x.process_id})));
 }
 throw Error('unmodeled PG SQL: '+q.slice(0,110));
};
const pool={connect:async()=>({query:p,release(){}}),query:p};
let signedLaunch=false;
const options={pool,env:{LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',LR_GOLD_PRO_SHARE_CORE:'1'},
 verifySignedLaunch:async()=>signedLaunch};
const a=new GoldProShareGuestSlotPg(options);
const b=new GoldProShareGuestSlotPg(options);
const off=new GoldProShareGuestSlotPg({pool,env:{}});
assert.throws(()=>new GoldProShareGuestSlotPg({
 pool,env:{LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1'}}),
 /guest_slot_core_prerequisite_off/);
const args=(x='one',device='device-1')=>({
 ownerAccountId:'owner-1',guestAccountId:'guest-1',deviceId:device,
 operationId:'operation-' + x + '-00000001',
 jobId:'job-'+x,grantId:'grant-1',connectionId:'connection-1',
 maxConcurrent:1
});
await assert.rejects(off.acquire(args()),/guest_slots_disabled/);
await assert.rejects(a.acquire({...args(),guestAccountId:'owner-1'}),/guest_slot_scope_invalid/);
const first=await a.acquire(args());
assert.equal(first.acquired,true);
const blocked=await b.acquire(args('two'));
assert.equal(blocked.acquired,false);
assert.equal(blocked.reason,'guest_slot_device_busy');
assert.equal((await a.inspectDevice('device-1'))[0].state,'reserved');
await first.markDispatchAttempt();
assert.equal((await b.inspectDevice('device-1'))[0].state,'unknown');
assert.equal(await first.release(),false,'unknown cannot be silently retired');
const restart=new GoldProShareGuestSlotPg(options);
assert.equal((await restart.acquire(args('restart'))).acquired,false);
const pid='lp_'+'a'.repeat(28);
assert.equal((await b.reconcileSignedTerminal({
 ownerAccountId:'owner-1',deviceId:'device-1',jobId:'job-one',processId:pid
})).released,false);
assert.equal((await restart.acquire(args('not-terminal'))).acquired,false);
await assert.rejects(new GoldProShareGuestSlotPg({
 pool,env:options.env
}).bindVerifiedProcess({
 ownerAccountId:'owner-1',deviceId:'device-1',jobId:'job-one',processId:pid
}),/guest_slot_verified_launch_authority_not_wired/);
await assert.rejects(a.bindVerifiedProcess({
 ownerAccountId:'owner-1',deviceId:'device-1',jobId:'job-one',processId:pid
}),/guest_slot_signed_launch_not_verified/);
signedLaunch=true;
await a.bindVerifiedProcess({
 ownerAccountId:'owner-1',deviceId:'device-1',jobId:'job-one',processId:pid
});
assert.equal((await b.inspectDevice('device-1'))[0].state,'submitted');
assert.equal((await b.reconcileSignedTerminal({
 ownerAccountId:'owner-1',deviceId:'device-1',jobId:'job-one',processId:pid
})).released,false,'unverified process is not terminal');
acks.set(['foreign','device-1','job-one',pid].join('|'),{state:'finished'});
assert.equal((await b.reconcileSignedTerminal({
 ownerAccountId:'owner-1',deviceId:'device-1',jobId:'job-one',processId:pid
})).released,false,'other owner terminal cannot release');
acks.set(['owner-1','device-1','job-other',pid].join('|'),{state:'finished'});
assert.equal((await b.reconcileSignedTerminal({
 ownerAccountId:'owner-1',deviceId:'device-1',jobId:'job-one',processId:pid
})).released,false,'other job terminal cannot release');
acks.set(['owner-1','device-1','job-one',pid].join('|'),{state:'finished'});
assert.equal((await restart.reconcileDevice({
 ownerAccountId:'owner-1',deviceId:'device-1'
})).settled,1);
assert.equal((await restart.reconcileSignedTerminal({
 ownerAccountId:'owner-1',deviceId:'device-1',jobId:'job-one',processId:pid
})).released,false,'duplicate terminal must be idempotent');
assert.equal(slots.get(args().operationId).state,'terminal');
const second=await b.acquire(args('two'));
assert.equal(second.acquired,true);
assert.equal((await a.acquire(args())).acquired,false,'old operation ID never replayed');
await assert.rejects(a.acquire({...args(),guestAccountId:'another-guest'}),
 /guest_slot_operation_conflict/);
assert.equal(await second.release(),true);
await assert.rejects(second.markDispatchAttempt(),/guest_slot_dispatch_attempt_conflict/);
const third=await restart.acquire(args('third'));
assert.equal(third.acquired,true);
await third.markDispatchAttempt();
assert.equal((await a.acquire(args('fourth'))).acquired,false);
assert.equal((await a.inspectDevice('device-1'))[0].state,'unknown');
assert.equal((await b.acquire(args('parallel','device-2'))).acquired,true);
assert.ok(commands.some(x=>x.includes('pg_advisory_xact_lock')));
assert.equal(txHeld,false);
console.log('GOLD_P2I4C3_PG_SLOT_CROSS_OPERATOR_RESTART_UNKNOWN_FENCE=PASS');
console.log('GOLD_P2I4C3_TERMINAL_ACK_EXACT_OWNER_DEVICE_JOB_PROCESS=PASS');
console.log('GOLD_P2I4C3_NO_TTL_NO_REPLAY_PRE_DISPATCH_CANCEL=PASS');
