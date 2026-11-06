import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {evaluateLabCutoverPreflight} from './gold-abv2-lab-cutover-preflight.mjs';

const digest=crypto.createHash('sha256').update('a-fixture').digest('hex');
const lock=(n)=>({migrations:Array.from({length:n},(_,i)=>({
  version:i+1,file:String(i+1).padStart(3,'0')+'_fixture.sql',sha256:digest
}))});
const ver=(n)=>Array.from({length:n},(_,i)=>i+1);
const digests=Object.fromEntries(lock(43).migrations.map(r=>[r.file,digest]));
const modules={plugin_express:true,operator_pg:true};
const defaults={
  versions:ver(43),canonicalLock:lock(43),stagedLock:lock(43),
  stagedDigests:digests,canonicalDigests:digests,modules,
  shortIdTable:true,immutableTrigger:true,ownerAuthorityTable:true,
  ownerHandoffsTable:true,guestTableAbsent:true,canonicalCommitted:true
};
const check=(attrs,expected)=>{
  const r=evaluateLabCutoverPreflight({...defaults,...attrs});
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.canCutover,false);
  assert(r.blockers.includes(expected),'expected blocker '+expected+': '+r.blockers);
};
const compatible=evaluateLabCutoverPreflight(defaults);
assert.equal(compatible.status,'COMPATIBLE_ONLY_RELEASE_APPROVAL_NOT_VERIFIED');
assert.equal(compatible.canCutover,false,'preflight must NOT authorize cutover');
assert.equal(compatible.databaseVersion,43);
check({canonicalLock:lock(42),stagedLock:lock(42)},
  'database_version_vs_staged_lock_mismatch');
check({canonicalLock:lock(42)},'staged_lock_differs_from_canonical');
check({stagedLock:lock(42)},'staged_lock_differs_from_canonical');
check({versions:[1,2,4]},'database_ledger_not_contiguous');
check({shortIdTable:false},'schema043_table_or_trigger_missing');
check({immutableTrigger:false},'schema043_table_or_trigger_missing');
check({ownerAuthorityTable:false},'lab_only_owner045_tables_missing');
check({ownerHandoffsTable:false},'lab_only_owner045_tables_missing');
check({guestTableAbsent:false},'lab_guest044_schema_present');
check({canonicalDigests:{...digests,'043_fixture.sql':'0'.repeat(64)}},
  'canonical_sql_digest_missing_or_mismatched');
check({canonicalCommitted:false},'canonical_lock_not_committed');
check({modules:{plugin_express:false,operator_pg:true}},'plugin_express_unresolved');
check({modules:{plugin_express:true,operator_pg:false}},'operator_pg_unresolved');
check({stagedDigests:{...digests,'043_fixture.sql':'0'.repeat(64)}},
  'staged_sql_digest_missing_or_mismatched');
check({versions:ver(44),canonicalLock:lock(44),stagedLock:lock(44),
  stagedDigests:{...digests,'044_fixture.sql':digest}},'schema044_guest_runtime_hold');
for(const args of [[],['--apply'],['--preflight'],
  ['--preflight','--source','/opt/light-remote-abv2-lab/../../etc'],
  ['--preflight','--source','/tmp/different-device'],
  ['--preflight','--source','/opt/light-remote-abv2-lab/source-fixture','--apply']]){
  const r=spawnSync(process.execPath,[fileURLToPath(new URL('./gold-abv2-lab-cutover-preflight.mjs',import.meta.url)),...args],
    {encoding:'utf8',timeout:4000});
  assert.equal(r.status,2);
  assert.match(r.stderr,/LAB_PREFLIGHT_READ_ONLY_USAGE/);
}
console.log('GOLD_ABV2_LAB_PREFLIGHT_BLOCKS_SCHEMA_LOCK_DRIFT_DEP_MISMATCH_GUEST044=PASS');
console.log('GOLD_ABV2_LAB_PREFLIGHT_HAS_NO_APPLY_AND_NEVER_GRANTS_CUTOVER=PASS');
