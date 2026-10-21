import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const lock=JSON.parse(fs.readFileSync('platform-v2/sql/migrations.lock.json','utf8'));
assert.equal(lock.migrations.length,33);
const m=lock.migrations.at(-2);
assert.equal(m.version,32);
assert.equal(m.file,'032_gold_personal_agent_admission.sql');
const sql=fs.readFileSync('platform-v2/sql/'+m.file,'utf8');
assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),m.sha256);
for(const word of ['lr_gold_personal_agent_work','account_id','agent_id','session_id','operation_id',
  "state IN ('queued','running','finished','unknown')",'GRANT SELECT,INSERT,UPDATE,DELETE']){
  assert.ok(sql.includes(word),word);
}
assert.match(fs.readFileSync('operator-host/executor.mjs','utf8'),/OPERATOR_PERSONAL_AGENT_SCHEDULER/);
assert.match(fs.readFileSync('lib/gold-job-ledger.mjs','utf8'),/status IN \('running','queued'\)/);
console.log('M3_PERSONAL_AGENT_TYPED_PG_SCHEMA_MANIFEST_G4_QUEUE_CONTRACT=PASS');
