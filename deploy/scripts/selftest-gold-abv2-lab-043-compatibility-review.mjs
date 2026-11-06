import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reviewLab043Compatibility} from './gold-abv2-lab-043-compatibility-review.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const digest=sha('baseline-fixture');
const sql043Sha='935b268899c7b59761781db33d8ad2c573773566844fbfab0b861046f3a680d4';
const row=i=>({version:i+1,file:String(i+1).padStart(3,'0')+'_test.sql',sha256:digest});
const canonical={target:'light_remote_gold_dev - independent Gold only',format:1,
  migrations:Array.from({length:42},(_,i)=>row(i))};
const entry43={version:43,file:'043_gold_device_short_ids.sql',sha256:sql043Sha};
const proposed={...canonical,migrations:[...canonical.migrations,entry43]};
const expectedLocalLock=sha(JSON.stringify(proposed,null,2)+'\n');
const canonicalSqlDigests=Object.fromEntries(canonical.migrations.map(r=>[r.file,r.sha256]));
const stageData={
  oldOperator:{manifest:structuredClone(proposed),lockSha:expectedLocalLock,sql043Sha},
  oldPlugin:{manifest:structuredClone(proposed),lockSha:expectedLocalLock,sql043Sha},
  newStage:{manifest:structuredClone(canonical),lockSha:sha(JSON.stringify(canonical)),
    sql043Sha}
};
const db={
  versions:Array.from({length:43},(_,i)=>i+1),
  applied043Utc:'2026-11-01 15:25:05.798104',
  shortIdTable:true,immutableTrigger:true,
  ownerAuthorityTable:true,ownerHandoffsTable:true,guestAbsent:true
};
const defaults={canonical,canonicalSqlDigests,canonicalCommitted:true,
  stageData,db,sql043Sha,expectedLocalLock};
const ok=reviewLab043Compatibility(defaults);
assert.equal(ok.status,'LAB_ONLY_COMPATIBILITY_PROPOSAL_REPRODUCIBLE');
assert.equal(ok.proposedLabOnlyLockSha256,expectedLocalLock);
assert.deepEqual(ok.blockers,[]);
assert.equal(ok.canCutover,false);
assert.equal(ok.releaseApproved,false);
assert.equal(ok.canApplyMigration,false);
assert.equal(ok.canEnableSso,false);
const reject=(changed,expected)=>{
 const result=reviewLab043Compatibility({...defaults,...changed});
 assert.equal(result.status,'BLOCKED');
 assert.equal(result.canCutover,false);
 assert.equal(result.canApplyMigration,false);
 assert(result.blockers.includes(expected),'missing '+expected+' in '+result.blockers.join(','));
};
reject({canonicalCommitted:false},'canonical_git_lock_not_committed');
reject({sql043Sha:'0'.repeat(64)},'sql043_digest_not_pinned');
reject({expectedLocalLock:'0'.repeat(64)},'proposed_lock_fingerprint_unexpected');
reject({canonicalSqlDigests:{...canonicalSqlDigests,'001_test.sql':'0'.repeat(64)}},
  'canonical_sql_digest_mismatch');
reject({canonical:{...canonical,target:'production'}},'canonical_lock_not_042');
reject({canonical:{...canonical,migrations:canonical.migrations.slice(0,41)}},
  'canonical_lock_not_042');
reject({stageData:{...stageData,oldOperator:{...stageData.oldOperator,
  lockSha:'0'.repeat(64)}}},'oldOperator_pin_not_reproducible');
reject({stageData:{...stageData,oldPlugin:{...stageData.oldPlugin,
  sql043Sha:'0'.repeat(64)}}},'oldPlugin_sql043_digest_mismatch');
reject({stageData:{...stageData,newStage:{...stageData.newStage,
  manifest:structuredClone(proposed)}}},'newStage_lock_shape_invalid');
const forgedStage=structuredClone(stageData);
forgedStage.oldOperator.manifest.migrations[0].sha256='0'.repeat(64);
reject({stageData:forgedStage},'oldOperator_parent_lock_drift');
reject({stageData:{...stageData,oldOperator:null}},'oldOperator_not_inspected');
reject({db:{...db,versions:[1,2,4]}},'actual_lab_ledger_not_001_to_043');
reject({db:{...db,applied043Utc:'2026-11-01 15:25:05.000000'}},
  'lab_043_application_provenance_unexpected');
for(const flag of ['shortIdTable','immutableTrigger','ownerAuthorityTable',
  'ownerHandoffsTable','guestAbsent']){
 reject({db:{...db,[flag]:false}},'lab_'+flag+'_not_verified');
}
const command=fileURLToPath(new URL('./gold-abv2-lab-043-compatibility-review.mjs',import.meta.url));
for(const args of [[],['--apply'],['--approve'],['--write'],['--stage'],
  ['--review','--apply'],['--review','/tmp/fake'],['--review','--owner-approved']]){
 const r=spawnSync(process.execPath,[command,...args],{encoding:'utf8',timeout:5000});
 assert.equal(r.status,2,'unsafe CLI args unexpectedly succeeded: '+args);
 assert.match(r.stderr,/LAB043_REVIEW_READ_ONLY_USAGE/);
}
console.log('GOLD_ABV2_LAB043_REVIEW_REPRODUCIBLE_PIN_AND_EXPERIMENT_SCOPE=PASS');
console.log('GOLD_ABV2_LAB043_REVIEW_DENIES_TAMPERED_SQL_DB_OWNER_GUEST_AND_APPLY=PASS');
