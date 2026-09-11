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

const base4={...base,connectionId:'dc-test-4',connectionExpiresAt:now+120_000};
const expiring=reloaded.request({...base4,agentId:'agent-access-test-eeeeeeee',label:'ChatGPT E'});
now=expiring.request.expiresAt+1;
assert.throws(()=>reloaded.poll({requestId:expiring.request.requestId,pollToken:expiring.pollToken}),/plus_authorization_expired/);

fs.rmSync(file,{force:true});
console.log('v09-device-access-grant=PASS');
console.log('v09-device-access-multi-agent-one-approval=PASS');
console.log('v09-device-access-disconnect-expiry=PASS');
