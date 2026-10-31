import assert from 'node:assert/strict';
import {GoldAdminJobRecovery} from '../../operator-host/gold-admin-job-recovery.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';
import fs from 'node:fs';
const JOB='db964413-f80f-4869-96aa-fa9b56dded09';
const ADMIN='acct-bootstrap-admin-test',OWNER='acct-customer-test',DEVICE='dev-legacy-gold';
process.env.LIGHT_REMOTE_ADMIN_ACCOUNT_ID=ADMIN;
let migrations=39,calls=[],enabled=false,oneClaim=true;
const pool={
 async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.includes("SELECT\n    (SELECT count(*)"))return {rows:[{
    migrations,version:migrations,fences:migrations>=40,epochs:migrations>=41
  }]};
  if(sql.includes('SELECT c.job_id,c.account_id,c.device_id'))return {rows:oneClaim?[{
    job_id:JOB,account_id:OWNER,device_id:DEVICE,display_name:'TEST-PC',
    device_state:'revoked',worker_state:'running',claimed_at:new Date('2026-10-22T07:59:43Z'),
    job_status:'ok',process_identity_known:true,terminal_ack_present:false,active_connection:false
  }]:[]};
  if(sql.includes('SELECT device_id FROM lr_gold_device_resource_claims'))return {rows:oneClaim?[{device_id:DEVICE}]:[]};
  if(sql.includes('AS resource_claims'))return {rows:[{resource_claims:oneClaim?1:0,unknown_work:0,running_work:0,queued_work:0}]};
  if(sql.includes('lr_gold_device_gc_fences WHERE resolved_at IS NULL'))return {rows:[{n:0}]};
  throw Error('unexpected_gold_admin_recovery_query');
 }
};
const executed=[];
const reaper={async sweepDevice(deviceId,opts){
  executed.push({deviceId,opts}); assert.equal(deviceId,DEVICE);
  assert.deepEqual(opts,{dryRun:false,expectedOnlyJobId:JOB,
    actorAccountId:ADMIN,adminReason:'Operator support review'});
  return {cleaned:true,retiredClaims:1,retiredJobs:1};
}};
const recovery=new GoldAdminJobRecovery({pool,reaper:enabled?reaper:null});
{
 const data=await recovery.list({limit:50});assert.equal(data.canRetire,false);
 assert.equal(data.reason,'gc_worker_not_enabled');
 assert.equal(data.items.length,1);assert.equal(data.items[0].accountId,OWNER);
 assert.equal(data.items[0].terminalAckPresent,false);
 assert.equal(JSON.stringify(data).includes('lp_'),false,'no native PID returned');
 await assert.rejects(()=>recovery.retire({jobId:JOB,confirm:'RETIRE_UNKNOWN_WITH_FENCE',
  reason:'Operator support review',actorAccountId:ADMIN}),/unavailable/);
 assert.equal(executed.length,0);
}
migrations=41;const live=new GoldAdminJobRecovery({pool,reaper});
const status=await live.list({jobId:JOB});assert.equal(status.canRetire,true);
await assert.rejects(()=>live.list({jobId:'not-a-uuid'}),/invalid/);
await assert.rejects(()=>live.retire({jobId:JOB,confirm:'YES',
  reason:'Operator support review',actorAccountId:ADMIN}),/confirmation/);
await assert.rejects(()=>live.retire({jobId:JOB,confirm:'RETIRE_UNKNOWN_WITH_FENCE',
  reason:'short',actorAccountId:ADMIN}),/confirmation/);
assert.equal(executed.length,0);
const good=await live.retire({jobId:JOB,confirm:'RETIRE_UNKNOWN_WITH_FENCE',
 reason:'Operator support review',actorAccountId:ADMIN});
assert.deepEqual(good,{ok:true,retired:true,jobId:JOB,deviceId:DEVICE,
 processOutcome:'unknown',fenced:true,terminalAckCreated:false,audited:true});
assert.equal(executed.length,1);
const deniedGC=new GoldAdminJobRecovery({pool,reaper:{async sweepDevice(){return {cleaned:false,reason:'channel_fresh'}}}});
assert.equal((await deniedGC.retire({jobId:JOB,confirm:'RETIRE_UNKNOWN_WITH_FENCE',
 reason:'Operator support review',actorAccountId:ADMIN})).retired,false);
oneClaim=false;
await assert.rejects(()=>live.retire({jobId:JOB,confirm:'RETIRE_UNKNOWN_WITH_FENCE',
 reason:'Operator support review',actorAccountId:ADMIN}),/not_found/);
oneClaim=true;
class AccountError extends Error{constructor(message,status=400){super(message);this.status=status}}
const deps=(accountId,adminJobRecovery=live)=>{
 let calls=0;
 return {requireAccount:()=>({account:{accountId}}),AccountError,
  adminJobRecovery:{
    list:async q=>{calls++;return adminJobRecovery.list(q)},
    retire:async q=>{calls++;return adminJobRecovery.retire(q)}
  },
  readJson:async(req)=>req.body,
  sendJson:(_res,status,data)=>({status,...data}),
  get calls(){return calls}
 };
};
const request=(method,path,body)=>({method,body,headers:{'x-light-account-session':'fixture'}});
for(const method of ['GET','POST']){
 const path=method==='GET'?'/v1/admin/job-recovery':'/v1/admin/job-recovery/'+JOB+'/retire';
 const d=deps(OWNER);
 await assert.rejects(()=>handleAccountRoutes(request(method,path,{confirm:'RETIRE_UNKNOWN_WITH_FENCE'}),{},new URL('http://operator'+path),d),/admin_account_required/);
 assert.equal(d.calls,0);
}
{
 const d=deps(ADMIN),path='/v1/admin/job-recovery';
 const response=await handleAccountRoutes(request('GET',path,{}),{},new URL('http://operator'+path),d);
 assert.equal(response.status,200);assert.equal(response.items.length,1);
}
{
 const d=deps(ADMIN),path='/v1/admin/job-recovery/'+JOB+'/retire';
 const response=await handleAccountRoutes(request('POST',path,{
  confirm:'RETIRE_UNKNOWN_WITH_FENCE',reason:'Operator support review'
 }),{},new URL('http://operator'+path),d);
 assert.equal(response.status,200);assert.equal(response.retired,true);
}
const plugin=fs.readFileSync(new URL('../../plugin-server/admin-portal.mjs',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../../plugin-server/admin-portal/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../../plugin-server/admin-portal/job-recovery.js',import.meta.url),'utf8');
assert.match(plugin,/requireAdmin\(req,res\)/);
assert.match(plugin,/job-recovery-retire/);
assert.match(plugin,/headers\(admin.token\)/);
assert.match(plugin,/admin_recovery_origin_required/);
assert.match(html,/data-view="job-recovery"/);
assert.match(html,/id="view-job-recovery"/);
assert.match(js,/RETIRE_UNKNOWN_WITH_FENCE/);
assert.match(js,/data-retire-stale-job/);
console.log('GOLD_ADMIN_JOB_RECOVERY_PASS admin_only,operator_rechecks_auth,read_only_pre041,exact_job_select,explicit_confirmation,audited_gc_not_direct_sql,channel_hold,duplicate_claim_denied,ui_wired');
