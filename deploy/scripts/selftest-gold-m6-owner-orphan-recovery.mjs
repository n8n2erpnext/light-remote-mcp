import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';

const jobId=crypto.randomUUID(),deviceId='dev_orphan_windows',accountId='acct_owner_fixture';
const claimDate='2026-10-22T07:59:43.563Z',boot=Date.parse('2026-10-23T02:22:26Z');
const pid='lp_'+('a'.repeat(26)),locks=new GoldDeviceResourceLocks();
function db({hasClaim=true,hasAck=false,auditFailure=false}={}){
 const log=[],data={audit:null};
 const claim={job_id:jobId,process_id:pid,worker_state:'running',
   claimed_at:new Date(claimDate),launch_status:'ok'};
 const client={
  async query(q,args=[]){
   log.push({query:q.trim().replace(/\s+/g,' '),args});
   if(q.includes('SELECT c.job_id,c.process_id'))return {rows:hasClaim?[claim]:[],rowCount:hasClaim?1:0};
   if(q.includes('SELECT 1 FROM lr_gold_terminal_receipt_acks'))return {rows:hasAck?[{}]:[],rowCount:hasAck?1:0};
   if(q.includes('DELETE FROM lr_gold_device_resource_claims'))return {rowCount:1,rows:[{job_id:jobId}]};
   if(q.includes('INSERT INTO lr_audit_events')){
     if(auditFailure)throw Error('audit_insert_failed');
     data.audit={eventId:args[0],ownerId:args[1],resourceId:args[2],metadata:JSON.parse(args[3])};
     return {rowCount:1};
   }
   return {rows:[],rowCount:0};
  },
  release(){log.push({query:'POOL_RELEASE'})}
 };
 return {pool:{connect:async()=>client},log,data};
}
const input={accountId,deviceId,jobId,observedBootAtMs:boot,
  reason:'gold_agent_uninstalled',channelFresh:false};
{
 const x=db(),result=await locks.abandonOwnerAttestedOrphan(x.pool,input);
 assert.deepEqual({released:result.released,outcome:result.processOutcome,terminalReceiptCreated:result.terminalReceiptCreated},
   {released:true,outcome:'unknown',terminalReceiptCreated:false});
 assert.equal(x.data.audit.ownerId,accountId);
 assert.equal(x.data.audit.resourceId,jobId);
 assert.equal(x.data.audit.metadata.ownerAttestedBootAtMs,boot);
 assert.equal(x.data.audit.metadata.processOutcome,'unknown');
 assert(x.log.some(x=>x.query==='COMMIT'));
 assert(!x.log.some(x=>x.query==='ROLLBACK'));
 assert.equal(x.log.filter(x=>x.query.includes('INSERT INTO lr_gold_terminal_receipt_acks')).length,0);
 const del=x.log.findIndex(x=>x.query.includes('DELETE FROM lr_gold_device_resource_claims'));
 const audit=x.log.findIndex(x=>x.query.includes('INSERT INTO lr_audit_events'));
 const commit=x.log.findIndex(x=>x.query==='COMMIT');
 assert(del>=0&&audit>del&&commit>audit,'audit and release must commit together');
}
for(const changes of [{observedBootAtMs:Date.parse(claimDate)-10}, {channelFresh:true},
  {reason:'admin_unknown'}, {accountId:''}]){
 const x=db();await assert.rejects(()=>locks.abandonOwnerAttestedOrphan(x.pool,{...input,...changes}));
 assert(!x.log.some(z=>z.query.includes('DELETE FROM lr_gold_device_resource_claims')));
}
for(const options of [{hasClaim:false},{hasAck:true},{auditFailure:true}]){
 const x=db(options);
 await assert.rejects(()=>locks.abandonOwnerAttestedOrphan(x.pool,input));
 assert(x.log.some(z=>z.query==='ROLLBACK'));
 assert(!x.log.some(z=>z.query==='COMMIT'));
}
class AccountError extends Error{constructor(message,status=400){super(message);this.status=status}}
const route='/v1/accounts/devices/'+deviceId+'/orphan-claims/'+jobId+'/abandon';
const base={confirm:'ABANDON_UNKNOWN_RESULT',reason:'gold_agent_uninstalled',
  observedBootAtMs:boot,password:'fixture_owner_password'};
