import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateRollbackReadiness,rollbackCheckIsClean,parseSystemdProperties} from './gold-abv2-lab-rollback-readiness.mjs';
const propertyFixture='LoadState=loaded\nExecStart={ path=/usr/bin/bash ; argv[]=/usr/bin/bash /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/source-cutover-rollback.sh ; ignore_errors=no }\n';
const parsedPropertyFixture=parseSystemdProperties(propertyFixture);
assert.equal(parsedPropertyFixture.LoadState,'loaded');
assert.match(parsedPropertyFixture.ExecStart,/argv\[\]=\/usr\/bin\/bash .*source-cutover-rollback\.sh/);
assert.throws(()=>parseSystemdProperties('not-an-assignment'),/invalid_systemctl_show_line/);

const cleanCheck='rollback target: isolated Lab only; name length=252\n'+
 'NOT_APPLIED: /etc/systemd/system/light-remote-gold-plugin.service.d/zzzz.conf\n'+
 'NOT_APPLIED: /etc/systemd/system/light-remote-gold-operator.service.d/zzzz.conf\n';
assert.equal(rollbackCheckIsClean(cleanCheck),true);
assert.equal(rollbackCheckIsClean(cleanCheck.replace('NOT_APPLIED: /etc/systemd/system/light-remote-gold-operator','PRESENT: /etc/systemd/system/light-remote-gold-operator')),false);
assert.equal(rollbackCheckIsClean(cleanCheck.split('\n').slice(0,2).join('\n')),false);
assert.equal(rollbackCheckIsClean(cleanCheck+'PRESENT: /etc/systemd/system/light-remote-gold-operator.service.d/extra.conf\n'),false);
assert.equal(rollbackCheckIsClean(cleanCheck.replace('light-remote-gold-operator','light-remote-gold-plugin')),false);

const baseline={
  backupsVerified:true,rollbackCheckPassed:true,
  snapshotCount:3,freshSnapshot:true,
  timerLoaded:true,timerActive:true,timerScheduled:true,
  timerTargetsRollback:true,
  unitsActive:['active','active','active','active'],
  baselineSourcesRestored:true,publicHttpsCode:200,tlsVerifyResult:0,
  diskFreeBytes:22*1024**3,diskUsagePercent:72,
  poolFreeBytes:12*1024**3,poolUsagePercent:70
};
const pass=evaluateRollbackReadiness(baseline);
assert.equal(pass.status,'TECHNICAL_ROLLBACK_READY_APPROVAL_STILL_REQUIRED');
assert.equal(pass.canCutover,false);
assert.equal(pass.releaseApproved,false);
assert.equal(pass.canEnableSso,false);
assert.deepEqual(pass.blockers,[]);
const fail=(changed,blocker)=>{
 const r=evaluateRollbackReadiness({...baseline,...changed});
 assert.equal(r.status,'BLOCKED');
 assert.equal(r.canCutover,false);
 assert(r.blockers.includes(blocker),
  'expected '+blocker+', got '+r.blockers.join(','));
};
fail({backupsVerified:false},'backup_sha256_verification_missing');
fail({rollbackCheckPassed:false},'rollback_check_failed');
fail({snapshotCount:0},'no_lab_snapshot');
fail({freshSnapshot:false},'fresh_pre_cutover_snapshot_required');
fail({timerLoaded:false},'independent_autooff_timer_not_loaded');
fail({timerActive:false},'independent_autooff_timer_not_active');
fail({timerScheduled:false},'independent_autooff_timer_no_future_deadline');
fail({timerTargetsRollback:false},'independent_autooff_wrong_rollback_target');
fail({unitsActive:['active','inactive','active','active']},
  'lab_four_units_not_all_active');
fail({baselineSourcesRestored:false},'baseline_plugin_operator_source_unverified');
fail({publicHttpsCode:502},'public_https_or_tls_health_not_verified');
fail({tlsVerifyResult:60},'public_https_or_tls_health_not_verified');
fail({diskFreeBytes:9*1024**3},'vps_arm_storage_headroom_below_cutover_policy');
fail({diskUsagePercent:88},'vps_arm_storage_headroom_below_cutover_policy');
fail({poolFreeBytes:4*1024**3},'lxd_btrfs_pool_headroom_below_snapshot_policy');
fail({poolUsagePercent:92},'lxd_btrfs_pool_headroom_below_snapshot_policy');
const entry=fileURLToPath(new URL('./gold-abv2-lab-rollback-readiness.mjs',import.meta.url));
for(const argv of [[],['--apply'],['--arm'],['--snapshot'],['--audit','--apply'],
 ['--audit','--authorize']]){
 const r=spawnSync(process.execPath,[entry,...argv],
  {encoding:'utf8',timeout:4000});
 assert.equal(r.status,2);
 assert.match(r.stderr,/LAB_ROLLBACK_READ_ONLY_USAGE/);
}
console.log('GOLD_ABV2_LAB_ROLLBACK_READY_GATE_NEGATIVE_FIXTURES_PASS');
console.log('GOLD_ABV2_LAB_ROLLBACK_GATE_NEVER_AUTHORIZES_SOURCE_CUTOVER_PASS');
