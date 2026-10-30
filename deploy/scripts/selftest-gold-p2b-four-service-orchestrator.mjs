import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {GOLD_P2B_FOUR_UNITS,evaluateGoldP2BRelease,buildGoldP2BTransactionPlan} from '../../lib/gold-p2b-release-gate.mjs';

const path=fileURLToPath(new URL('gold-p2b-four-service-orchestrator.mjs',import.meta.url));
const runtime='/opt/light-remote-gold-uat-candidates/'+'f'.repeat(40);
const clean={
 hostname:'light-remote-gold-uat',
 database:{maxVersion:39,migrationCount:39,activeJobs:0,unknownWork:0,resourceClaims:0},
 units:Object.fromEntries(GOLD_P2B_FOUR_UNITS.map(s=>[s,{active:true,workingDirectory:runtime}])),
 fleet:{signedIdle:true},backup:{freshVerifiedPgDump:true,fourUnitPreimage:true,freshLxdSnapshot:true},
 candidate:{trackedShaVerified:true},redis:{authenticatedTtlReadback:true},
 featureFlags:{verifiedDisabled:true},signedEffects:{provenQuiescent:true},
 devices:{explicitlyAllowlisted:true},
};
const full=evaluateGoldP2BRelease(clean);
assert.equal(full.status,'READINESS_REVIEW_REQUIRED');
assert.equal(full.passed,full.total);
assert.equal(full.liveMutationAuthorized,false);
const hold=(modified,gate)=>{
 const result=evaluateGoldP2BRelease(modified);
 assert.equal(result.status,'HOLD');
 assert.ok(result.blocked.includes(gate),'missing gate '+gate);
 assert.equal(result.liveMutationAuthorized,false);
};
hold({...clean,database:{...clean.database,maxVersion:42}},'gold_schema039_contiguous');
hold({...clean,database:{...clean.database,activeJobs:1}},'gold_no_active_jobs');
hold({...clean,database:{...clean.database,unknownWork:27}},'gold_no_unclassified_unknown_work');
hold({...clean,database:{...clean.database,resourceClaims:1}},'gold_no_unproved_resource_claims');
hold({...clean,units:{...clean.units,[GOLD_P2B_FOUR_UNITS[3]]:{active:false,workingDirectory:runtime}}},'gold_supervisor_aware_inventory');
hold({...clean,units:{...clean.units,[GOLD_P2B_FOUR_UNITS[3]]:{active:true,workingDirectory:runtime.slice(0,-1)+'0'}}},'gold_all_four_services_same_runtime');
hold({...clean,fleet:{signedIdle:false}},'gold_fleet_signed_idle');
hold({...clean,backup:{...clean.backup,freshVerifiedPgDump:false}},'gold_fresh_verified_pg039_dump');
hold({...clean,redis:{authenticatedTtlReadback:false}},'gold_redis_namespace_ttl_proof');
hold({...clean,signedEffects:{provenQuiescent:false}},'gold_signed_effects_fenced');
hold({...clean,devices:{explicitlyAllowlisted:false}},'gold_device_allowlist_signed');
hold({},'gold_schema039_contiguous');
for(const dangerous of ['--apply','--migrate','--rollback']){
 const denied=spawnSync(process.execPath,[path,dangerous],{encoding:'utf8',timeout:8000});
 assert.equal(denied.status,3);
 assert.match(denied.stderr,/P2B_LIVE_CHANGE_UNIMPLEMENTED_SEPARATE_OWNER_APPROVAL_REQUIRED/);
 assert.equal(denied.stdout,'');
}
const invalid=spawnSync(process.execPath,[path,'--sha','ffffffff'],{encoding:'utf8',timeout:8000});
assert.equal(invalid.status,2);
const help=spawnSync(process.execPath,[path,'--help'],{encoding:'utf8',timeout:8000});
assert.equal(help.status,0);
assert.match(help.stdout,/Read-only Gold UAT release gate/);
const plan=buildGoldP2BTransactionPlan();
assert.equal(plan.mode,'SOURCE_ONLY_REVIEW');
assert.deepEqual(plan.fourServices,GOLD_P2B_FOUR_UNITS);
assert.equal(plan.schemaBefore,39);
assert.equal(plan.schemaAfter,42);
assert.equal(plan.advance.length,7);
assert.equal(plan.rollback.length,6);
assert.equal(plan.liveApplyAvailable,false);
assert.ok([...plan.advance,...plan.rollback].every(x=>x.action==='NOT_IMPLEMENTED'));
assert.ok(plan.rollback.some(s=>s.id==='restore_paired_pg039'));
const planResult=spawnSync(process.execPath,[path,'--plan'],{encoding:'utf8',timeout:8000});
assert.equal(planResult.status,4);
assert.equal(JSON.parse(planResult.stdout).transactionBlueprint.liveApplyAvailable,false);
console.log('GOLD_P2B_FOUR_UNIT_SOURCE_GATE_FAIL_CLOSED=PASS');
