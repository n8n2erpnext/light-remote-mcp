import fs from 'node:fs';
import assert from 'node:assert/strict';
import { DeviceAccessGrantRegistry } from '../../operator-host/device-access-grant-registry.mjs';

let now=1_000_000;
const file=`/tmp/lrm-device-access-${process.pid}.json`;
fs.rmSync(file,{force:true});
const registry=new DeviceAccessGrantRegistry({stateFile:file,now:()=>now});
const base={accountId:'acct-test',deviceId:'dev-test',connectionId:'dc-test-1',connectionExpiresAt:now+60_000};
const a=registry.request({...base,agentId:'agent-access-test-aaaaaaaa',label:'ChatGPT A'});
const b=registry.request({...base,agentId:'agent-access-test-bbbbbbbb',label:'ChatGPT B'});
assert.equal(a.state,'pending');
assert.equal(b.state,'pending');
assert.equal(registry.pendingForDevice(base.deviceId).length,2);
const grant=registry.approve(a.request.requestId,{deviceId:base.deviceId,connectionId:base.connectionId,connectionExpiresAt:base.connectionExpiresAt});
assert.ok(grant.grantId.startsWith('dag_'));
assert.equal(registry.pendingForDevice(base.deviceId).length,0);
const bPoll=registry.poll({requestId:b.request.requestId,pollToken:b.pollToken});
assert.equal(bPoll.state,'approved');
assert.equal(bPoll.grant.grantId,grant.grantId);
const c=registry.request({...base,agentId:'agent-access-test-cccccccc',label:'ChatGPT C'});
assert.equal(c.state,'approved');
assert.equal(c.grant.grantId,grant.grantId);
assert.equal(registry.activeForDevice(base.deviceId,base.connectionId).grantId,grant.grantId);

const reloaded=new DeviceAccessGrantRegistry({stateFile:file,now:()=>now});
assert.equal(reloaded.assert(grant.grantId,{deviceId:base.deviceId,connectionId:base.connectionId}).grantId,grant.grantId);
assert.throws(()=>reloaded.assert(grant.grantId,{deviceId:'dev-other'}),/device_access_grant_device_mismatch/);

const closed=reloaded.closeByDevice(base.deviceId,'selftest_disconnect');
assert.equal(closed.length,1);
assert.equal(reloaded.activeForDevice(base.deviceId,base.connectionId),null);
assert.throws(()=>reloaded.assert(grant.grantId),/device_access_grant_required/);

const base2={...base,connectionId:'dc-test-2',connectionExpiresAt:now+120_000};
const next=reloaded.request({...base2,agentId:'agent-access-test-aaaaaaaa',label:'ChatGPT A again'});
assert.equal(next.state,'pending');
assert.notEqual(next.request.requestId,a.request.requestId);
const approved2=reloaded.approve(next.request.requestId,{deviceId:base2.deviceId,connectionId:base2.connectionId,connectionExpiresAt:base2.connectionExpiresAt});
assert.equal(approved2.connectionId,base2.connectionId);
now=base2.connectionExpiresAt+1;
assert.throws(()=>reloaded.assert(approved2.grantId),/device_access_grant_expired/);

const base3={...base,connectionId:'dc-test-3',connectionExpiresAt:now+120_000};
const denied=reloaded.request({...base3,agentId:'agent-access-test-dddddddd',label:'ChatGPT D'});
reloaded.deny(denied.request.requestId,'owner_denied',{deviceId:base3.deviceId});
assert.throws(()=>reloaded.poll({requestId:denied.request.requestId,pollToken:denied.pollToken}),/plus_authorization_denied/);

const idleBase={...base,connectionId:'dc-test-idle',connectionExpiresAt:now+2*60*60*1000};
const idleReq=reloaded.request({...idleBase,agentId:'agent-access-test-idleaaaa',label:'ChatGPT Idle'});
const idleGrant=reloaded.approve(idleReq.request.requestId,{deviceId:idleBase.deviceId,connectionId:idleBase.connectionId,connectionExpiresAt:idleBase.connectionExpiresAt,idleGraceMs:15*60*1000});
assert.equal(idleGrant.idleGraceMs,15*60*1000);
now+=14*60*1000;
assert.equal(reloaded.reap({connectionForDevice:()=>({state:'connected',connectionId:idleBase.connectionId}),liveSessionsForDevice:()=>0}).length,0);
now+=2*60*1000;
const idleClosed=reloaded.reap({connectionForDevice:()=>({state:'connected',connectionId:idleBase.connectionId}),liveSessionsForDevice:()=>0});
assert.equal(idleClosed[0]?.closeReason,'device_access_idle_expired');

