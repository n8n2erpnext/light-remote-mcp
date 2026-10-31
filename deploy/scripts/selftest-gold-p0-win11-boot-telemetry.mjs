import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {sampleWindowsBootEvidence,sanitizeWindowsBootEvidence,nativeWindowsBootFromHost,nativeWindowsBootFromRecoveryFile} from '../../lib/device-boot-telemetry.mjs';
import {GoldDeviceBootObservations} from '../../operator-host/gold-device-boot-observations.mjs';

const now=1793244000000, boot=now-7200000;
const sample=sampleWindowsBootEvidence({platform:'win32',clock:()=>now,
  uptime:()=>7200,agentUptime:()=>180});
assert.equal(sample.bootEstimateMs,boot);
assert.equal(sample.source,'win32_node_os_uptime');
assert.equal(sample.assurance,'estimate_only');
const nativeEnv={
  LIGHT_REMOTE_NATIVE_BOOT_SOURCE:'win32_wmi_lastbootuptime',
  LIGHT_REMOTE_NATIVE_BOOT_AT_MS:String(boot),
  LIGHT_REMOTE_NATIVE_BOOT_OBSERVED_AT_MS:String(now-60000)
};
const nativeSample=sampleWindowsBootEvidence({platform:'win32',clock:()=>now,
  uptime:()=>7200,agentUptime:()=>180,nativeEnv});
assert.equal(nativeSample.nativeBootAtMs,boot);
assert.equal(nativeSample.nativeConsistency,'consistent');
assert.equal(sanitizeWindowsBootEvidence(nativeSample,{now}).nativeBootAtMs,boot);
assert.equal(nativeWindowsBootFromHost({...nativeEnv,LIGHT_REMOTE_NATIVE_BOOT_SOURCE:'powershell'},{sampledAtMs:now}),null);
assert.equal(nativeWindowsBootFromHost({...nativeEnv,LIGHT_REMOTE_NATIVE_BOOT_AT_MS:'1;whoami'},{sampledAtMs:now}),null);
assert.equal(nativeWindowsBootFromHost({...nativeEnv,LIGHT_REMOTE_NATIVE_BOOT_OBSERVED_AT_MS:String(now+50000)},{sampledAtMs:now}),null);

// Physical cold-boot regression: WMI is unavailable at native daemon startup,
// then becomes available later WITHOUT restarting Node or dispatching M4 work.
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'lr-p0-boot-'));
const recoveryDir=path.join(scratch,'GPTOperatorAgent');
fs.mkdirSync(recoveryDir);
const recoveryPath=path.join(recoveryDir,'native-boot-'+crypto.randomBytes(16).toString('hex')+'.json');
const recoveryEnv={LIGHT_REMOTE_NATIVE_BOOT_RECOVERY_PATH:recoveryPath};
const lateSample=()=>sampleWindowsBootEvidence({platform:'win32',clock:()=>now,
  uptime:()=>7200,agentUptime:()=>180,nativeEnv:recoveryEnv});
