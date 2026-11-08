// Never connects to PostgreSQL or mutates the active migration lock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {reviewGoldMigratorReleaseManifest} from '../../lib/gold-043-migrator-release-gate.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'platform-v2/sql/migrations.lock.json'),'utf8'));
assert.equal(manifest.migrations.length,42,'UAT release lock must remain 042');
const legacy=reviewGoldMigratorReleaseManifest(manifest,{env:{}});
assert.deepEqual(legacy,{lockedThrough:42,candidate043Released:false});
const sql43={version:43,file:'043_gold_device_short_ids.sql',sha256:'935b268899c7b59761781db33d8ad2c573773566844fbfab0b861046f3a680d4'};
const hypothetical={...manifest,migrations:[...manifest.migrations,sql43]};
for(const env of [{},{LR_GOLD_ABV2_043_MIGRATOR_ACCEPT:'1'},
 {LR_GOLD_SCHEMA_043_RELEASE_ACCEPT:'1'},
 {LR_GOLD_PRO_SHARE_SCHEMA_044_RELEASE_ACCEPT:'1',LR_GOLD_ABV2_043_MIGRATOR_ACCEPT:'1'}]){
 assert.throws(()=>reviewGoldMigratorReleaseManifest(hypothetical,{env}),
 /gold_migration_043_independent_release_hold/);
}
const permitted={LR_GOLD_ABV2_043_MIGRATOR_ACCEPT:'1',LR_GOLD_SCHEMA_043_RELEASE_ACCEPT:'1'};
assert.deepEqual(reviewGoldMigratorReleaseManifest(hypothetical,{env:permitted}),
 {lockedThrough:43,candidate043Released:true});
assert.throws(()=>reviewGoldMigratorReleaseManifest(
 {...hypothetical,migrations:[...hypothetical.migrations,{version:44,file:'044_gold_pro_share.sql'}]},
 {env:permitted}),/gold_migration_manifest_not_verified/);
assert.throws(()=>reviewGoldMigratorReleaseManifest(
 {...hypothetical,migrations:[...manifest.migrations,{...sql43,file:'044_gold_pro_share.sql'}]},
 {env:permitted}),/gold_migration_043_source_unreviewed/);
assert.throws(()=>reviewGoldMigratorReleaseManifest({...hypothetical,target:'production'},{env:permitted}),
 /gold_migration_manifest_not_verified/);
const runner=fs.readFileSync(path.join(root,'deploy/scripts/apply-gold-db.mjs'),'utf8');
assert.match(runner,/reviewGoldMigratorReleaseManifest\(manifest,\{env:process\.env\}\)/);
assert.match(runner,/row\.version===43/);
assert.match(runner,/gold_migration_043_short_id_contract_missing/);
assert.match(runner,/gold_migration_hash_mismatch_/);
console.log('GOLD_ABV2_043_MIGRATOR_SOURCE_042_COMPAT_043_DOUBLE_HOLD_044_DENY=PASS');
console.log('GOLD_ABV2_043_MANIFEST_STILL_UNREGISTERED_NO_DATABASE_EFFECT=PASS');