const heldBase={...base,connectionId:'dc-test-held',connectionExpiresAt:now+2*60*60*1000};
const heldReq=reloaded.request({...heldBase,agentId:'agent-access-test-heldaaaa',label:'ChatGPT Held'});
const heldGrant=reloaded.approve(heldReq.request.requestId,{deviceId:heldBase.deviceId,connectionId:heldBase.connectionId,connectionExpiresAt:heldBase.connectionExpiresAt,idleGraceMs:15*60*1000});
now+=16*60*1000;
assert.equal(reloaded.reap({connectionForDevice:()=>({state:'connected',connectionId:heldBase.connectionId}),liveSessionsForDevice:()=>1}).length,0);
assert.equal(reloaded.assert(heldGrant.grantId,{touch:false}).grantId,heldGrant.grantId);
reloaded.assert(heldGrant.grantId); // a real tool/authenticated call refreshes grant activity
now+=14*60*1000;
assert.equal(reloaded.reap({connectionForDevice:()=>({state:'connected',connectionId:heldBase.connectionId}),liveSessionsForDevice:()=>0}).length,0);
now+=2*60*1000;
assert.equal(reloaded.reap({connectionForDevice:()=>({state:'connected',connectionId:heldBase.connectionId}),liveSessionsForDevice:()=>0})[0]?.closeReason,'device_access_idle_expired');

const base4={...base,connectionId:'dc-test-4',connectionExpiresAt:now+120_000};
const expiring=reloaded.request({...base4,agentId:'agent-access-test-eeeeeeee',label:'ChatGPT E'});
now=expiring.request.expiresAt+1;
assert.throws(()=>reloaded.poll({requestId:expiring.request.requestId,pollToken:expiring.pollToken}),/plus_authorization_expired/);

fs.rmSync(file,{force:true});
console.log('v09-device-access-grant=PASS');
console.log('v09-device-access-multi-agent-one-approval=PASS');
console.log('v09-device-access-disconnect-expiry=PASS');

// P4.5: an A-code pairing request must require its own B approval even when an underlying grant is already active.
let pairNow=9_000_000;const pairFile=`/tmp/lrm-device-access-pair-${process.pid}.json`;fs.rmSync(pairFile,{force:true});
const pairReg=new DeviceAccessGrantRegistry({stateFile:pairFile,now:()=>pairNow});
const pairBase={accountId:'acct-pair',deviceId:'dev-pair',connectionId:'dc-pair-1',connectionExpiresAt:pairNow+4*60*60*1000};
const firstReq=pairReg.request({...pairBase,agentId:'agent-pairing-first-0001',label:'First client'});
const firstGrant=pairReg.approve(firstReq.request.requestId,{deviceId:pairBase.deviceId,connectionId:pairBase.connectionId,connectionExpiresAt:pairBase.connectionExpiresAt,idleGraceMs:30*60*1000});
const pairReq=pairReg.request({...pairBase,agentId:'agent-pairing-second-0002',label:'Pairing client',forceApproval:true,requestTtlMs:5*60*1000,pairingId:'dpa_pairing_00000001'});
assert.equal(pairReq.state,'pending');assert.ok(pairReq.request.pairingRequired);
assert.equal(pairReg.poll({requestId:pairReq.request.requestId,pollToken:pairReq.pollToken}).state,'pending','active grant must not bypass B approval');
const reused=pairReg.approve(pairReq.request.requestId,{deviceId:pairBase.deviceId,connectionId:pairBase.connectionId,connectionExpiresAt:pairBase.connectionExpiresAt,idleGraceMs:30*60*1000});assert.equal(reused.grantId,firstGrant.grantId);
assert.equal(pairReg.poll({requestId:pairReq.request.requestId,pollToken:pairReq.pollToken}).state,'approved');
fs.rmSync(pairFile,{force:true});
console.log('v09-device-access-pairing-requires-b-approval=PASS');
console.log('v09-device-access-idle-grace=PASS');
