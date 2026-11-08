import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requireOrphanJobId,exactOrphanClaimWhere} from './gold-m6-orphan-claim-selection.mjs';
const good='db964413-f80f-4869-96aa-fa9b56dded09';
assert.equal(requireOrphanJobId(['--job-id',good]),good);
assert.equal(requireOrphanJobId(['--job-id',good.toUpperCase()]),good);
for(const v of [[],['--job-id'],['--job-id',good,good],['--device-id',good],
 ['--job-id',''],['--job-id',good+"' OR true--"],['--job-id','1'],
 ['--job-id','db964413-f80f-4869-96aa-fa9b56dded09; SELECT 1']])
 assert.throws(()=>requireOrphanJobId(v),/owner_orphan_/);
assert.equal(exactOrphanClaimWhere(good)," WHERE c.job_id='"+good+"'");
assert.throws(()=>exactOrphanClaimWhere("' OR 1=1--"),/owner_orphan_invalid_job_id/);
const cli=readFileSync(new URL('./gold-m6-owner-orphan-recovery-cli.mjs',import.meta.url),'utf8');
assert.match(cli,/readClaim\(requireOrphanJobId\(process\.argv\.slice\(2\)\)\)/);
assert.match(cli,/exactOrphanClaimWhere\(jobId\)/);
assert.match(cli,/assert\(stdin\.isTTY&&stdout\.isTTY/);
assert.match(cli,/result\.processOutcome==='unknown'/);
assert.match(cli,/result\.terminalReceiptCreated===false/);
assert.doesNotMatch(cli,/DELETE FROM lr_gold_device_resource_claims/);
console.log('P0_M6_OWNER_EXPLICIT_EXACT_JOB_SELECTION_FAIL_CLOSED_PASS');