const request=body=>({method:'POST',payload:body,headers:{'x-light-account-session':'fixture-session'}});
const makeDeps=({passwordOK=true,ownerMatches=true,online=false,deviceMatches=true}={})=>{
 let calls=0;
 return {
  AccountError,readJson:async req=>req.payload,
  requireAccount:()=>({account:{accountId,email:'owner@fixture.invalid'}}),
  accounts:{verifyCredentials:({email,password})=>{
    assert.equal(email,'owner@fixture.invalid');
    if(!passwordOK||password!=='fixture_owner_password')throw new AccountError('invalid_account_credentials',401);
    return {accountId:ownerMatches?accountId:'acct_other'};
  }},
  devices:{get:()=>({deviceId,nodeId:deviceId,accountId:deviceMatches?accountId:'acct_other'})},
  fleet:{view:()=>({channelFresh:online})},
  connections:{get:()=>({state:'dormant'})},
  DEVICE_ID:'dev_integrated_host',
  abandonOwnerAttestedOrphan:async args=>{calls++;assert.equal(args.accountId,accountId);
    assert.equal(args.jobId,jobId);return {released:true,processOutcome:'unknown',terminalReceiptCreated:false}},
  sendJson:(res,status,data)=>{res.status=status;res.payload=data;return data},
  get calls(){return calls}
 };
};
for(const options of [
 {passwordOK:false},{ownerMatches:false},{online:true},{deviceMatches:false}
]){
 const deps=makeDeps(options),res={};
 await assert.rejects(()=>handleAccountRoutes(request(base),res,new URL('http://op'+route),deps));
 assert.equal(deps.calls,0,'unauthorized owner must never reach destructive transaction');
}
{
 const deps=makeDeps(),res={};
 await assert.rejects(()=>handleAccountRoutes(request({...base,confirm:'YES'}),res,new URL('http://op'+route),deps));
 assert.equal(deps.calls,0);
 const result=await handleAccountRoutes(request(base),res,new URL('http://op'+route),deps);
 assert.equal(res.status,200);assert.equal(deps.calls,1);
 assert.equal(result.terminalReceiptCreated,false);
}
// An owner-removed Gold Device is absent from the active registry, but the
// durable orphan claim is still bound to the original account/device/job.
{
 const deps=makeDeps(),res={};let inspected=0;
 deps.devices={get:()=>{throw new AccountError('device_not_found',404)}};
 deps.inspectOwnerOrphanDevice=async q=>{
   inspected++;assert.deepEqual(q,{accountId,deviceId,jobId});
   return {accountId,deviceId,nodeId:deviceId,state:'revoked',policyProfile:'__gold_removed_v1__'};
 };
 deps.connections={get:()=>{throw new AccountError('device_connection_not_found',404)}};
 const out=await handleAccountRoutes(request(base),res,new URL('http://op'+route),deps);
 assert.equal(out.released,true);assert.equal(inspected,1);assert.equal(deps.calls,1);
 for(const bad of [
   {state:'online',policyProfile:'__gold_removed_v1__',accountId},
   {state:'revoked',policyProfile:'other',accountId},
   {state:'revoked',policyProfile:'__gold_removed_v1__',accountId:'acct_wrong'}
 ]){
   const blocked=makeDeps(),response={};
   blocked.devices=deps.devices;
   blocked.inspectOwnerOrphanDevice=async()=>({...bad,deviceId,nodeId:deviceId});
   blocked.connections=deps.connections;
   await assert.rejects(()=>handleAccountRoutes(request(base),response,new URL('http://op'+route),blocked));
   assert.equal(blocked.calls,0);
 }
 const offline=makeDeps({online:true}),response={};
 offline.devices=deps.devices;offline.inspectOwnerOrphanDevice=deps.inspectOwnerOrphanDevice;
 offline.connections=deps.connections;
 await assert.rejects(()=>handleAccountRoutes(request(base),response,new URL('http://op'+route),offline));
 assert.equal(offline.calls,0);
}
{
 let args;
 const pool={query:async(sql,params)=>{args={sql,params};return {rows:[{accountId,deviceId,state:'revoked',policyProfile:'__gold_removed_v1__',nodeId:deviceId}]}}};
 const observed=await locks.inspectOwnerOrphanDevice(pool,{accountId,deviceId,jobId});
 assert.equal(observed.accountId,accountId);assert.deepEqual(args.params,[accountId,deviceId,jobId]);
 assert.match(args.sql,/JOIN lr_gold_job_records/);
 assert.match(args.sql,/c.account_id=\$1 AND c.device_id=\$2 AND c.job_id=\$3/);
}
console.log('GOLD_M6_OWNER_ORPHAN_RECOVERY_PASS account_auth,device_scope,revoked_historical_lookup,fresh_channel_deny,boot_after_claim,atomic_audit,rollback,no_fake_terminal_ack,unknown_result');
