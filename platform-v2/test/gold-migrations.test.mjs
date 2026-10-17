import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {lockedGoldMigrations,runLockedGoldMigrations} from '../src/storage/gold-migrations.mjs';

const migrations=lockedGoldMigrations();
const makeClient=({role='lr_gold_migrator',db='light_remote_gold_dev',superuser=false,existing=[],
 failOn=null}={})=>{
 const ledger=[...existing];let locked=false,unlocks=0;
 const calls=[];
 const query=async(sql,values=[])=>{
   calls.push({sql,values});
   if(sql.includes('current_database()'))return{rows:[{db,role,superuser}]};
   if(sql.includes('pg_advisory_lock(')&&!sql.includes('pg_advisory_unlock')){locked=true;return{rows:[]}};
   if(sql.includes('pg_advisory_unlock(')){locked=false;unlocks++;return{rows:[]}};
   if(sql.includes("to_regclass("))return{rows:[{name:ledger.length?'lr_schema_migrations':null}]};
   if(sql==='SELECT version FROM lr_schema_migrations ORDER BY version')
     return{rows:ledger.map(version=>({version}))};
   if(sql==='SELECT 1 AS found FROM lr_schema_migrations WHERE version=$1')
     return{rows:ledger.includes(values[0])?[{found:1}]:[]};
   const m=migrations.find(x=>x.sql===sql);
   if(m){
     assert(locked,'must hold lock while running SQL DDL');
     if(failOn===m.version)throw Error('simulated_sql_failure');
     ledger.push(m.version);return{rows:[]};
   }
   throw Error('unknown query '+sql.slice(0,70));
 };
 return {query,calls,ledger,get locked(){return locked},get unlocks(){return unlocks}};
};
test('Gold immutable manifest carries byte verified versioned SQL without extra files',()=>{
 assert.equal(migrations.length,16);
 assert.deepEqual(migrations.map(x=>x.version),Array.from({length:16},(_,i)=>i+1));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'gold-migration-hash-'));
 try{
   const original=path.resolve(import.meta.dirname,'../../infra/pgredis/migrations');
   for(const file of fs.readdirSync(original))fs.copyFileSync(path.join(original,file),path.join(temporary,file));
   assert.equal(lockedGoldMigrations({directory:temporary}).length,16);
   fs.appendFileSync(path.join(temporary,'003_auth_device_communications.sql'),'-- corrupt');
   assert.throws(()=>lockedGoldMigrations({directory:temporary}),/gold_migration_source_hash_mismatch_3/);
 }finally{fs.rmSync(temporary,{recursive:true,force:true})}
});
test('Gold migrator applies 16 SQL files in exact order once and replays idempotently',async()=>{
 const client=makeClient();
 const result=await runLockedGoldMigrations(client);
 assert.deepEqual(result,{schemaVersion:16,applied:Array.from({length:16},(_,i)=>i+1),alreadyApplied:0});
 assert.equal(client.unlocks,1);assert.equal(client.locked,false);
 assert.deepEqual(client.ledger,Array.from({length:16},(_,i)=>i+1));
 const second=await runLockedGoldMigrations(client);
 assert.deepEqual(second,{schemaVersion:16,applied:[],alreadyApplied:16});
 assert.equal(client.unlocks,2);assert.equal(client.ledger.length,16);
});
test('Gold migration denies wrong role/db/superuser and unknown ledger',async()=>{
 for(const input of [{role:'postgres'},{role:'lr_gold_app'},{db:'legacy_production'},{superuser:true}]){
   const client=makeClient(input);
   await assert.rejects(()=>runLockedGoldMigrations(client),/gold_migrator_wrong_database_or_role/);
   assert.equal(client.calls.filter(x=>x.sql.includes('pg_advisory_lock(')).length,0);
 }
 const bad=makeClient({existing:[1,3]});
 await assert.rejects(()=>runLockedGoldMigrations(bad),/gold_migration_existing_schema_unknown/);
 assert.equal(bad.unlocks,1);
});
test('Gold migrator releases advisory lock when a migration fails and does not skip it',async()=>{
 const client=makeClient({existing:[1,2,3],failOn:4});
 await assert.rejects(()=>runLockedGoldMigrations(client),/simulated_sql_failure/);
 assert.equal(client.locked,false);assert.equal(client.unlocks,1);
 assert.deepEqual(client.ledger,[1,2,3]);
});
