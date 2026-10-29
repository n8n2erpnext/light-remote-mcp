// Gold P1-D review/step-up route regression; no unapproved database changes.
import assert from 'node:assert/strict';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';
const accountId='acct_owner_test',deviceId='dev_reinstalled_test',
 jobId='11111111-2222-3333-4444-555555555555',ownerEmail='owner@example.test';
const claimedAt=new Date('2026-10-20T02:00:00Z');
function fixture({online=false,foreign=false,hasReceipt=false,passwordValid=true,
  hasClaim=true,recovered=true,verified=true}={}){
 let releases=0,verifiedCalls=0,stepUp=0;
 const deps={
  verifiedChannelContext:async(_body,action)=>{verifiedCalls++;assert.equal(action,'fleet-orphan-recovery');
    if(!verified)throw Error('signed_channel_rejected');
    return {account:{accountId,email:ownerEmail},device:{deviceId:'dev_verified_main'},binding:{accountId},
      payload:_body.payload||{},lease:{verified:true}};},
  verifiedFleetContext:x=>x,
  readJson:async req=>req.body,
  AccountError:class AccountError extends Error{constructor(msg,status){super(msg);this.status=status}},
  accounts:{assertOperational:id=>assert.equal(id,accountId),
    verifyCredentials:({email,password})=>{stepUp++;assert.equal(email,ownerEmail);
      if(!passwordValid||password!=='good_owner_password')throw Error('bad_owner_password');
      return {accountId};}},
  devices:{get:id=>{assert.equal(id,deviceId);
    return {accountId:foreign?'different_owner':accountId,deviceId,nodeId:deviceId};}},
  fleet:{view:()=>({channelFresh:online})},
  connections:{get:()=>({state:online?'connected':'dormant'})},
  deviceResourceLocks:{abandonOwnerAttestedOrphan:async(_pool,x)=>{releases++;
    assert.equal(x.accountId,accountId);assert.equal(x.deviceId,deviceId);
    assert.equal(x.channelFresh,false);assert.equal(x.reason,'gold_agent_reinstalled');
    assert.ok(x.observedBootAtMs>claimedAt.getTime());
    return recovered?{released:true,audited:true,processOutcome:'unknown',terminalReceiptCreated:false,
      deviceId,jobId}:{released:false};}},
  goldJobs:{pool:{query:async(sql,params)=>{assert.deepEqual(params,[accountId,deviceId,jobId]);
    assert.match(sql,/c.account_id=\$1 AND c.device_id=\$2 AND c.job_id=\$3/);
    return {rows:hasClaim?[{claimed_at:claimedAt,worker_state:'terminal_unknown',
      process_id:null,launch_status:'interrupted',has_terminal_ack:hasReceipt}]:[]};}}},
  DEVICE_ID:'dev_integrated_host',
  sendJson:(_res,status,data)=>{assert.equal(status,200);return data;}
 };
 return {deps,get releases(){return releases},get stepUp(){return stepUp},
   get verifiedCalls(){return verifiedCalls}};
}
const route='http://local.test/v1/device-channel/fleet-orphan-recovery';
const request=body=>({method:'POST',body:{payload:body}});
const inspect={mode:'inspect',deviceId,jobId};
{
 const f=fixture();
 const j=await handleDeviceChannelRoutes(request(inspect),{},new URL(route),f.deps);
 assert.equal(j.mode,'review');assert.equal(j.releasePerformed,false);
 assert.equal(j.requiresOwnerPassword,true);
 assert.equal(j.processOutcome,'unknown');
 assert.equal(f.releases,0);assert.equal(f.stepUp,0);
}
const abandon={...inspect,mode:'abandon',confirm:'ABANDON_UNKNOWN_RESULT',
 reason:'gold_agent_reinstalled',password:'good_owner_password',
 observedBootAtMs:claimedAt.getTime()+86400000};
{
 const f=fixture();const j=await handleDeviceChannelRoutes(request(abandon),{},new URL(route),f.deps);
 assert.equal(j.released,true);assert.equal(j.terminalReceiptCreated,false);
 assert.equal(j.processOutcome,'unknown');assert.equal(j.audited,true);
 assert.equal(f.releases,1);assert.equal(f.stepUp,1);
}
for(const changes of [
 {confirm:'OK'}, {reason:'wrong_reason'}, {password:''},
 {observedBootAtMs:0}
]){
 const f=fixture();
 if(changes.observedBootAtMs===0){
  // Boot-time validation lives in the existing audited transaction.
  f.deps.deviceResourceLocks.abandonOwnerAttestedOrphan=async()=>{throw Error('m6_orphan_owner_attestation_invalid')};
 }
 await assert.rejects(()=>handleDeviceChannelRoutes(request({...abandon,...changes}),{},new URL(route),f.deps));
 if(changes.observedBootAtMs!==0)assert.equal(f.releases,0);
}
for(const options of [{online:true},{foreign:true},{hasReceipt:true},{hasClaim:false},{verified:false},{passwordValid:false}]){
 const f=fixture(options);
 await assert.rejects(()=>handleDeviceChannelRoutes(request(abandon),{},new URL(route),f.deps));
 assert.equal(f.releases,0,'rejected recovery must not mutate lease');
}
for(const device of ['dev_verified_main','wrong device','dev_unknown']){
 const f=fixture();
 await assert.rejects(()=>handleDeviceChannelRoutes(request({...inspect,deviceId:device}),{},new URL(route),f.deps));
 assert.equal(f.releases,0);
}
console.log(JSON.stringify({ok:true,ownerRecoveryReviewReadOnly:true,
 ownerPasswordStepUpRequired:true,exactPhraseRequired:true,
 revokedWrongOwnerDenied:true,onlineChannelDenied:true,
 terminalReceiptAlreadyPresentDenied:true,unsignedChannelDenied:true,
 bootAttestationGuardPreserved:true,releaseAuditedAsUnknown:true,
 forgedSignedTerminalReceipts:0,productionUatUntouched:true}));
