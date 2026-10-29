import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {sampleWindowsBootEvidence,sanitizeWindowsBootEvidence} from '../../lib/device-boot-telemetry.mjs';
import {GoldDeviceBootObservations} from '../../operator-host/gold-device-boot-observations.mjs';

const now=1793244000000, boot=now-7200000;
const sample=sampleWindowsBootEvidence({platform:'win32',clock:()=>now,
  uptime:()=>7200,agentUptime:()=>180});
assert.equal(sample.bootEstimateMs,boot);
assert.equal(sample.source,'win32_node_os_uptime');
assert.equal(sample.assurance,'estimate_only');
assert.equal(sampleWindowsBootEvidence({platform:'linux'}),null);
assert.equal(sampleWindowsBootEvidence({platform:'win32',clock:()=>now,uptime:()=>NaN}),null);
assert.equal(sampleWindowsBootEvidence({platform:'win32',clock:()=>now,uptime:()=>30,agentUptime:()=>150}),null);
assert.equal(sanitizeWindowsBootEvidence(sample,{now}).bootEstimateMs,boot);
for(const bad of [
 {...sample,source:'powershell'}, {...sample,assurance:'verified'},
 {...sample,bootEstimateMs:boot+120000}, {...sample,sampledAtMs:now+50000},
 {...sample,sampledAtMs:now-130000}, {...sample,systemUptimeMs:-1},
 {...sample,agentUptimeMs:7206000}, {...sample,bootEstimateMs:now+1000},
 {...sample,version:2}, {}, 'hello', [sample]
])assert.equal(sanitizeWindowsBootEvidence(bad,{now}),null);
console.log('BOOT_COLLECTOR_NON_EXECUTING_SCHEMA_AND_CLOCK_GATES=PASS');

// Mocked pool models SQL update IF strictly newer; tests account isolation,
// restart persistence, and zero claim/terminal mutations by source contract.
const rows=new Map(),calls=[];
const pool={async query(sql,args=[]){
  calls.push(sql);
  if(sql.includes('INSERT INTO lr_gold_device_boot_observations')){
    const [accountId,deviceId,sampledAtMs,bootEstimateMs,systemUptimeMs,agentUptimeMs,source,assurance,agentVersion]=args;
    const key=accountId+'|'+deviceId,old=rows.get(key);
    if(old&&old.sampled_at_ms>=sampledAtMs)return {rowCount:0,rows:[]};
    rows.set(key,{sampled_at_ms:sampledAtMs,boot_estimate_ms:bootEstimateMs,
      system_uptime_ms:systemUptimeMs,agent_uptime_ms:agentUptimeMs,source,assurance,
      agent_version:agentVersion,received_at:new Date(now)});
    return {rowCount:1,rows:[{device_id:deviceId}]};
  }
  if(sql.includes('FROM lr_gold_device_boot_observations')){
    const row=rows.get(args[0]+'|'+args[1]);
    return {rowCount:row?1:0,rows:row?[row]:[]};
  }
  throw Error('UNEXPECTED_QUERY');
}};
const store=new GoldDeviceBootObservations(pool,{now:()=>now});
assert.equal(await store.record({accountId:'acct-A',deviceId:'win11',agentVersion:'0.9.0-rc.50',value:sample}),true);
assert.equal(await store.record({accountId:'acct-A',deviceId:'win11',agentVersion:'0.9.0-rc.50',value:sample}),false);
assert.equal(await store.record({accountId:'acct-A',deviceId:'win11',value:{...sample,source:'external_command'}}),false);
assert.equal((await store.inspect({accountId:'acct-A',deviceId:'win11'})).state,'reported');
assert.equal((await store.inspect({accountId:'acct-A',deviceId:'win11'})).releaseEligible,false);
assert.equal((await store.inspect({accountId:'acct-B',deviceId:'win11'})).state,'missing');
assert.equal((await store.inspect({accountId:'acct-A',deviceId:'missing'})).state,'missing');
const restarted=new GoldDeviceBootObservations(pool,{now:()=>now+130000});
assert.equal((await restarted.inspect({accountId:'acct-A',deviceId:'win11'})).state,'stale');
assert.equal((await restarted.inspect({accountId:'acct-A',deviceId:'win11'})).releaseEligible,false);
assert.ok(calls.every(x=>!/(?:DELETE|UPDATE)\s+lr_gold_(?:device_resource_claims|terminal_receipt_acks)/i.test(x)));
console.log('BOOT_STORE_ISOLATION_REPLAY_RESTART_STALE_AND_NO_UNLOCK=PASS');

const agent=fs.readFileSync('device-agent/operator-agent.mjs','utf8');
const routes=fs.readFileSync('operator-host/executor-routes-device-channel.mjs','utf8');
const account=fs.readFileSync('operator-host/executor-routes-account.mjs','utf8');
const manifest=JSON.parse(fs.readFileSync('client/core-files.json','utf8'));
assert.equal((agent.match(/bootEvidence:sampleWindowsBootEvidence\(\)/g)||[]).length,3);
assert.equal((routes.match(/await persistBoot\(/g)||[]).length,3);
assert.match(routes,/verifiedChannelContext\(body,'pulse'\)/);
assert.match(routes,/verifiedChannelContext\(body,'poll'\)/);
assert.match(routes,/authorizeHello:async body=>/);
assert.match(routes,/ctx\.binding\.accountId,deviceId:ctx\.device\.deviceId/);
assert.match(account,/boot-evidence/);
assert.match(account,/device\.accountId!==identity\.account\.accountId/);
assert.ok(manifest.files.some(x=>x.source==='lib/device-boot-telemetry.mjs'));
const db=JSON.parse(fs.readFileSync('platform-v2/sql/migrations.lock.json','utf8'));
assert.equal(db.migrations.length,39);
const entry=db.migrations.at(-1);
assert.equal(entry.version,39);
const sql=fs.readFileSync('platform-v2/sql/'+entry.file,'utf8');
assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),entry.sha256);
assert.ok(!/DELETE FROM lr_gold_device_resource_claims/i.test(sql));
console.log('BOOT_AUTHENTICATED_TRANSPORT_PACKAGE_AND_PG39_CONTRACT=PASS');
