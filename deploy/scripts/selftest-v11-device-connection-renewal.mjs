import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DeviceConnectionRegistry} from '../../operator-host/device-connection-registry.mjs';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';

const HOUR=60*60*1000;
let now=2_000_000;
const events=[];
const connections=new DeviceConnectionRegistry({now:()=>now,emit:e=>events.push(e)});
const access=new DeviceAccessGrantRegistry({now:()=>now,emit:e=>events.push(e)});

const first=connections.connect({accountId:'acct-renew',deviceId:'dev-renew',plan:'pro',requestedLeaseMs:24*HOUR,reconnectGraceMs:30*60*1000});
const originalConnectionId=first.connectionId;
const originalExpiry=first.hardExpiresAt;
const request=access.request({accountId:'acct-renew',deviceId:'dev-renew',connectionId:first.connectionId,connectionExpiresAt:first.hardExpiresAt,agentId:'agent-renew',label:'renew-test',forceApproval:true,requestTtlMs:5*60*1000});
const grant=access.approve(request.request.requestId,{deviceId:'dev-renew',connectionId:first.connectionId,connectionExpiresAt:first.hardExpiresAt,idleGraceMs:30*60*1000});
assert.equal(grant.expiresAt,originalExpiry);

now+=12*HOUR;
const renewed=connections.renew('dev-renew',{accountId:'acct-renew',plan:'pro',requestedLeaseMs:24*HOUR});
assert.equal(renewed.connectionId,originalConnectionId,'renewal must preserve connection identity');
assert.equal(renewed.hardExpiresAt,now+24*HOUR);
assert.ok(renewed.hardExpiresAt>originalExpiry);
assert.equal(access.renewConnection('dev-renew',{connectionId:renewed.connectionId,connectionExpiresAt:renewed.hardExpiresAt}),1);
const renewedGrant=access.assert(grant.grantId,{deviceId:'dev-renew',connectionId:originalConnectionId,touch:false});
assert.equal(renewedGrant.expiresAt,originalExpiry,'grant cannot outlive 24h A/B even if device renews');

now=originalExpiry+1;
assert.equal(connections.assertConnected('dev-renew').connectionId,originalConnectionId,'connection must survive its original hard-expiry after explicit renewal');
assert.throws(()=>access.assert(grant.grantId,{deviceId:'dev-renew',connectionId:originalConnectionId,touch:false}),/device_access_grant_expired/,'24h A/B must expire despite device lease renewal');
assert.ok(events.some(e=>e.type==='device_connection_renewed'));
assert.ok(events.some(e=>e.type==='device_access_renewed'));

const agentSource=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');
const routeSource=fs.readFileSync(new URL('../../operator-host/executor-routes-device-channel.mjs',import.meta.url),'utf8');
assert.match(agentSource,/cloudLeaseRenewalDue/);
assert.match(agentSource,/channelRequest\(state,hub,'renew'/);
// Agent's main loop now renews before duplex-ready short-circuit; commandPulse
// was removed in the original rc.50 source. Preserve this actual guarantee.
const leaseTick=agentSource.indexOf('if(state?.enrollment?.deviceId&&cloudLeaseRenewalDue(state))');
const duplexShortCircuit=agentSource.indexOf('if(deviceDuplexStatus().ready)',leaseTick);
assert(leaseTick>0&&duplexShortCircuit>leaseTick,
  'main loop must renew cloud lease even while duplex is healthy');
assert.match(agentSource,/if\(await maybeRenewCloudLease\(state\)\)/);
assert.match(routeSource,/\/v1\/device-channel\/renew/);
assert.match(routeSource,/accessGrants\.renewConnection/);

console.log('v11-device-connection-renewal=PASS');
