import test from 'node:test';
import assert from 'node:assert/strict';
import {GoldPgSupportOutbox} from '../src/storage/support-outbox-pg.mjs';

const account={accountId:'acct-1',email:'owner@example.test',plan:'pro'};
const another={accountId:'acct-2',email:'member@example.test',plan:'pro'};
const payload={subject:'Test ticket',description:'Repro steps',diagnostics:{problem_area:'install'}};
const now=Date.parse('2026-10-17T08:00:00Z');
const futureDate=ms=>new Date(ms);
function fakePool(){
 const map=new Map(),calls=[];let released=0,transactions=0,rollbacks=0;
 const query=async(sql,values=[])=>{
  calls.push({sql,values});
  if(sql==='BEGIN'){transactions++;return{rows:[]}}
  if(sql==='COMMIT')return{rows:[]};
  if(sql==='ROLLBACK'){rollbacks++;return{rows:[]}};
  if(sql.includes('pg_advisory_xact_lock'))return{rows:[]};
  if(sql.startsWith('SELECT * FROM lr_support_outbox WHERE event_id=$1 FOR UPDATE')){
   const row=map.get(values[0]);return{rows:row?[row]:[]};
  }
  if(sql.includes("COUNT(*)::integer AS count")){
   return{rows:[{count:[...map.values()].filter(r=>r.status==='queued').length}]};
  }
  if(sql.startsWith('INSERT INTO lr_support_outbox')){
   const [id,accountId,email,plan,json]=values;
   const row={event_id:id,account_id:accountId,account_email:email,account_plan:plan,
    payload:JSON.parse(json),status:'queued',attempts:0,created_at:futureDate(now),
    next_attempt_at:futureDate(now),delivered_at:null,remote_status:null,result_name:null,
    status_check_attempts:0,next_status_check_at:null,last_error:null,
    lease_token:null,lease_until:null,lease_kind:null};
   map.set(id,row);return{rows:[row]};
  }
  if(sql.startsWith('SELECT * FROM lr_support_outbox WHERE event_id=$1 AND account_id=$2')){
   const row=map.get(values[0]);return{rows:row?.account_id===values[1]?[row]:[]};
  }
  if(sql.startsWith('WITH due AS')){
   const kind=values[3],lease=values[1],sec=values[2],limit=values[0];
   assert.match(sql,/FOR UPDATE SKIP LOCKED/);
   const rows=[...map.values()].filter(r=>
     (r.lease_until===null||r.lease_until.getTime()<=now)&&(
      kind==='delivery'?r.status==='queued'&&r.next_attempt_at?.getTime()<=now:
       r.status==='sent'&&!r.result_name&&r.next_status_check_at?.getTime()<=now)
   ).slice(0,limit);
   for(const row of rows){
    row.lease_token=lease;row.lease_until=futureDate(now+sec*1000);row.lease_kind=kind;
   }
   return{rows};
  }
  if(sql.startsWith('UPDATE lr_support_outbox SET')){
   const [id,token,...rest]=values,kind=rest.at(-1);
   const row=map.get(id);
   if(!row||row.lease_token!==token||row.lease_kind!==kind||row.lease_until.getTime()<=now)
     return{rows:[]};
   if(sql.includes("status='sent'")){
    row.status='sent';row.delivered_at=futureDate(rest[0]);
    row.next_attempt_at=null;row.remote_status=rest[1];row.result_name=rest[2];
    row.next_status_check_at=rest[2]?null:futureDate(rest[0]);
    row.status_check_attempts=0;row.last_error=null;
   }else if(sql.includes("status='queued'")){
    row.status='queued';row.attempts++;
    row.next_attempt_at=futureDate(rest[0]);
    row.last_error=sql.includes('backoffice_processing_failed')?
      'backoffice_processing_failed':rest[1];
    row.next_status_check_at=null;
   }else if(kind==='status'){
    row.status_check_attempts++;
    if(sql.includes('remote_status=$3')){
      row.remote_status=rest[0];row.result_name=rest[1];
      row.next_status_check_at=rest[2]?futureDate(rest[2]):null;
      row.last_error=null;
    }else{
      row.next_status_check_at=futureDate(rest[0]);row.last_error=rest[1];
    }
   }
   row.lease_token=null;row.lease_until=null;row.lease_kind=null;
   return{rows:[row]};
  }
  throw Error('unsupported_sql:'+sql);
 };
 return {query,connect:async()=>({query,release:()=>{released++}}),
  calls,map,get released(){return released},get rollbacks(){return rollbacks}};
}
test('Gold supports durable accepted enqueue and account-isolated status without any JSON file',async()=>{
 const pool=fakePool(),repo=new GoldPgSupportOutbox({pool,now:()=>now});
 const accepted=await repo.enqueue({account,payload});
 assert.equal(accepted.status,'queued');
 assert.match(accepted.eventId,/^lr\.support\./);
 assert.equal(accepted.attempts,0);
 assert.equal(pool.released,1);
 assert.equal((await repo.get(accepted.eventId,account.accountId)).eventId,accepted.eventId);
 assert.equal(await repo.get(accepted.eventId,another.accountId),null);
 assert.equal(pool.map.get(accepted.eventId).payload.event_id,accepted.eventId);
 assert(pool.calls.some(c=>c.sql.includes('INSERT INTO lr_support_outbox')));
 assert(!pool.calls.some(c=>c.sql.includes('json_state')));
});
test('Gold enqueue is idempotent and cannot reveal another account event or accept Free users',async()=>{
 const pool=fakePool(),repo=new GoldPgSupportOutbox({pool,now:()=>now});
 const first=await repo.enqueue({account,payload});
 assert.equal((await repo.enqueue({account,payload,eventId:first.eventId})).eventId,first.eventId);
 assert.equal(pool.map.size,1);
 await assert.rejects(()=>repo.enqueue({account:another,payload,eventId:first.eventId}),/support_event_not_found/);
 assert.equal(pool.rollbacks,1);
 await assert.rejects(()=>repo.enqueue({account:{...account,plan:'free'},payload}),/support_account_not_eligible/);
 assert.equal(pool.map.size,1);
});
test('Gold worker claims jobs with SKIP LOCKED; separate workers cannot double-claim',async()=>{
 const pool=fakePool(),a=new GoldPgSupportOutbox({pool,now:()=>now});
 const b=new GoldPgSupportOutbox({pool,now:()=>now});
 const accepted=await a.enqueue({account,payload});
 const first=await a.claim('delivery');
 assert.equal(first.length,1);assert.equal(first[0].eventId,accepted.eventId);
 assert.equal((await b.claim('delivery')).length,0);
 assert.equal((await a.markDelivered(first[0],{remoteStatus:'Received'})).status,'sent');
 assert.equal((await a.claim('delivery')).length,0);
 assert.equal((await b.claim('status')).length,1);
 assert(pool.calls.some(c=>c.sql.includes('FOR UPDATE SKIP LOCKED')));
});
test('Gold worker fences a stolen lease and prevents stale delivery status overwrites',async()=>{
 const pool=fakePool(),repo=new GoldPgSupportOutbox({pool,now:()=>now});
 const queued=await repo.enqueue({account,payload});
 const [leased]=await repo.claim('delivery');
 pool.map.get(queued.eventId).lease_token='00000000-0000-4000-8000-000000000000';
 await assert.rejects(()=>repo.markDelivered(leased,{remoteStatus:'Received'}),/support_lease_expired_or_stolen/);
 assert.equal(pool.map.get(queued.eventId).status,'queued');
});
test('Gold worker retry/backoff and remote status completion are committed by lease',async()=>{
 const pool=fakePool(),repo=new GoldPgSupportOutbox({pool,now:()=>now});
 const accepted=await repo.enqueue({account,payload});
 const [first]=await repo.claim('delivery');
 const scheduled=await repo.reschedule(first,Error('synthetic_unreachable'));
 assert.equal(scheduled.attempts,1);
 assert.equal(scheduled.nextAttemptAt,now+5000);
 assert.equal((await repo.claim('delivery')).length,0);
 pool.map.get(accepted.eventId).next_attempt_at=futureDate(now);
 const [second]=await repo.claim('delivery');
 await repo.markDelivered(second,{remoteStatus:'Received'});
 const [status]=await repo.claim('status');
 assert.equal(status.eventId,accepted.eventId);
 const result=await repo.updateStatus(status,{remoteStatus:'Succeeded',resultName:'SUP-0001'});
 assert.equal(result.resultName,'SUP-0001');
 assert.equal((await repo.claim('status')).length,0);
});
test('Gold outbound deliveries are disabled until separately authorized',async()=>{
 const pool=fakePool(),repo=new GoldPgSupportOutbox({pool});
 await repo.enqueue({account,payload});
 assert.deepEqual(await repo.pump(),{ok:true,skipped:true,reason:'gold_support_delivery_disabled'});
 assert(!pool.calls.some(c=>c.sql.startsWith('WITH due AS')));
 const enabled=new GoldPgSupportOutbox({pool,deliveryEnabled:true});
 await assert.rejects(()=>enabled.pump(),/gold_support_delivery_adapter_missing/);
});
test('Gold worker can deliver and check statuses through injected synthetic ERPNext adapters',async()=>{
 const pool=fakePool();let sends=0,checks=0;
 const repo=new GoldPgSupportOutbox({pool,now:()=>now,deliveryEnabled:true,
  deliver:async row=>{sends++;assert.equal(row.payload.event_id,row.eventId);return{remoteStatus:'Received'}},
  checkStatus:async row=>{checks++;return{remoteStatus:'Succeeded',resultName:'TEST-CASE-1'}}
 });
 const queued=await repo.enqueue({account,payload});
 const result=await repo.pump();
 assert.equal(result.ok,true);assert.equal(result.delivered,1);assert.equal(result.resolved,1);
 assert.equal(sends,1);assert.equal(checks,1);
 assert.equal((await repo.get(queued.eventId,account.accountId)).resultName,'TEST-CASE-1');
});