try{
  assert.equal(lateSample().nativeBootAtMs,undefined,'missing startup WMI must fail open for heartbeat only');
  const storeCache=(value)=>fs.writeFileSync(recoveryPath,JSON.stringify(value));
  storeCache({nativeSource:'win32_wmi_lastbootuptime',nativeBootAtMs:boot,
    nativeObservedAtMs:now-30000});
  assert.equal(nativeWindowsBootFromRecoveryFile(recoveryEnv,{sampledAtMs:now}).nativeBootAtMs,boot);
  assert.equal(lateSample().nativeConsistency,'consistent');
  assert.equal(sanitizeWindowsBootEvidence(lateSample(),{now}).releaseEligible,undefined);
  storeCache({nativeSource:'powershell',nativeBootAtMs:boot,nativeObservedAtMs:now-30000});
  assert.equal(lateSample().nativeBootAtMs,undefined,'must reject source spoofing');
  storeCache({nativeSource:'win32_wmi_lastbootuptime',nativeBootAtMs:boot,
    nativeObservedAtMs:now+40000});
  assert.equal(lateSample().nativeBootAtMs,undefined,'must reject future WMI timestamp');
  fs.writeFileSync(recoveryPath,' '.repeat(600));
  assert.equal(lateSample().nativeBootAtMs,undefined,'oversized cache must be rejected');
  assert.equal(nativeWindowsBootFromRecoveryFile({
    LIGHT_REMOTE_NATIVE_BOOT_RECOVERY_PATH:path.join(scratch,'wrong.json')
  },{sampledAtMs:now}),null,'only trusted per-daemon path pattern may be read');
  fs.unlinkSync(recoveryPath);
  assert.equal(lateSample().nativeBootAtMs,undefined,'no stale native evidence after cache is removed');
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
console.log('BOOT_COLD_START_RECOVERY_WITHOUT_DAEMON_RESTART_OR_M4_PASS');
const diverged=sampleWindowsBootEvidence({platform:'win32',clock:()=>now,
  uptime:()=>7200,agentUptime:()=>180,nativeEnv:{...nativeEnv,LIGHT_REMOTE_NATIVE_BOOT_AT_MS:String(boot+3600000)}});
assert.equal(diverged.nativeConsistency,'divergent');
assert.equal(sanitizeWindowsBootEvidence(diverged,{now}).nativeConsistency,'divergent');
assert.equal(sanitizeWindowsBootEvidence({...nativeSample,nativeConsistency:'verified'},{now}),null);
assert.equal(sanitizeWindowsBootEvidence({...sample,nativeSource:'win32_wmi_lastbootuptime'},{now}),null);

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
    const [accountId,deviceId,sampledAtMs,bootEstimateMs,systemUptimeMs,agentUptimeMs,source,assurance,agentVersion,nativeBootAtMs,nativeObservedAtMs,nativeSource,nativeConsistency]=args;
    const key=accountId+'|'+deviceId,old=rows.get(key);
    if(old&&old.sampled_at_ms>=sampledAtMs)return {rowCount:0,rows:[]};
    rows.set(key,{sampled_at_ms:sampledAtMs,boot_estimate_ms:bootEstimateMs,
      system_uptime_ms:systemUptimeMs,agent_uptime_ms:agentUptimeMs,source,assurance,
      agent_version:agentVersion,received_at:new Date(now),
      native_boot_at_ms:nativeBootAtMs,native_observed_at_ms:nativeObservedAtMs,
      native_source:nativeSource,native_consistency:nativeConsistency});
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
assert.equal(await store.record({accountId:'acct-A',deviceId:'win10',agentVersion:'native-test',value:nativeSample}),true);
const nativeStored=await store.inspect({accountId:'acct-A',deviceId:'win10'});
assert.equal(nativeStored.evidence.nativeBootAtMs,boot);
assert.equal(nativeStored.evidence.nativeConsistency,'consistent');
assert.equal(nativeStored.evidenceClass,'win32_wmi_os_report_not_attestation');
assert.equal(nativeStored.releaseEligible,false);

assert.equal((await store.inspect({accountId:'acct-A',deviceId:'win11'})).releaseEligible,false);
assert.equal((await store.inspect({accountId:'acct-B',deviceId:'win11'})).state,'missing');
assert.equal((await store.inspect({accountId:'acct-A',deviceId:'missing'})).state,'missing');
const restarted=new GoldDeviceBootObservations(pool,{now:()=>now+130000});
assert.equal((await restarted.inspect({accountId:'acct-A',deviceId:'win11'})).state,'stale');
assert.equal((await restarted.inspect({accountId:'acct-A',deviceId:'win11'})).releaseEligible,false);
assert.ok(calls.every(x=>!/(?:DELETE|UPDATE)\s+lr_gold_(?:device_resource_claims|terminal_receipt_acks)/i.test(x)));
console.log('BOOT_STORE_ISOLATION_REPLAY_RESTART_STALE_AND_NO_UNLOCK=PASS');

const nativeHost=fs.readFileSync('client/windows-native/GptOperator.Client/WindowsBootEvidence.cs','utf8');
const scheduler=fs.readFileSync('client/windows-native/GptOperator.Client/AgentHost.cs','utf8');
const tray=fs.readFileSync('client/windows-native/GptOperator.Client/AgentSupervisor.cs','utf8');
assert.match(nativeHost,/RecoveryAttempts = 12/);
assert.match(nativeHost,/Task.Delay\(RetryInterval, cancellationToken\)/);
assert.match(nativeHost,/File.Move\(temporary, path, overwrite: true\)/);
assert.match(scheduler,/Task.Run\(\(\) => WindowsBootEvidence.RecoverAsync/);
assert.match(tray,/Task.Run\(\(\) => WindowsBootEvidence.RecoverAsync/);
assert.doesNotMatch(nativeHost,/Process.Start\(|powershell.exe|wmic.exe|cmd.exe/i);
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
assert.ok(db.migrations.length>=39,'migration 039 must remain present after additive migrations');
const entry=db.migrations.find(x=>x.version===39);
assert.ok(entry,'immutable Windows boot observation migration 039 missing');
const sql=fs.readFileSync('platform-v2/sql/'+entry.file,'utf8');
assert.equal(crypto.createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex'),entry.sha256);
assert.ok(!/DELETE FROM lr_gold_device_resource_claims/i.test(sql));
const storage=fs.readFileSync('lib/gold-db.mjs','utf8');
assert.match(storage,/if\(records\.length>=39\)/);
assert.match(storage,/gold_pg_migration_039_boot_observations_missing/);
assert.match(storage,/if\(records\.length>=40\)/);
assert.match(storage,/if\(records\.length>=41\)/);
assert.match(storage,/if\(records\.length>=42\)/);

console.log('BOOT_AUTHENTICATED_TRANSPORT_PACKAGE_AND_PG39_CONTRACT=PASS');
