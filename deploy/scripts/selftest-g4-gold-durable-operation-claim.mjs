import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GoldJobLedger,GoldOperationEffectError} from '../../lib/gold-job-ledger.mjs';
const records=new Map();let insertCount=0,transactionDepth=0;
const fakeClient={
 async query(sql,params=[]){
  const q=String(sql).trim();
  if(q==='BEGIN'){transactionDepth++;return {rows:[]}}
  if(q==='COMMIT'){transactionDepth--;return {rows:[]}}
  if(q==='ROLLBACK'){transactionDepth--;return {rows:[]}}
  if(q.startsWith('SELECT pg_advisory_xact_lock')){assert.equal(transactionDepth,1);return {rows:[{}]}}
  if(q.startsWith('SELECT job_id,public_view FROM lr_gold_job_records')){
   const k=params.join(':');const v=records.get(k);return {rows:v?[{job_id:v.jobId,public_view:v.view}]:[]};
  }
  if(q.startsWith('INSERT INTO lr_gold_job_records')){
   const k=[params[1],params[2],params[5]].join(':');
   assert.equal(transactionDepth,1);
   assert.equal(records.has(k),false);
   const view=JSON.parse(params[7]);records.set(k,{jobId:params[0],view});insertCount++;
   return {rowCount:1,rows:[]};
  }
  throw Error('unexpected_sql:'+q.slice(0,80));
 },
 release(){}
};
const pool={query:async()=>({rows:[]}),connect:async()=>fakeClient};
const ledger=new GoldJobLedger({pool,redact:v=>v});
const job={id:'job-G4-first',operationId:'g4-durable-unique-0001',operationFingerprint:'f'.repeat(64),
 accountId:'g4-account',deviceId:'g4-device',sessionId:'g4-session',agentId:'g4-agent',nodeId:'g4-node',
 status:'running',remote:true,startedAt:Date.now(),finishedAt:null,requiredCapabilities:['filesystem']};
assert.equal(await ledger.reserve(job),null);
assert.equal(insertCount,1);assert.equal(records.size,1);
const raw=[...records.values()][0].view;
assert.equal(raw.effectState,'unknown');assert.equal(raw.operationFingerprint,job.operationFingerprint);
assert.equal(raw.script,undefined);
console.log('G4_GOLD_PG_RESERVE_BEFORE_ANY_EFFECT=PASS');

const resumed=new GoldJobLedger({pool,redact:v=>v});
const replay=await resumed.reserve({...job,id:'job-G4-second'});
assert.equal(replay.jobId,job.id);assert.equal(replay.operationFingerprint,job.operationFingerprint);
assert.equal(insertCount,1);
console.log('G4_GOLD_PG_RESTART_SAME_OPERATION_NO_REINSERT=PASS');
assert.equal(new GoldOperationEffectError('operation_effect_unknown',replay.jobId).status,409);
assert.equal(transactionDepth,0);
const nextDevice={...job,id:'job-G4-other-device',deviceId:'g4-other-device'};
assert.equal(await resumed.reserve(nextDevice),null);
assert.equal(insertCount,2,'different owned device must not share a claim');
console.log('G4_GOLD_OPERATION_CLAIMS_SCOPED_TO_ACCOUNT_AND_DEVICE=PASS');
const failed=new GoldJobLedger({pool:{query:async()=>({rows:[]}),connect:async()=>({
 query:async(sql)=>{if(sql==='BEGIN')return {rows:[]};throw Error('gold_pg_unavailable');},
 release(){},
})},redact:v=>v});
await assert.rejects(()=>failed.reserve({...job,id:'job-G4-retry'}),/gold_pg_unavailable/);
console.log('G4_GOLD_PG_CLAIM_UNAVAILABLE_FAILS_CLOSED=PASS');

const executor=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
const routes=fs.readFileSync(new URL('../../operator-host/executor-routes-runtime.mjs',import.meta.url),'utf8');
assert.equal((executor.match(/const historical=await reserveGoldJob\(job\)/g)||[]).length,7);
assert.ok(executor.includes("throw new GoldOperationEffectError('operation_effect_unknown',prior.jobId)"));
assert.ok(executor.includes("throw new GoldOperationEffectError('operation_id_conflict',prior.jobId)"));
assert.ok(routes.includes('await startJob(payload, requestId)'));
console.log('G4_EXEC_FS_PROCESS_TERMINAL_SEARCH_SCP_DESKTOP_REPLAY_GUARD=PASS');
