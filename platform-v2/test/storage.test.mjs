import test from 'node:test';
import assert from 'node:assert/strict';
import {PgUatRepository} from '../src/storage/postgres.mjs';
import {RedisUatAuxiliary} from '../src/storage/redis.mjs';

function pool({row={database:'light_remote_rc50_uat',role:'lr_rc50_app',superuser:false},response=null}={}){
 const queries=[];let released=0;let fail=false;
 const run=async(sql,params=[])=>{
   queries.push({sql,params});
   if(fail&&sql==='COMMIT')throw Error('commit_failed');
   if(sql.includes('current_database'))return {rows:[row]};
   if(response)return response(sql,params);
   return {rows:[]};
 };
 return {queries,query:run,connect:async()=>({query:run,release:()=>released++}),get released(){return released},set failOnCommit(v){fail=v}};
}
test('Postgres adapter is explicitly UAT only',()=>{
 assert.throws(()=>new PgUatRepository({pool:pool()}),/pg_uat_mode_required/);
 assert.throws(()=>new PgUatRepository({pool:pool(),allowUat:true,expectedDb:'production'}),/pg_uat_database_must_match/);
});
test('Postgres refuses production database and superuser authority',async()=>{
 const badName=new PgUatRepository({allowUat:true,pool:pool({row:{database:'prod',role:'limited',superuser:false}})});
 await assert.rejects(()=>badName.verifyTarget(),/pg_unexpected_database/);
 const privileged=new PgUatRepository({allowUat:true,pool:pool({row:{database:'light_remote_rc50_uat',role:'postgres',superuser:true}})});
 await assert.rejects(()=>privileged.verifyTarget(),/pg_superuser_forbidden/);
 const clean=new PgUatRepository({allowUat:true,pool:pool()});
 assert.deepEqual(await clean.verifyTarget(),{database:'light_remote_rc50_uat',role:'lr_rc50_app'});
});
test('transaction commits only success, rollbacks failed writes and releases connections',async()=>{
 const p=pool(),repo=new PgUatRepository({pool:p,allowUat:true});
 assert.equal(await repo.tx(async()=>42),42);
 assert.deepEqual(p.queries.map(x=>x.sql),['BEGIN','COMMIT']);
 await assert.rejects(()=>repo.tx(async()=>{throw Error('simulate_error')}),/simulate_error/);
 assert.deepEqual(p.queries.slice(2).map(x=>x.sql),['BEGIN','ROLLBACK']);
 assert.equal(p.released,2);
});
test('account insertion is parameterized and rejects duplicate IDs, unsafe plan/email',async()=>{
 const p=pool({response:()=>({rows:[{account_id:'acc-uat',email:'demo@example.test',plan:'free',status:'active'}]})});
 const repo=new PgUatRepository({pool:p,allowUat:true});
 await repo.createAccount({accountId:'acc-uat',email:'DEMO@example.test'});
 assert.equal(p.queries[0].params[1],'demo@example.test');
 assert(p.queries[0].sql.includes('ON CONFLICT (account_id) DO NOTHING'));
 await assert.rejects(()=>repo.createAccount({accountId:'acc2',email:'bad',plan:'free'}),/invalid_email/);
 await assert.rejects(()=>repo.createAccount({accountId:'acc2',email:'ok@example.test',plan:'root'}),/invalid_plan/);
 const d=new PgUatRepository({pool:pool(),allowUat:true});
 await assert.rejects(()=>d.createAccount({accountId:'acc2',email:'ok@example.test'}),/account_exists/);
});
test('quota charging fails closed without trusted authorization AND budget',async()=>{
 const p=pool(),repo=new PgUatRepository({pool:p,allowUat:true});
 const ev={eventId:'evt1',ownerId:'owner',actorId:'actor',monthKey:'2026-10'};
 await assert.rejects(()=>repo.recordUsage(ev),/usage_authority_callback_required/);
 const noBudget=new PgUatRepository({pool:p,allowUat:true,authorizeUsage:async()=>true});
 await assert.rejects(()=>noBudget.recordUsage(ev),/usage_budget_callback_required/);
 assert.equal(p.queries.length,0);
 const forbidden=new PgUatRepository({pool:p,allowUat:true,authorizeUsage:async()=>false,budgetFor:async()=>50});
 await assert.rejects(()=>forbidden.recordUsage(ev),/usage_authorization_denied/);
 assert(p.queries.some(x=>x.sql==='ROLLBACK'));
 assert(!p.queries.some(x=>x.sql.startsWith('INSERT INTO lr_usage_events')));
});
test('owner/month quota is transactional, duplicate events do not double-charge',async()=>{
 let total=0;
 const events=new Map();
 const p=pool({response:(sql,params)=>{
   if(sql.startsWith('SELECT event_id,owner_account_id')) {
     const found=events.get(params[0])||[...events.values()].find(x=>params[1]&&x.job_id===params[1]);
     return {rows:found?[found]:[]};
   }
   if(sql.startsWith('SELECT tool_calls::text'))return {rows:[{calls:String(total)}]};
   if(sql.startsWith('INSERT INTO lr_usage_events')){
     const [event_id,owner_account_id,actor_account_id,device_id,job_id,month_key,tool_calls]=params;
     if(events.has(event_id))return {rows:[]};
     events.set(event_id,{event_id,owner_account_id,actor_account_id,device_id,job_id,month_key,tool_calls});
     return {rows:[{event_id}]};
   }
   if(sql.startsWith('INSERT INTO lr_usage_monthly')){total+=params[2];return {rows:[]};}
   return {rows:[]};
 }});
 const repo=new PgUatRepository({pool:p,allowUat:true,authorizeUsage:async()=>true,budgetFor:async()=>2});
 const first={eventId:'evt1',ownerId:'owner',actorId:'actor',monthKey:'2026-10',calls:1};
 assert.deepEqual(await repo.recordUsage(first),{recorded:true,duplicate:false});
 assert.deepEqual(await repo.recordUsage(first),{recorded:false,duplicate:true});
 assert.deepEqual(await repo.recordUsage({...first,eventId:'evt2'}),{recorded:true,duplicate:false});
 await assert.rejects(()=>repo.recordUsage({...first,eventId:'evt3'}),/monthly_call_quota_exceeded/);
 await assert.rejects(()=>repo.recordUsage({...first,calls:2}),/usage_idempotency_payload_mismatch/);
 assert.equal(total,2);
 assert.equal(events.size,2);
 assert.equal(p.queries.filter(x=>x.sql.startsWith('INSERT INTO lr_usage_monthly')).length,2);
 assert.equal(p.queries.filter(x=>x.sql.includes('pg_advisory_xact_lock')).length,5);
 assert.equal(p.queries.filter(x=>x.sql==='COMMIT').length,3);
 assert.equal(p.queries.filter(x=>x.sql==='ROLLBACK').length,2);
});
test('Redis adapter has isolated namespace and enforced TTL',async()=>{
 const m=new Map(),call=[];
 const client={get:async k=>m.has(k)?m.get(k):null,set:async(k,v,o)=>{call.push(o);m.set(k,v);return'OK'},del:async k=>Number(m.delete(k))};
 assert.throws(()=>new RedisUatAuxiliary({client}),/redis_uat_mode_required/);
 assert.throws(()=>new RedisUatAuxiliary({client,allowUat:true,prefix:'lr:prod:'}),/invalid_redis_namespace/);
 const cache=new RedisUatAuxiliary({client,allowUat:true});
 await cache.cachePut('device.x',{connected:true},{ttlSeconds:30});
 assert.deepEqual(await cache.cacheGet('device.x'),{connected:true});
 assert.deepEqual(call[0],{EX:30});
 assert([...m.keys()].every(k=>k.startsWith('lr:rc50:uat:cache:')));
 assert.equal(await cache.cacheInvalidate('device.x'),1);
 assert.equal(await cache.cacheGet('device.x'),null);
 await assert.rejects(()=>cache.cachePut('../unsafe',{},{}),/invalid_cache_key/);
 await assert.rejects(()=>cache.cachePut('k',{x:1},{ttlSeconds:7200}),/cache_ttl_invalid/);
});

