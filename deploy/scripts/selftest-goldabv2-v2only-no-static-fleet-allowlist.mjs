import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {goldAbV2LabV1Disabled} from '../../lib/gold-ab-v2-lab-v1-lock.mjs';
const src=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const modules=[
 'operator-host/gold-ab-v2-owner-http.mjs',
 'operator-host/gold-ab-v2-helper-target.mjs',
 'operator-host/gold-ab-v2-helper-poll.mjs',
 'operator-host/gold-ab-v2-grant-operator.mjs',
 'operator-host/gold-ab-v2-signed-preview.mjs',
 'operator-host/gold-ab-v2-signed-approval.mjs',
 'operator-host/pro-share-guest-helper.mjs',
 'operator-host/pro-share-guest-poll.mjs',
 'operator-host/pro-share-guest-approval.mjs',
 'operator-host/pro-share-guest-queue-http.mjs'
];
for(const path of modules){
 const code=src(path);
 assert.doesNotMatch(code,/allowedAccounts\.has|allowedDevices\.has|LR_GOLD_AB_V2_OWNER_ALLOWED_(ACCOUNTS|DEVICES)/,
  path+' may not restrict verified Owner devices with static fleet allowlist');
}
assert.doesNotMatch(src('operator-host/executor.mjs'),
 /LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS/);
const policy=src('operator-host/gold-ab-v2-owner-http.mjs');
assert.match(policy,/verifyEnrolledConnection/);
assert.match(policy,/authorizeOwnerAction/);
assert.match(policy,/accounts\.assertOperational/);
assert.match(policy,/csrf\.verify/);
assert.match(src('operator-host/gold-ab-v2-helper-target.mjs'),/devices\.get/);
assert.match(src('operator-host/gold-ab-v2-helper-target.mjs'),/binding\.accountId!==p\.accountId/);
assert.match(src('operator-host/gold-ab-v2-helper-target.mjs'),/policy\.accountId!==p\.accountId/);
assert.equal(goldAbV2LabV1Disabled({LR_GOLD_INSTANCE_ID:'abv2lab01',
 LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1:'0'}),true);
assert.equal(goldAbV2LabV1Disabled({LR_GOLD_INSTANCE_ID:'goldabv2-production'}),true);
assert.equal(goldAbV2LabV1Disabled({LR_GOLD_INSTANCE_ID:'production'}),false);
const wall=src('device-agent/local-wall.mjs');
assert.match(wall,/base\.slice\(0,legacyStart\)\+/);
assert.match(wall,/v2CsrfScript/);
assert.match(wall,/class="joblead"/);
assert.match(wall,/class="jobtime muted"/);
assert.match(wall,/goldCodexDisabledNotice/);
assert.match(wall,/Enable Codex Bridge/);
assert.match(wall,/goldCodexDisableButton/);
assert.match(wall,/expectedRevision/);
console.log('GOLDABV2_V2_ONLY_OWNER_ENROLLMENT_BASED_DISCOVERY_AND_WALL_UX_PASS');
