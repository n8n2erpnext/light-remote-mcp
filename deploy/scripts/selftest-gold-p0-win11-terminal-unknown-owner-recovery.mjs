import assert from 'node:assert/strict';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';

const locks=new GoldDeviceResourceLocks();
const accountId='acct_owner',deviceId='dev_win11';
const jobId='5100f840-0670-49f3-b4c2-8df636d116f6';
const claimedAt=new Date('2026-10-28T13:03:05Z');
const reboot=Date.parse('2026-10-29T02:40:00Z');
function fixture({workerState='terminal_unknown',launchStatus='interrupted',
  processId=null,ack=false,auditFails=false,deleteRows=1}={}){
 const records=[],claim={job_id:jobId,claimed_at:claimedAt,worker_state:workerState,process_id:processId,launch_status:launchStatus};
 const client={
  async query(q,args=[]){
   records.push({q:q.replace(/\s+/g,' ').trim(),args});
   if(q.includes('SELECT c.job_id,c.process_id'))return {rows:[claim],rowCount:1};
   if(q.includes('SELECT 1 FROM lr_gold_terminal_receipt_acks'))return {rows:ack?[{}]:[],rowCount:ack?1:0};
   if(q.includes('DELETE FROM lr_gold_device_resource_claims'))return {rows:deleteRows?[{job_id:jobId}]:[],rowCount:deleteRows};
   if(q.includes('INSERT INTO lr_audit_events')){
     if(auditFails)throw Error('audit_fixture_failure');
     return {rows:[],rowCount:1};
   }
   return {rows:[],rowCount:0};
  },release(){records.push({q:'RELEASE',args:[]});}
 };
 return {pool:{connect:async()=>client},records};
}
const input={accountId,deviceId,jobId,observedBootAtMs:reboot,reason:'gold_agent_reinstalled',channelFresh:false};
{
 const x=fixture();
 const result=await locks.abandonOwnerAttestedOrphan(x.pool,input);
 assert.equal(result.released,true);assert.equal(result.processOutcome,'unknown');
 assert.equal(result.terminalReceiptCreated,false);
 const ack=x.records.find(z=>z.q.includes('SELECT 1 FROM lr_gold_terminal_receipt_acks'));
 assert.deepEqual(ack.args,[accountId,deviceId,jobId,null],'null PID requires job-id ACK check');
 const del=x.records.find(z=>z.q.includes('DELETE FROM lr_gold_device_resource_claims'));
 assert.deepEqual(del.args,[jobId,accountId,deviceId,'terminal_unknown']);
 const audit=x.records.find(z=>z.q.includes('INSERT INTO lr_audit_events'));
 assert.equal(JSON.parse(audit.args[3]).previousWorkerState,'terminal_unknown');
 assert.equal(JSON.parse(audit.args[3]).terminalReceiptCreated,false);
 assert(x.records.findIndex(z=>z.q==='COMMIT')>x.records.indexOf(audit));
}
for(const variant of [
 {workerState:'terminal_unknown',launchStatus:'ok'},
 {workerState:'running',launchStatus:'ok',processId:null},
 {workerState:'terminal_unknown',launchStatus:'interrupted',processId:'lp_'+'z'.repeat(26)},
 {workerState:'completed',launchStatus:'interrupted'},
 {ack:true},{auditFails:true},{deleteRows:0}
]){
 const x=fixture(variant);
 await assert.rejects(()=>locks.abandonOwnerAttestedOrphan(x.pool,input));
 assert(!x.records.some(z=>z.q==='COMMIT'));
}
for(const bad of [{channelFresh:true},{observedBootAtMs:claimedAt.getTime()-1000},
 {reason:'unsupported'},{jobId:'arbitrary'},{accountId:''}]){
 const x=fixture();await assert.rejects(()=>locks.abandonOwnerAttestedOrphan(x.pool,{...input,...bad}));
 assert(!x.records.some(z=>z.q==='COMMIT'));
}
const cli=await import('node:fs').then(x=>x.readFileSync(new URL('./gold-m6-owner-orphan-recovery-cli.mjs',import.meta.url),'utf8'));
assert.match(cli,/claim.workerState==='terminal_unknown'/);
assert.match(cli,/ABANDON_UNKNOWN_RESULT/);
assert.match(cli,/Owner must enter password in an interactive terminal/);
assert(!cli.includes('new pg.Pool'));
console.log('P0_WIN11_TERMINAL_UNKNOWN_OWNER_RECOVERY_OFFLINE_BOOT_EXACT_JOB_AUDITED_UNKNOWN_NO_ACK_PASS');
