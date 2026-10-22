import assert from 'node:assert/strict';
import vm from 'node:vm';
import {GoldPersonalAgentScheduler} from '../../lib/gold-personal-agent-scheduler.mjs';
import {ownerFleetJobRows} from '../../operator-host/fleet-job-view.mjs';
import {GoldJobLedger} from '../../lib/gold-job-ledger.mjs';
import {fleetJobPage} from '../../device-agent/fleet-job-page.mjs';
const m=new Map();
const create=(id,accountId,deviceId,status,fields={})=>m.set(id,{id,accountId,deviceId,agentId:'signed-agent',sessionId:'s',status,startedAt:1000+Number(id.slice(1)),stdout:{totalBytes:5},stderr:{totalBytes:3},script:'SECRET_TOKEN_DO_NOT_LEAK',resultData:{password:'SECRET'},...fields});
create('j1','owner','device-A','running',{queueReason:'QUEUED_AGENT_SLOT',startedAt:2500});
create('j2','outsider','device-A','running');
create('j3','owner','foreign-device','running');
create('j4','owner','device-A','ok',{managedExec:true,finishedAt:3000,exitCode:0});
const rows=ownerFleetJobRows(m,{accountId:'owner',deviceIds:new Set(['device-A']),limit:30});
assert.deepEqual(rows.map(x=>x.jobId),['j1','j4']);
assert.equal(rows[0].status,'queued');
assert.equal(rows[0].queueReason,'QUEUED_AGENT_SLOT');
assert.equal(rows[1].jobRole,'process_launch');
assert.equal(rows[1].status,'ok');
assert.equal(rows[1].exitCode,0);
assert.equal(JSON.stringify(rows).includes('SECRET'),false);
assert.equal(ownerFleetJobRows(m,{accountId:'owner',deviceIds:new Set(['device-A']),limit:1}).length,1);
assert.throws(()=>ownerFleetJobRows(m,{accountId:'',deviceIds:new Set(['device-A'])}),/fleet_job_owner_scope_required/);
const html=fleetJobPage();
assert.match(html,/Jobs & Queue/);
assert.match(html,/\/api\/jobs/);
assert.ok(!/form method=.post./i.test(html));
let argsSeen=null;
const pool={async query(sql,args){argsSeen=args;assert.match(sql,/account_id=\$1/);assert.match(sql,/device_id=ANY\(\$2::text\[\]\)/);return {rows:[
 {jobId:'pg1',deviceId:'device-A',agentId:'signed-1',sessionId:'sess-1',status:'interrupted',startedAt:new Date(1700000000000),finishedAt:new Date(1700000010000),exitCode:null,jobRole:null,workerClass:null,queueReason:null},
 {jobId:'pg2',deviceId:'device-A',agentId:'signed-2',sessionId:'sess-2',status:'running',startedAt:new Date(1700000015000),finishedAt:null,exitCode:null,jobRole:'process_launch',workerClass:'process',queueReason:'QUEUED_AGENT_SLOT'}
 ]};}};
const ledger=new GoldJobLedger({pool,redact:String});
const history=await ledger.listForOwner({accountId:'owner',deviceIds:['device-A'],limit:15});
assert.deepEqual(argsSeen,['owner',['device-A'],15]);
assert.deepEqual(history.map(x=>x.status),['interrupted','queued']);
assert.equal(history[1].queueReason,'QUEUED_AGENT_SLOT');
assert.equal(history[1].jobRole,'process_launch');
assert.equal(JSON.stringify(history).includes('password'),false);
const signedHtml=fleetJobPage({csrfToken:'csrf_test_value'});
assert.match(signedHtml,/x-light-remote-csrf/);
assert.match(signedHtml,/csrf_test_value/);
const browserJs=signedHtml.split('<script>')[1]?.split('</script>')[0];
assert.ok(browserJs);
new vm.Script(browserJs,{filename:'fleet-job-page.inline.js'});
let rowState='queued',resourceClaim=false,transactionCommitted=false;
const fakePool={async connect(){return{
 async query(sql,args){
  if(sql==='COMMIT'){transactionCommitted=true;return {rowCount:0};}
  if(sql==='BEGIN'||sql==='ROLLBACK'||sql.startsWith('SELECT pg_advisory_xact_lock'))return {rowCount:0};
  if(sql.startsWith('SELECT 1 FROM lr_gold_device_resource_claims'))return {rowCount:resourceClaim?1:0};
  if(sql.includes("UPDATE lr_gold_personal_agent_work SET state='finished'")){
   assert.equal(args[1],'owner');
   if(rowState==='queued'){rowState='finished';return {rowCount:1};}
   return {rowCount:0};
  }
  throw Error('unexpected_pg_query');
 },
 release(){}
 };}};
const cancel=new GoldPersonalAgentScheduler({pool:fakePool,resources:{}});
assert.equal(await cancel.cancelQueued({jobId:'00000000-0000-4000-8000-000000000001',accountId:'owner'}),true);
assert.equal(rowState,'finished');
assert.equal(transactionCommitted,true);
assert.equal(await cancel.cancelQueued({jobId:'00000000-0000-4000-8000-000000000001',accountId:'owner'}),false);
rowState='queued';resourceClaim=true;
await assert.rejects(()=>cancel.cancelQueued({jobId:'00000000-0000-4000-8000-000000000002',accountId:'owner'}),/m6_queued_job_has_resource_claim/);
assert.equal(rowState,'queued');
console.log('M6_OWNER_CANCEL_QUEUED_ONLY=PASS');
console.log('M6_OWNER_CANCEL_RESOURCE_CLAIM_FAIL_CLOSED=PASS');
console.log('M6_OWNER_CANCEL_BROWSER_JS_SYNTAX=PASS');
console.log('M6_PG_DURABLE_OWNER_HISTORY=PASS');
console.log('M6_OWNER_FLEET_JOB_ACCOUNT_SCOPE=PASS');
console.log('M6_OWNER_FLEET_JOB_SAFE_PROJECTION=PASS');
console.log('M6_FLEET_JOBS_READ_ONLY_PAGE=PASS');
