import assert from 'node:assert/strict';
import {GoldJobLedger} from '../../lib/gold-job-ledger.mjs';
const records=new Map();
const pool={async query(sql,args=[]){
 if(sql.startsWith('UPDATE lr_gold_job_records')){
  for(const r of records.values())if(r.status==='running'){r.status='interrupted';r.public_view.status='interrupted'}
  return {rows:[],rowCount:0};
 }
 if(sql.startsWith('INSERT INTO lr_gold_job_records')){
  records.set(args[0],{status:args[6],public_view:JSON.parse(args[10])});
  return {rows:[],rowCount:1};
 }
 if(sql.startsWith('SELECT public_view FROM lr_gold_job_records')){
  const r=records.get(args[0]);return {rows:r?[{public_view:structuredClone(r.public_view)}]:[]};
 }
 throw Error('unrecognized_fake_sql');
}};
const redact=s=>s.replaceAll('SENSITIVE','[REDACTED]');
const db=await GoldJobLedger.open({pool,redact});
const job={id:'00000000-0000-4000-8000-000000000001',requestId:'request-x',
 operationId:'operation-1234567890',accountId:'a',deviceId:'d',sessionId:'s',agentId:'agent',
 nodeId:'n',status:'running',remote:false,startedAt:Date.now(),finishedAt:null,exitCode:null,
 script:'SENSITIVE COMMAND',resultSummary:'',requiredCapabilities:['filesystem'],note:'SENSITIVE'};
db.save(job);await db.flush();
assert.equal((await db.get(job.id)).status,'running');
job.stopRequestedAt=Date.now();
db.save(job);await db.flush();
assert.equal((await db.get(job.id)).stopRequestedAt,job.stopRequestedAt,
  'durable ledger must preserve requested Stop without inventing a terminal receipt');
assert.equal((await db.get(job.id)).effectState,'unknown');
assert.equal(JSON.stringify(await db.get(job.id)).includes('COMMAND'),false);
job.finishedAt=Date.now();job.status='ok';job.exitCode=0;
db.save(job);await db.flush();
assert.equal((await db.get(job.id)).status,'ok');
assert.equal((await db.get(job.id)).note,'[REDACTED]');
job.status='cancelled';job.exitCode=130;job.cancelled=true;
db.save(job);await db.flush();
assert.equal((await db.get(job.id)).status,'cancelled','cancelled must survive durable ledger roundtrip');
assert.equal((await db.get(job.id)).exitCode,130);
console.log('GOLD_PG_JOB_LEDGER_FAKE=PASS');