test('Redis fixed-window rate limiter is atomic and fails closed when unavailable',async()=>{
 let count=0;
 const events=[];
 const client={
   get:async()=>null,set:async()=> 'OK',del:async()=>1,
   eval:async(script,options)=>{
     events.push({script,options});
     assert(script.includes("redis.call('INCR'"));
     assert(script.includes("redis.call('EXPIRE'"));
     assert.deepEqual(options.arguments,['60']);
     return [++count,58];
   }
 };
 const cache=new RedisUatAuxiliary({client,allowUat:true,prefix:'lr:rc50:uat:auth:'});
 assert.deepEqual(await cache.rateHit('oauth-ip-1',{limit:2,windowSeconds:60}),
   {allowed:true,remaining:1,count:1,retryAfterSeconds:0});
 assert.deepEqual(await cache.rateHit('oauth-ip-1',{limit:2,windowSeconds:60}),
   {allowed:true,remaining:0,count:2,retryAfterSeconds:0});
 assert.deepEqual(await cache.rateHit('oauth-ip-1',{limit:2,windowSeconds:60}),
   {allowed:false,remaining:0,count:3,retryAfterSeconds:58});
 assert(events.every(x=>x.options.keys[0]==='lr:rc50:uat:auth:rate:oauth-ip-1'));
 await assert.rejects(()=>cache.rateHit('bad/../../thing'),/invalid_cache_key/);
 await assert.rejects(()=>cache.rateHit('k',{limit:0}),/invalid_rate_limit/);
 const failure=new RedisUatAuxiliary({allowUat:true,client:{
   get:async()=>null,set:async()=>null,del:async()=>0,
   eval:async()=>{throw Error('redis_down')},
 }});
 await assert.rejects(()=>failure.rateHit('ip-1'),/rate_limit_backend_unavailable/);
 const missing=new RedisUatAuxiliary({allowUat:true,client:{get:async()=>null,set:async()=>null,del:async()=>0}});
 await assert.rejects(()=>missing.rateHit('ip-1'),/redis_atomic_eval_required/);
});
