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
test('usage billing fails closed without an explicit trusted authority',async()=>{
 const p=pool(),repo=new PgUatRepository({pool:p,allowUat:true});
 await assert.rejects(()=>repo.recordUsage({eventId:'evt1',ownerId:'owner',actorId:'actor',monthKey:'2026-10'}),/usage_authority_callback_required/);
 assert.equal(p.queries.length,0);
 const forbidden=new PgUatRepository({pool:p,allowUat:true,authorizeUsage:async()=>false});
 await assert.rejects(()=>forbidden.recordUsage({eventId:'evt1',ownerId:'owner',actorId:'actor',monthKey:'2026-10'}),/usage_authorization_denied/);
 assert.equal(p.queries.length,0);
});
test('approved event insertion is idempotent and does not write Redis',async()=>{
 let attempts=0;const p=pool({response:sql=>sql.startsWith('INSERT INTO lr_usage_events')?{rows:++attempts===1?[{event_id:'e1'}]:[]}:{rows:[]}});
 const repo=new PgUatRepository({pool:p,allowUat:true,authorizeUsage:async()=>true});
 const input={eventId:'e1',ownerId:'owner',actorId:'actor',monthKey:'2026-10'};
 assert.deepEqual(await repo.recordUsage(input),{recorded:true,duplicate:false});
 assert.deepEqual(await repo.recordUsage(input),{recorded:false,duplicate:true});
 assert.equal(p.queries.filter(x=>x.sql.startsWith('INSERT INTO lr_usage_monthly')).length,1);
 assert.equal(p.queries.filter(x=>x.sql==='COMMIT').length,2);
 assert.equal(p.queries.filter(x=>x.sql.startsWith('INSERT INTO lr_usage_events')).length,2);
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
