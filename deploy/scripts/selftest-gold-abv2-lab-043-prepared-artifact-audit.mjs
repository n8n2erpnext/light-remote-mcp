import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluatePreparedArtifact} from './gold-abv2-lab-043-prepared-artifact-audit.mjs';

const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const testsha=hash('test');
const sql43='935b268899c7b59761781db33d8ad2c573773566844fbfab0b861046f3a680d4';
const pin='9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609';
const file=i=>String(i).padStart(3,'0')+'_fake.sql';
const canonical={target:'light_remote_gold_dev - independent Gold only',
  migrations:Array.from({length:42},(_,i)=>({version:i+1,file:file(i+1),sha256:testsha}))};
const proposed={...canonical,migrations:[...canonical.migrations,
  {version:43,file:'043_gold_device_short_ids.sql',sha256:sql43}]};
const canonicalDigests=Object.fromEntries(canonical.migrations.map(x=>[x.file,x.sha256]));
const preparedDigests={...canonicalDigests,'043_gold_device_short_ids.sql':sql43};
const review={status:'LAB_ONLY_COMPATIBILITY_PROPOSAL_REPRODUCIBLE',
  actualLabLedger:43,canonicalGitLockedThrough:42,proposedLabOnlyLockSha256:pin,
  sql043Sha256:sql43,releaseApproved:false,canCutover:false,blockers:[]};
const clean={
  canonical,canonicalCommitted:true,canonicalDigests,proposed,
  preparedLockSha:pin,preparedDigests,
  preparedStage:'/opt/light-remote-abv2-lab/source-b8ec5d6f-t04b8-a2-LAB043-COMPAT-PREPARED',
  treeIdenticalExceptLock:true,
  resolvedModules:{plugin_express:true,operator_pg:true},
  importClosure:{checkedFiles:222,staticReferences:18,missingCount:0,
    relativeReferences:309,relativeMissingCount:0,
    computedImportCandidates:1,unexpectedComputedImports:0},
  review,labUnits:['active','active','active','active'],
  pluginStillOldSource:true,operatorStillOldSource:true
};
const ok=evaluatePreparedArtifact(clean);
assert.equal(ok.status,'LAB_ONLY_043_PREPARED_ARTIFACT_COMPATIBLE_NOT_RELEASED');
assert.deepEqual(ok.blockers,[]);
assert.equal(ok.canCutover,false);
assert.equal(ok.releaseApproved,false);
assert.equal(ok.canEnableSso,false);
assert.equal(ok.canApplyMigration,false);
const deny=(patch,blocker)=>{
  const result=evaluatePreparedArtifact({...clean,...patch});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.canCutover,false);
  assert(result.blockers.includes(blocker),result.blockers.join(',')+' missing '+blocker);
};
deny({canonicalCommitted:false},'canonical_git42_not_committed');
deny({canonical:{...canonical,migrations:canonical.migrations.slice(0,41)}},
  'canonical_git42_invalid');
deny({canonicalDigests:{...canonicalDigests,[file(1)]:'0'.repeat(64)}},
  'canonical_sql_digest_mismatch');
deny({preparedStage:'/opt/light-remote-abv2-lab/production'},
  'prepared_lab_only_stage_not_exact');
deny({proposed:{...proposed,migrations:proposed.migrations.slice(0,42)}},
  'prepared_lock43_invalid');
const tampered=structuredClone(proposed);
tampered.migrations[0].sha256='0'.repeat(64);
deny({proposed:tampered},'prepared_parent42_drift');
const tampered43=structuredClone(proposed);
tampered43.migrations[42].sha256='0'.repeat(64);
deny({proposed:tampered43},'prepared_043_not_exact_sql_pin');
deny({preparedLockSha:'0'.repeat(64)},'prepared_lock_sha_not_expected');
deny({preparedDigests:{...preparedDigests,[file(1)]:'0'.repeat(64)}},
  'prepared_sql_digest_mismatch');
deny({treeIdenticalExceptLock:false},'source_copy_differs_outside_lab_lock');
deny({resolvedModules:{plugin_express:true,operator_pg:false}},
  'stage_node_module_resolution_failed');
deny({importClosure:{...clean.importClosure,missingCount:1}},
  'static_external_module_closure_not_proven');
deny({importClosure:{...clean.importClosure,checkedFiles:0,staticReferences:0}},
  'static_external_module_closure_not_proven');
deny({importClosure:{...clean.importClosure,relativeReferences:0}},
  'static_relative_module_closure_not_proven');
deny({importClosure:{...clean.importClosure,relativeMissingCount:1}},
  'static_relative_module_closure_not_proven');
deny({importClosure:{...clean.importClosure,computedImportCandidates:0}},
  'computed_import_inventory_not_pinned');
deny({importClosure:{...clean.importClosure,unexpectedComputedImports:1}},
  'computed_import_inventory_not_pinned');
deny({review:{...review,actualLabLedger:42}},
  'real_lab_043_provenance_review_missing');
deny({review:{...review,releaseApproved:true}},
  'real_lab_043_provenance_review_missing');
deny({labUnits:['active','failed','active','active']},'lab_units_not_all_healthy');
deny({pluginStillOldSource:false},'running_source_changed_during_artifact_review');
deny({operatorStillOldSource:false},'running_source_changed_during_artifact_review');
const bin=fileURLToPath(new URL('./gold-abv2-lab-043-prepared-artifact-audit.mjs',import.meta.url));
for(const args of [[],['--apply'],['--stage'],['--approve'],['--write'],['--audit','--apply']]){
  const r=spawnSync(process.execPath,[bin,...args],{encoding:'utf8',timeout:4000});
  assert.equal(r.status,2);
  assert.match(r.stderr,/LAB043_PREPARED_ARTIFACT_READ_ONLY_USAGE/);
}
console.log('GOLD_ABV2_LAB043_PREPARED_ARTIFACT_PINNED_AND_FAIL_CLOSED_PASS');
console.log('GOLD_ABV2_LAB043_PREPARED_ARTIFACT_NO_CUTOVER_OR_SSO_AUTHORIZATION_PASS');
