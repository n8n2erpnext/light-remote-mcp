import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createGoldGuestDeviceTicketIssuer}
 from '../../lib/gold-pro-share-guest-device-ticket.mjs';
import {executeGoldGuestDeviceProcess} from '../../device-agent/guest-device-process.mjs';
const keys=crypto.generateKeyPairSync('ed25519'),at=1850000000000;
const jid='0af5a9c1-8050-478a-83d1-5e26821cf101',op='guestop-abcde123456789',
 commandId='cmd_2f06a890-629d-41a7-a02c-e585a7d1b3e8';
const job={jobId:jid,operationId:op,ownerAccountId:'owner1',
 actorAccountId:'guest1',agentId:'plugin-agent',deviceId:'dev1',
 grantId:'grant1',connectionId:'conn1',operation:'process',
 permissionRevision:7,requiredCapabilities:['filesystem'],state:'unknown'};
const slot={state:'unknown',jobId:jid,operationId:op,
 deviceId:'dev1',ownerAccountId:'owner1',guestAccountId:'guest1',
 grantId:'grant1',connectionId:'conn1'};
const processIntent={type:'process-start',script:'echo probe',
 cwd:'/tmp',shell:'bash',timeoutMs:10000};
const env={LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1',
 LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL:'1',
 LR_GOLD_PRO_SHARE_GUEST_TICKET_ISSUE:'1'};
const issuer=createGoldGuestDeviceTicketIssuer({
 env,now:()=>at,
 sign:async bytes=>crypto.sign(null,bytes,keys.privateKey),
 assertFreshAuthority:async()=>({
  verifiedB:true,grantPurpose:'pro-share-guest',ownerShareActive:true,
  deviceOwnerAccountId:'owner1',guestAccountId:'guest1',
  agentId:'plugin-agent',grantId:'grant1',connectionId:'conn1',
  permissionRevision:7,devicePolicyRevision:12,
  guestDeviceProtocol:'signed-pro-share-guest-v1',
  approvalExpiresAt:at+50000,connectionExpiresAt:at+50000})
});
const ticketEnvelope=await issuer.issue({job,slot,commandId,
 payload:processIntent,devicePolicyRevision:12});
const state={enrollment:{accountId:'owner1',deviceId:'dev1',signer:{
 publicKey:keys.publicKey.export({format:'der',type:'spki'}).toString('base64')
}},cloud:{state:'connected',connectionId:'conn1',hardExpiresAt:at+40000},
 policy:{serverPolicyRevision:12,localFinalDenyBoundary:true},
 effectiveCapabilities:['filesystem']};
const command={commandId,payload:{
 type:'guest-process-v1',ticketEnvelope,processIntent}};
const spool=new Map();let launches=0,writes=0,failedWrite=false,clock=at+1000;
const deps={command,state,env:{OPERATOR_AGENT_GUEST_PROTOCOL_V1:'1'},
 executionEpochReady:true,
 readCommand:id=>spool.get(id)||null,
 writeCommand:(id,row)=>{writes++;if(failedWrite)throw Error('disk-write-failed');spool.set(id,row)},
 launchProcess:async validated=>{
  launches++;
  assert.equal(validated.guestAccountId,'guest1');
  assert.equal(validated.ownerAccountId,'owner1');
  assert.equal(validated.sessionId,'gshare_'+jid);
  assert.equal(spool.get(commandId).state,'running','must persist before spawn');
  return {process:{processId:'lp_'+('a'.repeat(25))}};
 },
 inferRequiredCapabilities:()=>['filesystem'],
 hardDeny:()=>null,localDirectoryExists:()=>true,
 now:()=>clock};
await assert.rejects(executeGoldGuestDeviceProcess({...deps,
 env:{}}),/guest_agent_protocol_and_epoch_required/);
await assert.rejects(executeGoldGuestDeviceProcess({...deps,
 executionEpochReady:false}),/guest_agent_protocol_and_epoch_required/);
await assert.rejects(executeGoldGuestDeviceProcess({...deps,
 command:{...command,payload:{...command.payload,sessionId:'owner-session'}}}),
 /guest_agent_payload_shape_denied/);
await assert.rejects(executeGoldGuestDeviceProcess({...deps,
 state:{...state,effectiveCapabilities:[]}}),
 /guest_ticket_local_capability_denied/);
await assert.rejects(executeGoldGuestDeviceProcess({...deps,
 hardDeny:()=> 'local-deny'}),/guest_ticket_platform_hard_deny/);
await assert.rejects(executeGoldGuestDeviceProcess({...deps,
 command:{...command,payload:{...command.payload,processIntent:{
 ...processIntent,script:'tricked'
 }}}}),/guest_ticket_payload_digest_mismatch/);
await assert.rejects(executeGoldGuestDeviceProcess({...deps,
 localDirectoryExists:()=>false}),/guest_agent_cwd_local_denied/);
assert.equal(launches,0);
failedWrite=true;
await assert.rejects(executeGoldGuestDeviceProcess(deps),/disk-write-failed/);
assert.equal(launches,0);
failedWrite=false;
const result=await executeGoldGuestDeviceProcess(deps);
assert.equal(result.status,'ok');
assert.equal(result.data.guestLaunch.guestAccountId,'guest1');
assert.equal(result.data.guestLaunch.jobId,jid);
assert.equal(result.data.guestLaunch.processId,'lp_'+('a'.repeat(25)));
assert.equal(result.data.guestLaunch.grantId,'grant1');
assert.equal(result.data.guestLaunch.permissionRevision,7);
assert.equal(spool.get(commandId).state,'finished');
assert.equal(launches,1);
const idem=await executeGoldGuestDeviceProcess(deps);
assert.deepEqual(idem,result);
assert.equal(launches,1,'durable command replay may not respawn');
spool.delete(commandId);
spool.set(commandId,{state:'running',startedAt:at});
const unk=await executeGoldGuestDeviceProcess(deps);
assert.equal(unk.data.unknown,true);
assert.equal(launches,1,'UNKNOWN never retried');
assert.equal(spool.get(commandId).state,'finished');
console.log('GOLD_P2I4C3C2_DEVICE_LOCAL_SIGNED_B_POLICY_BEFORE_SPAWN=PASS');
console.log('GOLD_P2I4C3C2_DURABLE_SPOOL_RESTART_UNKNOWN_NO_REEXEC=PASS');
console.log('GOLD_P2I4C3C2_LEGACY_OWNER_SESSION_NOT_GUEST_FALLBACK=PASS');
