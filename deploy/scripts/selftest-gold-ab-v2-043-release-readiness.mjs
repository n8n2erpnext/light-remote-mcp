import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {candidate043ManifestReview,evaluateAbv2043UatReadiness} from '../../lib/gold-abv2-043-release-readiness.mjs';
const root=path.resolve(new URL('../../',import.meta.url).pathname);
const real=candidate043ManifestReview({sqlRoot:path.join(root,'platform-v2/sql')});
assert.equal(real.lockedThrough,42);
assert.equal(real.release043Registered,false);
assert.match(real.candidate043Sha256,/^[0-9a-f]{64}$/);
const healthy={migrationCount:39,version:39,shortIdAbsent:true,guestAbsent:true};
const good={manifest:real,db:healthy,services:{everyActive:true},
 backup:{snapshotPresent:true,pgDumpChecksumVerified:true}};
for(const values of [good,{...good,db:{...healthy,version:43}},
 {...good,backup:{snapshotPresent:false,pgDumpChecksumVerified:true}},
 {...good,ownerApproval:{approved:true},realAgentE2E:{signedOwnerWallToHelper24hLease:true}}]){
 const r=evaluateAbv2043UatReadiness(values);
 assert.equal(r.status,'HOLD_NO_UAT_CHANGE');assert.equal(r.canApply,false);
 assert.equal(r.canEnableGuest,false);
 assert(r.reasons.includes('043_not_registered_in_signed_migration_lock'));
}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'abv2-043-preflight-'));
try{
 const realSql=path.join(root,'platform-v2/sql');
 fs.copyFileSync(path.join(realSql,'043_gold_device_short_ids.sql'),path.join(tmp,'043_gold_device_short_ids.sql'));
 for(const n of [40,41,42]){
  const file=({40:'040_gold_connection_job_gc_fences.sql',41:'041_gold_device_execution_epoch.sql',42:'042_gold_wall_announcements_channel.sql'})[n];
  fs.copyFileSync(path.join(realSql,file),path.join(tmp,file));
 }
 const m=JSON.parse(fs.readFileSync(path.join(realSql,'migrations.lock.json')));
 fs.writeFileSync(path.join(tmp,'migrations.lock.json'),JSON.stringify(m));
 assert.deepEqual(candidate043ManifestReview({sqlRoot:tmp}),real);
 fs.appendFileSync(path.join(tmp,'041_gold_device_execution_epoch.sql'),'\n-- forged');
 assert.throws(()=>candidate043ManifestReview({sqlRoot:tmp}),/digest_mismatch/);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
const rejected=spawnSync(process.execPath,[path.join(root,'deploy/scripts/gold-ab-v2-043-release-preflight.mjs'),'--apply'],{encoding:'utf8',timeout:5000});
assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/READ_ONLY_NO_APPLY/);
console.log('GOLD_ABV2_043_LOCKED_PARENT_HASH_RELEASE_FAIL_CLOSED=PASS');
console.log('GOLD_ABV2_043_PREFLIGHT_CAN_NEVER_APPLY_OR_ENABLE_GUEST=PASS');
