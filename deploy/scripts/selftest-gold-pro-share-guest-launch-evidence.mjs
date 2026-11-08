import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createGoldGuestDeviceTicketIssuer} from '../../lib/gold-pro-share-guest-device-ticket.mjs';
import {executeGoldGuestDeviceProcess} from '../../device-agent/guest-device-process.mjs';
import {verifyGoldGuestLaunchEvidence} from '../../lib/gold-pro-share-guest-launch-evidence.mjs';
import {GoldJobLedger} from '../../lib/gold-job-ledger.mjs';
const k=crypto.generateKeyPairSync('ed25519'),at=1850000000000;
const job={jobId:'0af5a9c1-8050-478a-83d1-5e26821cf101',
 operationId:'guestop-1111111111111111',
 ownerAccountId:'owner1',actorAccountId:'guest1',
 agentId:'plugin-agent',deviceId:'device1',grantId:'grant1',
 connectionId:'conn1',operation:'process',
 permissionRevision:8,requiredCapabilities:['filesystem'],state:'unknown'};
const slot={jobId:job.jobId,operationId:job.operationId,
 ownerAccountId:job.ownerAccountId,guestAccountId:job.actorAccountId,
 deviceId:job.deviceId,grantId:job.grantId,
 connectionId:job.connectionId,state:'unknown'};
const payload={type:'process-start',script:'printf guest',
 cwd:'/tmp',shell:'bash',timeoutMs:5000};
const commandId='cmd_6f7dd005-9aa6-4c4f-adce-4bc622a04374';
const ticketEnvelope=await createGoldGuestDeviceTicketIssuer({
 env:{LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',
 LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1',
 LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL:'1',
 LR_GOLD_PRO_SHARE_GUEST_TICKET_ISSUE:'1'},
 now:()=>at,sign:bytes=>crypto.sign(null,bytes,k.privateKey),
 assertFreshAuthority:async()=>({verifiedB:true,
  grantPurpose:'pro-share-guest',ownerShareActive:true,
  deviceOwnerAccountId:'owner1',guestAccountId:'guest1',
  agentId:'plugin-agent',grantId:'grant1',connectionId:'conn1',
  permissionRevision:8,devicePolicyRevision:10,
  guestDeviceProtocol:'signed-pro-share-guest-v1',
  approvalExpiresAt:at+40000,connectionExpiresAt:at+40000})
}).issue({job,slot,commandId,payload,devicePolicyRevision:10});
const command={commandId,jobId:job.jobId,payload:{
 type:'guest-process-v1',ticketEnvelope,processIntent:payload}};
const device={enrollment:{accountId:'owner1',deviceId:'device1',
 signer:{publicKey:k.publicKey.export({
  format:'der',type:'spki'}).toString('base64')}},
 cloud:{state:'connected',connectionId:'conn1',
  hardExpiresAt:at+50000},
 policy:{localFinalDenyBoundary:true,serverPolicyRevision:10},
 effectiveCapabilities:['filesystem']};
const spool=new Map(),pid='lp_'+('b'.repeat(26));
const result=await executeGoldGuestDeviceProcess({
 command,state:device,env:{OPERATOR_AGENT_GUEST_PROTOCOL_V1:'1'},
 executionEpochReady:true,readCommand:()=>null,
 writeCommand:(id,row)=>spool.set(id,row),
 launchProcess:async()=>({process:{processId:pid}}),
 inferRequiredCapabilities:()=>['filesystem'],
 hardDeny:()=>null,localDirectoryExists:()=>true,now:()=>at+1000
});
const ownerJob={id:job.jobId,accountId:job.ownerAccountId,
 deviceId:job.deviceId,operationId:job.operationId,
 guestDispatch:{purpose:'pro-share-guest',trustedServerOrigin:true,
  grantId:job.grantId,actorAccountId:job.actorAccountId,
  agentId:job.agentId},guestTicketEnvelope:ticketEnvelope};
const verified=()=>verifyGoldGuestLaunchEvidence({
 authenticatedDeviceChannel:true,command,job:ownerJob,result});
const good=verified();
assert.equal(good.guestAccountId,'guest1');
assert.equal(good.processId,pid);
assert.equal(good.commandId,commandId);
assert.equal(good.payloadSha256,ticketEnvelope.ticket.payloadSha256);
for(const changed of [
 {authenticatedDeviceChannel:false,command,job:ownerJob,result},
 {authenticatedDeviceChannel:true,command,
   job:{...ownerJob,guestDispatch:null},result},
 {authenticatedDeviceChannel:true,command,
   job:{...ownerJob,id:'other-job'},result},
 {authenticatedDeviceChannel:true,command,
   job:{...ownerJob,guestTicketEnvelope:{...ticketEnvelope,
    signature:'WRONG'}},result},
 {authenticatedDeviceChannel:true,command,
   job:ownerJob,result:{...result,data:{...result.data,
    guestLaunch:{...result.data.guestLaunch,guestAccountId:'other-guest'}}}},
 {authenticatedDeviceChannel:true,command,
   job:ownerJob,result:{...result,data:{...result.data,
    guestLaunch:{...result.data.guestLaunch,permissionRevision:9}}}},
 {authenticatedDeviceChannel:true,command,
   job:ownerJob,result:{...result,data:{...result.data,
    guestLaunch:{...result.data.guestLaunch,processId:'lp_'+('x'.repeat(26))}}}},
 {authenticatedDeviceChannel:true,command,
   job:ownerJob,result:{...result,status:'error',exitCode:125}}
])assert.throws(()=>verifyGoldGuestLaunchEvidence(changed),/guest_launch_/);
// Gold ledger may persist a Guest attestation ONLY if the trusted
// Device result handler has positively verified the exact launch evidence.
let committed=null;
const ledger=new GoldJobLedger({
 pool:{query:async(sql,args)=>{committed=JSON.parse(args[10]);return {rows:[],rowCount:1}}},
 redact:x=>x
});
const snapshot={id:job.jobId,requestId:'request1',
 operationId:job.operationId,
 accountId:'owner1',deviceId:'device1',
 sessionId:'gshare_'+job.jobId,agentId:'plugin-agent',
 nodeId:'node1',status:'ok',
 startedAt:at,finishedAt:at+1000,exitCode:0,
 commandId,requiredCapabilities:['filesystem'],
 script:'',note:'',resultSummary:'',
 managedExec:true,signedResultVerified:true,
 signedGuestDelegationVerified:true,guestDelegation:good
};
ledger.save(snapshot);await ledger.flush();
assert.equal(committed.signedResultVerified,true);
assert.equal(committed.signedGuestDelegationVerified,true);
assert.equal(committed.guestDelegation.guestAccountId,'guest1');
assert.equal(committed.guestDelegation.grantId,'grant1');
assert.equal(committed.jobRole,'process_launch');
assert.equal(committed.effectState,'result_observed');
const ownerOnly={...snapshot,signedGuestDelegationVerified:false,
 guestDelegation:null};
ledger.save(ownerOnly);await ledger.flush();
assert.equal(committed.signedGuestDelegationVerified,false);
assert.equal('guestDelegation' in committed,false);
console.log('GOLD_P2I4C3C2_SIGNED_GUEST_LEDGER_PERSISTENCE_FAIL_CLOSED=PASS');
console.log('GOLD_P2I4C3C2_GUEST_DEVICE_SIGNED_LAUNCH_OWNER_M4_CORRELATION=PASS');
console.log('GOLD_P2I4C3C2_OWNER_ONLY_RESULT_CANNOT_CLAIM_GUEST_GRANT=PASS');
