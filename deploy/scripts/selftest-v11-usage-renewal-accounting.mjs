import fs from 'node:fs';
import assert from 'node:assert/strict';
import {UsageRegistry} from '../../operator-host/usage-registry.mjs';

const base=Date.UTC(2026,9,8,0,0,0);
let now=base;
const file='/tmp/lrm-usage-renewal-'+process.pid+'.json';
fs.rmSync(file,{force:true});
const usage=new UsageRegistry({stateFile:file,now:()=>now});
const connectionId='dc_usage_renew_0001';
const accountId='acct-usage-renew';
const deviceId='dev-usage-renew';
const firstExpiry=base+60*60*1000;

usage.ingest({type:'device_connection_opened',at:new Date(base).toISOString(),accountId,deviceId,connectionId,hardExpiresAt:firstExpiry});
now=base+50*60*1000;
const renewedExpiry=now+60*60*1000;
usage.ingest({type:'device_connection_renewed',at:new Date(now).toISOString(),accountId,deviceId,connectionId,hardExpiresAt:renewedExpiry});

now=firstExpiry+20*60*1000;
let summary=usage.summary(accountId,{months:1});
assert.equal(summary.onlineMsThisMonth,80*60*1000,'usage must continue beyond original expiry after renewal');
assert.ok(usage.openConnections.has(connectionId),'renewed connection must remain tracked');
assert.equal(usage.openConnections.get(connectionId).hardExpiresAt,renewedExpiry);

now=renewedExpiry+10*60*1000;
summary=usage.summary(accountId,{months:1});
assert.equal(summary.onlineMsThisMonth,110*60*1000,'usage must stop at renewed hard expiry');
assert.equal(usage.openConnections.has(connectionId),false,'expired renewed connection should leave open tracking');

const restored=new UsageRegistry({stateFile:file,now:()=>now});
assert.equal(restored.summary(accountId,{months:1}).onlineMsThisMonth,110*60*1000,'renewed usage accounting must persist');
fs.rmSync(file,{force:true});
console.log('v11-usage-renewal-accounting=PASS');
