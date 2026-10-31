import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {
 assertGoldStartupMigrationLedger,assertGoldStartupExtensionTables,
 GOLD_GUEST_NATIVE_RUNTIME_WIRED
} from '../../lib/gold-schema-startup-gate.mjs';
const rows=n=>Array.from({length:n},(_,i)=>({version:i+1}));
const lock=JSON.parse(fs.readFileSync(
 new URL('../../platform-v2/sql/migrations.lock.json',import.meta.url),'utf8'));
const approved={...lock,migrations:[...lock.migrations]};
for(const [n,name] of [[43,'043_gold_device_short_ids.sql'],
 [44,'044_gold_pro_share.sql']]){
 const src=fs.readFileSync(new URL('../../platform-v2/sql/'+name,import.meta.url));
 approved.migrations.push({version:n,file:name,sha256:
  crypto.createHash('sha256').update(src).digest('hex')});
}
for(const n of [34,39,40,41,42]){
 const x=assertGoldStartupMigrationLedger(rows(n));
 assert.equal(x.version,n);assert.equal(x.guestSchemaReady,false);
}
for(const x of [[],rows(33),rows(45),[...rows(39).slice(0,-1),{version:41}],
 [{version:1}],null]){
 assert.throws(()=>assertGoldStartupMigrationLedger(x),/gold_pg_migrations_missing/);
}
const allow43={LR_GOLD_SCHEMA_043_RELEASE_ACCEPT:'1'};
const flags=[
 'LR_GOLD_PRO_SHARE_GUEST_RUNTIME_APPROVED',
 'LR_GOLD_PRO_SHARE_CORE','LR_GOLD_PRO_SHARE_GUEST_QUEUE',
 'LR_GOLD_PRO_SHARE_GUEST_SLOTS',
 'LR_GOLD_PRO_SHARE_GUEST_PAYLOAD_STAGE',
 'LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL',
 'LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE',
 'LR_GOLD_PRO_SHARE_GUEST_TICKET_ISSUE',
 'LR_GOLD_PRO_SHARE_GUEST_OUTBOUND_PREPARE',
 'LR_GOLD_PRO_SHARE_GUEST_FLEET_ADAPTER',
 'LR_GOLD_PRO_SHARE_GUEST_SIGNED_LAUNCH',
 'LR_GOLD_PRO_SHARE_GUEST_LAUNCH_BIND',
 'LR_GOLD_PRO_SHARE_GUEST_TERMINAL_SETTLE',
 'OPERATOR_PERSONAL_AGENT_SCHEDULER',
 'OPERATOR_DEVICE_RESOURCE_LOCKS',
 'OPERATOR_EXECUTION_EPOCH_ENABLED'
];
const allow44={...allow43,
 LR_GOLD_PRO_SHARE_SCHEMA_044_RELEASE_ACCEPT:'1',
 ...Object.fromEntries(flags.map(key=>[key,'1']))};
assert.throws(()=>assertGoldStartupMigrationLedger(rows(43)),
 /gold_pg_schema_043_release_not_approved/);
assert.throws(()=>assertGoldStartupMigrationLedger(rows(43),{env:allow43}),
 /gold_pg_candidate_43_not_locked/);
assert.throws(()=>assertGoldStartupMigrationLedger(rows(44),{env:allow44}),
 /gold_pg_candidate_43_not_locked/);
