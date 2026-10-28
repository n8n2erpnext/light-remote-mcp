import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const root='platform-v2/sql/';
const manifest=JSON.parse(fs.readFileSync(root+'migrations.lock.json','utf8'));
assert.equal(manifest.target,'light_remote_gold_dev - independent Gold only');
assert.equal(manifest.migrations.length,38);
const entry=manifest.migrations.at(-1);
assert.equal(entry.version,38);
assert.equal(entry.file,'038_gold_job_cancelled_status.sql');
const sql=fs.readFileSync(root+entry.file,'utf8');
assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),entry.sha256);
assert.match(sql,/BEGIN;[\s\S]*ALTER TABLE lr_gold_job_records[\s\S]*COMMIT;/);
for(const status of ['queued','running','ok','error','timeout','interrupted','cancelled'])
 assert.match(sql,new RegExp("'"+status+"'"),'missing durable state '+status);
assert.match(fs.readFileSync('lib/gold-job-ledger.mjs','utf8'),/status:job.status/);
assert.match(fs.readFileSync('operator-host/executor.mjs','utf8'),/job.status = job.cancelled === true \? 'cancelled'/);
console.log('GOLD_JOB_CANCELLED_SCHEMA38_CONTRACT_PASS');
