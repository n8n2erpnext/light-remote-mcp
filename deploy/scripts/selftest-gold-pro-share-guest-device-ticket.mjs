import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createGoldGuestDeviceTicketIssuer,verifyGoldGuestDeviceTicket}
 from '../../lib/gold-pro-share-guest-device-ticket.mjs';
const keys=crypto.generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({
 format:'der',type:'spki'}).toString('base64');
const at=1850000000000;
const env={LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',
 LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1',LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL:'1',
 LR_GOLD_PRO_SHARE_GUEST_TICKET_ISSUE:'1'};
const op='guestop-abcde123456789',jid='0af5a9c1-8050-478a-83d1-5e26821cf101';
const job={jobId:jid,operationId:op,ownerAccountId:'owner1',
 actorAccountId:'guest1',agentId:'plugin-agent',
 deviceId:'dev1',grantId:'grant1',connectionId:'conn1',operation:'process',
 permissionRevision:7,requiredCapabilities:['filesystem'],
 state:'unknown'};
const slot={jobId:jid,operationId:op,deviceId:'dev1',
 ownerAccountId:'owner1',guestAccountId:'guest1',
 grantId:'grant1',connectionId:'conn1',state:'unknown'};
const processIntent={type:'process-start',script:'echo probe',cwd:'/tmp',
 shell:'bash',timeoutMs:10000};
const cmd='cmd_2f06a890-629d-41a7-a02c-e585a7d1b3e8';
let revoked=false,allowed=true;
const auth=async()=>revoked?null:{
 verifiedB:true,grantPurpose:'pro-share-guest',ownerShareActive:true,
 deviceOwnerAccountId:'owner1',connectionId:'conn1',grantId:'grant1',
 guestAccountId:'guest1',agentId:'plugin-agent',permissionRevision:7,
 devicePolicyRevision:12,guestDeviceProtocol:'signed-pro-share-guest-v1',
 approvalExpiresAt:at+60000,connectionExpiresAt:at+55000};
const params={sign:async bytes=>crypto.sign(null,bytes,keys.privateKey),
 assertFreshAuthority:auth,env,now:()=>at};
const issuer=createGoldGuestDeviceTicketIssuer(params);
await assert.rejects(createGoldGuestDeviceTicketIssuer({...params,env:{}}).issue({
 job,slot,payload:processIntent,commandId:cmd,devicePolicyRevision:12
}),/guest_ticket_issue_disabled/);
await assert.rejects(issuer.issue({job,slot:{...slot,state:'reserved'},
 payload:processIntent,commandId:cmd,devicePolicyRevision:12}),
 /guest_ticket_durable_unknown_slot_required/);
await assert.rejects(issuer.issue({job,slot:{...slot,grantId:'other'},
 payload:processIntent,commandId:cmd,devicePolicyRevision:12}),
 /guest_ticket_durable_unknown_slot_required/);
revoked=true;
await assert.rejects(issuer.issue({
 job,slot,payload:processIntent,commandId:cmd,devicePolicyRevision:12
}),/guest_ticket_fresh_b_and_share_denied/);
revoked=false;
const signed=await issuer.issue({job,slot,payload:processIntent,
 commandId:cmd,devicePolicyRevision:12});
const state={enrollment:{accountId:'owner1',deviceId:'dev1',
 signer:{publicKey}},cloud:{state:'connected',connectionId:'conn1',
 hardExpiresAt:at+60000},policy:{serverPolicyRevision:12,
 localFinalDenyBoundary:true},effectiveCapabilities:['filesystem']};
const verify=(overrides={})=>verifyGoldGuestDeviceTicket({
 envelope:signed,state,commandId:cmd,payload:processIntent,
 requiredCapabilities:['filesystem'],
 inferRequiredCapabilities:()=>['filesystem'],
 hardDeny:()=>null,now:()=>at+1000,...overrides});
const good=verify();
assert.equal(good.guestAccountId,'guest1');
assert.equal(good.jobId,jid);
assert.equal(good.payloadSha256,signed.ticket.payloadSha256);
for(const change of [
 {state:{...state,enrollment:{...state.enrollment,accountId:'other-owner'}}},
 {state:{...state,cloud:{...state.cloud,connectionId:'conn2'}}},
 {state:{...state,policy:{...state.policy,serverPolicyRevision:11}}},
 {state:{...state,effectiveCapabilities:[]}},
 {state:{...state,policy:{...state.policy,localFinalDenyBoundary:false}}},
 {payload:{...processIntent,script:'echo changed'}},
 {commandId:'cmd_00000000-0000-4000-8000-000000000000'},
 {now:()=>at+18000},
 {hardDeny:()=> 'dangerous_script'},
 {inferRequiredCapabilities:()=>['filesystem','terminal']},
 {envelope:{...signed,ticket:{...signed.ticket,grantId:'other'}}},
 {envelope:{...signed,ticket:{...signed.ticket,guestAccountId:'evil'}}},
 {envelope:{...signed,ticket:{...signed.ticket,permissionRevision:8}}},
 {envelope:{...signed,ticket:{...signed.ticket,payloadSha256:'f'.repeat(64)}}},
 {envelope:{...signed,ticket:{...signed.ticket,extraField:'spoof'}}},
 {envelope:{...signed,signature:'Z'.repeat(86)}}
])assert.throws(()=>verify(change),/guest_ticket_/);
assert.equal(allowed,true);
console.log('GOLD_P2I4C3C2_SIGNED_PINNED_OWNER_B_GUEST_TICKET=PASS');
console.log('GOLD_P2I4C3C2_REVOKE_LOCAL_DENY_REPLAY_SCOPE_WRONG_PAYLOAD=PASS');