assert.deepEqual(assertGoldStartupMigrationLedger(rows(43),{
 env:allow43,lock:approved
}),{version:43,guestSchemaReady:false});
assert.throws(()=>assertGoldStartupMigrationLedger(rows(44),{
 env:allow43,lock:approved
}),/gold_pg_schema_044_guest_runtime_release_not_approved/);
// SQL044 is a source candidate; a forged all-flags-ON environment and
// a hypothetical correctly pinned migration lock must NOT enable runtime.
assert.equal(GOLD_GUEST_NATIVE_RUNTIME_WIRED,false);
assert.throws(()=>assertGoldStartupMigrationLedger(rows(44),{
 env:allow44,lock:approved
}),/gold_pg_schema_044_native_guest_runtime_not_wired/);
assert.throws(()=>assertGoldStartupMigrationLedger(rows(44),{
 env:{...allow44,LR_GOLD_PRO_SHARE_GUEST_NATIVE_RUNTIME_WIRED:'1'},
 lock:approved
}),/gold_pg_schema_044_native_guest_runtime_not_wired/);
for(const key of flags){
 assert.throws(()=>assertGoldStartupMigrationLedger(rows(44),{
  env:{...allow44,[key]:'0'},lock:approved
 }),/gold_pg_schema_044_guest_runtime_release_not_approved/);
}
for(const bad of [
 {...approved,migrations:approved.migrations.filter(r=>r.version!==44)},
 {...approved,migrations:approved.migrations.map(r=>
  r.version===44?{...r,sha256:'b'.repeat(64)}:r)},
 {...approved,migrations:approved.migrations.map(r=>
  r.version===44?{...r,file:'043_gold_device_short_ids.sql'}:r)}
]){
 assert.throws(()=>assertGoldStartupMigrationLedger(rows(44),{
  env:allow44,lock:bad
 }),/gold_pg_candidate_44_(not_locked|source_digest_mismatch)/);
}
let calls=0;
const pool=(responses)=>({query:async sql=>{
 calls++;assert.match(sql,/SELECT/);
 return {rows:[responses.shift()||{}]};
}});
await assertGoldStartupExtensionTables(pool([]),42);
assert.equal(calls,0);
await assert.rejects(assertGoldStartupExtensionTables(pool([
 {short_ids:false,immutable_trigger:true}
]),43),/gold_pg_migration_043_short_id_contract_missing/);
await assertGoldStartupExtensionTables(pool([
 {short_ids:true,immutable_trigger:true}
]),43);
const ok44={addons:true,seats:true,devices:true,jobs:true,slots:true,
 payloads:true,outbound:true,usage:true,owner_connection_fk:true};
await assertGoldStartupExtensionTables(pool([
 {short_ids:true,immutable_trigger:true},ok44
]),44);
await assert.rejects(assertGoldStartupExtensionTables(pool([
 {short_ids:true,immutable_trigger:true},
 {...ok44,outbound:false}
]),44),/gold_pg_migration_044_guest_scope_contract_missing/);
await assert.rejects(assertGoldStartupExtensionTables(pool([
 {short_ids:true,immutable_trigger:true},
 {...ok44,owner_connection_fk:false}
]),44),/gold_pg_migration_044_guest_scope_contract_missing/);
// Wiring guard: default 039 cannot turn on Guest startup preservation
// merely from a process.env override; it must have storage schema approval.
const db=fs.readFileSync(new URL('../../lib/gold-db.mjs',import.meta.url),'utf8');
const operator=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
assert.match(db,/schema:startup/);
assert.match(operator,/preserveGuestUnknown:goldStorage\.schema\?\.guestSchemaReady===true/);
assert.match(operator,/preserveGuestReservations:goldStorage\.schema\?\.guestSchemaReady===true/);
console.log('GOLD_SCHEMA_STARTUP_LOCKED_GATE_CONTROLS_GUEST_RESTART_FENCE=PASS');
console.log('GOLD_SCHEMA_034_TO_042_BACKWARDS_COMPATIBLE=PASS');
console.log('GOLD_SCHEMA_043_044_REAL_LOCK_UNREGISTERED_DENIED=PASS');
console.log('GOLD_SCHEMA_043_044_FUTURE_APPROVED_CONTRACT_HASH_ENFORCED=PASS');
console.log('GOLD_SCHEMA_043_044_NATIVE_STRUCTURAL_PROBES_FAIL_CLOSED=PASS');
console.log('GOLD_SCHEMA_044_ALL_FLAGS_AND_PINNED_LOCK_STILL_REQUIRE_NATIVE_RUNTIME=PASS');
