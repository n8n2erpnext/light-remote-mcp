import assert from 'node:assert/strict';
import {GoldJobLedger} from '../../lib/gold-job-ledger.mjs';

const statements=[];
const pool={query:async sql=>{
 statements.push(sql);return {rows:[],rowCount:0};
}};
await GoldJobLedger.open({pool,redact:s=>s});
assert.equal(statements.length,1);
assert.match(statements[0],/WHERE status IN \('running','queued'\)/);
assert.doesNotMatch(statements[0],/lr_gold_pro_share_guest_slots/);
statements.length=0;
await GoldJobLedger.open({pool,redact:s=>s,preserveGuestUnknown:true});
assert.equal(statements.length,1);
assert.match(statements[0],/lr_gold_pro_share_guest_jobs/);
assert.match(statements[0],/lr_gold_pro_share_guest_slots/);
assert.match(statements[0],/g.state='unknown'/);
assert.match(statements[0],/g.state='queued' AND s.state='reserved'/);
assert.match(statements[0],/g.state='cancelled' AND s.state='cancelled'/);
assert.match(statements[0],/j.status='queued'|lr_gold_job_records.status='queued'/);
assert.match(statements[0],/lr_gold_pro_share_guest_outbound/);
assert.match(statements[0],/lr_gold_personal_agent_work/);
assert.match(statements[0],/lr_gold_device_resource_claims/);
assert.match(statements[0],/w.state='running'/);
assert.match(statements[0],/c.worker_state='admitting' AND c.process_id IS NULL/);
assert.match(statements[0],/s.state IN \('unknown','submitted'\)/);
assert.match(statements[0],/g.owner_account_id=lr_gold_job_records.account_id/);
assert.match(statements[0],/g.device_id=lr_gold_job_records.device_id/);
console.log('GOLD_P2I4C3C2B3_GOLD_LEDGER_OWNER_RESTART_DEFAULT_UNCHANGED=PASS');
console.log('GOLD_P2I4C3C2B3_GUEST_UNKNOWN_RESTART_OPT_IN_FENCE=PASS');

console.log('GOLD_JOB_LEDGER_RESERVED_GUEST_PRE_EFFECT_RESTART_CANCELABLE=PASS');
