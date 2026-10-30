// Source-only P2-B gate: old G3/M6 cutovers do not qualify for schema042.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const scripts=fileURLToPath(new URL('./',import.meta.url));
const source=(name)=>fs.readFileSync(new URL(name,'file://'+scripts),'utf8');
const g3=source('gold-g3-uat-cutover.sh');
const m6=source('gold-m6-uat-four-service-cutover.sh');
const backup=source('gold-g3-uat-backup.sh');
const rollback=source('gold-g3-uat-rollback.sh');
const stage=source('gold-g3-stage-candidate.sh');
assert.match(g3,/G3_GOLD_LEGACY_THREE_UNIT_CUTOVER_UNSAFE_WITH_SUPERVISOR/);
assert.ok(g3.indexOf('G3_GOLD_LEGACY_THREE_UNIT_CUTOVER_UNSAFE_WITH_SUPERVISOR')<
 g3.indexOf('SERVICES=('),'G3 must block before any 3-unit actions');
assert.match(m6,/'1\|37\|37\|37'/,'historic M6 cannot be promoted to schema042 silently');
assert.match(m6,/leaves\.length!==2/);
assert.match(m6,/GOLD_M6_CUTOVER_OPT_IN/);
for(const service of ['operator','plugin','wall','process-supervisor'])
 assert.ok(m6.includes('light-remote-gold-'+service),'M6 four-unit inventory');
assert.doesNotMatch(backup,/systemd-config\.tgz[^]*?light-remote-gold-process-supervisor\.service/);
assert.match(rollback,/G3_GOLD_ROLLBACK_DID_NOT_RESTORE_DATABASE=no-schema-change/);
assert.match(stage,/G3_GOLD_DEPENDENCY_LOCK_DRIFT/);
console.log('GOLD_P2B_LEGACY_RELEASE_PATHS_FAIL_CLOSED_FOR_SCHEMA042=PASS');
