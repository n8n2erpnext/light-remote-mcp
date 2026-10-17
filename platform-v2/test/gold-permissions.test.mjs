import test from 'node:test';
import assert from 'node:assert/strict';
import {goldTableManifest,APP_ENTRY_FUNCTIONS,applyGoldPrivileges} from '../src/storage/gold-permissions.mjs';
const TRIGGERS=['lr_enforce_team_seat_limit','lr_enforce_team_seat_cap_change','lr_guard_free_event_uat'];
const fnNames=[...APP_ENTRY_FUNCTIONS,...TRIGGERS].sort();
function client({role='lr_gold_migrator',database='light_remote_gold_dev',
 appSuperuser=false,member=false,tables=goldTableManifest(),functions=fnNames,
 failSql=null,versions=Array.from({length:16},(_,i)=>i+1)}={}){
 const seen=[];let commits=0,rollbacks=0;
 const query=async(sql,args=[])=>{
  seen.push({sql,args});
  if(failSql&&sql.includes(failSql))throw Error('test_grant_failed');
  if(sql.includes('current_database()'))
   return{rows:[{db:database,role,superuser:false}]};
  if(sql.includes('FROM pg_roles WHERE rolname=$1'))
   return{rows:[{rolname:'lr_gold_app',rolsuper:appSuperuser,
    rolcreatedb:false,rolcreaterole:false,rolreplication:false,
    rolbypassrls:false,rolinherit:true}]};
  if(sql.includes('pg_has_role('))return{rows:[{inherited:member}]};
  if(sql.includes("has_schema_privilege($1,'public','USAGE')"))
   return{rows:[{schema_usage:true,schema_create:false,ledger_read:true,
     ledger_insert:false,ledger_update:false,ledger_delete:false}]};
  if(sql.includes('has_function_privilege($1,$2'))
   return{rows:[{allowed:APP_ENTRY_FUNCTIONS.has(
     args[1].replace(/^public\./,'').split('(')[0])}]};
  if(sql==='SELECT version FROM lr_schema_migrations ORDER BY version')
   return{rows:versions.map(version=>({version}))};
  if(sql.includes('FROM pg_tables WHERE'))
   return{rows:tables.map(tablename=>({tablename}))};
  if(sql.includes('p.oid::regprocedure'))
   return{rows:functions.map(name=>({name,signature:name+'(text)'}))};
  if(sql==='COMMIT'){commits++;return{rows:[]}}
  if(sql==='ROLLBACK'){rollbacks++;return{rows:[]}}
  return{rows:[]};
 };
 return {query,seen,get commits(){return commits},get rollbacks(){return rollbacks}};
}
test('Gold privilege plan is complete, uses only locked SQL tables',()=>{
 const tables=goldTableManifest();assert.equal(tables.length,38);
 assert(tables.includes('lr_schema_migrations'));
 assert.equal(APP_ENTRY_FUNCTIONS.size,11);
});
test('Gold grants DML only on business tables, ledger read-only, no public function calls',async()=>{
 const c=client();const result=await applyGoldPrivileges(c);
 assert.deepEqual(result,{ok:true,grantedTables:37,functions:11,triggerFunctionsNotGranted:3});
 assert.equal(c.commits,1);assert.equal(c.rollbacks,0);
 const all=c.seen.map(x=>x.sql).join('\n');
 assert.match(all,/GRANT SELECT ON TABLE public\.lr_schema_migrations TO lr_gold_app/);
 assert.doesNotMatch(all,/GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE [^\n]*lr_schema_migrations/);
 assert.match(all,/REVOKE ALL ON TABLE public\.lr_schema_migrations FROM lr_gold_app/);
 assert.match(all,/REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
 assert.match(all,/GRANT USAGE ON SCHEMA public TO lr_gold_app/);
 assert.match(all,/GRANT USAGE,SELECT ON SEQUENCE public\.lr_outbox_outbox_id_seq TO lr_gold_app/);
 for(const name of APP_ENTRY_FUNCTIONS)assert.match(all,
  new RegExp('GRANT EXECUTE ON FUNCTION public\\.'+name+'\\(text\\) TO lr_gold_app'));
 for(const name of TRIGGERS){
  assert.match(all,new RegExp('REVOKE EXECUTE ON FUNCTION public\\.'+name+'\\(text\\) FROM PUBLIC'));
  assert.doesNotMatch(all,new RegExp('GRANT EXECUTE ON FUNCTION public\\.'+name));
 }
});
test('Gold refuses inherited migrator access, superuser, wrong DB or unknown schema objects',async()=>{
 for(const options of [{member:true},{appSuperuser:true},{role:'postgres'},
  {database:'old_production'},{tables:goldTableManifest().slice(1)},
  {functions:fnNames.slice(1)},{versions:[1,2,3]}]){
  const c=client(options);
  await assert.rejects(()=>applyGoldPrivileges(c),/gold_permissions_/);
  assert.equal(c.commits,0);
  assert(!c.seen.some(x=>x.sql.includes('GRANT SELECT,INSERT,UPDATE,DELETE')),
   'unsafe DML grant on unverified schema');
 }
});
test('Gold permission transaction rolls back completely on SQL error',async()=>{
 const c=client({failSql:'GRANT USAGE,SELECT ON SEQUENCE'});
 await assert.rejects(()=>applyGoldPrivileges(c),/test_grant_failed/);
 assert.equal(c.commits,0);assert.equal(c.rollbacks,1);
});
