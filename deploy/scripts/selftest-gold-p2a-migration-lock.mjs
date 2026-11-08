// P2-A source-only guard: immutable 001..042 chain + fail-closed migration opt-in.
// Live PostgreSQL is never contacted; the real PG17 runner E2E is a separate gate.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../../',import.meta.url));
const sqlRoot=path.join(root,'platform-v2/sql');
const manifest=JSON.parse(fs.readFileSync(path.join(sqlRoot,'migrations.lock.json'),'utf8'));
assert.equal(manifest.target,'light_remote_gold_dev - independent Gold only');
assert.equal(manifest.migrations.length,42);
const required=new Map([
 [40,'040_gold_connection_job_gc_fences.sql'],
 [41,'041_gold_device_execution_epoch.sql'],
 [42,'042_gold_wall_announcements_channel.sql'],
]);
for(const [index,row] of manifest.migrations.entries()){
 assert.equal(row.version,index+1,'migration numbering must be contiguous');
 assert.match(row.file,/^[0-9]{3}_[a-z0-9_]+\.sql$/);
 if(required.has(row.version))assert.equal(row.file,required.get(row.version));
 const source=fs.readFileSync(path.join(sqlRoot,row.file),'utf8');
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),row.sha256,
  'locked SQL must match immutable SHA256: '+row.version);
 assert.match(source,/^\s*(?:--[^\n]*\n\s*)*BEGIN;[\s\S]*?COMMIT;\s*$/,
  'reviewed SQL requires an explicit transaction: '+row.version);
}
const denied=spawnSync(process.execPath,[path.join(root,'deploy/scripts/apply-gold-db.mjs')],{
 cwd:root,encoding:'utf8',
 env:{...process.env,LIGHT_REMOTE_GOLD_ROOT:root,
  LIGHT_REMOTE_GOLD_INDEPENDENT:'0',LR_GOLD_APPLY_MIGRATIONS:'0'},
 timeout:5000,
});
assert.notEqual(denied.status,0,'runner must reject missing approval before DB connect');
assert.match(String(denied.stderr),/explicit_gold_independent_migration_approval_required/);
const g3=fs.readFileSync(path.join(root,'deploy/scripts/gold-g3-uat-cutover.sh'),'utf8');
assert.match(g3,/G3_GOLD_LEGACY_THREE_UNIT_CUTOVER_UNSAFE_WITH_SUPERVISOR/);
assert.match(g3,/light-remote-gold-process-supervisor\.service/);
console.log('GOLD_P2A_LOCKED_42_MANIFEST_AND_OPTIN=PASS');
