import assert from 'node:assert/strict';
import {GoldPersonalAgentScheduler} from '../../lib/gold-personal-agent-scheduler.mjs';

// Operator boot: atomically fence orphaned admitting leases after lost work.
// This contract is intentionally fixture-only: never call global startup
// recovery on the live Gold UAT database while a service is running.
const statements=[];
const pool={connect:async()=>({}),query:async sql=>{
 statements.push(sql);return {rowCount:1,rows:[]};
}};
const withResources=new GoldPersonalAgentScheduler({pool,resources:{}});
await withResources.recoverStartup();
assert.equal(statements.length,1,'one SQL statement = one atomic recovery transaction');
const sql=statements[0];
assert.match(sql,/WITH lost AS\s*\(\s*UPDATE lr_gold_personal_agent_work/);
assert.match(sql,/state='unknown'/);
assert.match(sql,/state IN \('queued','running'\)/);
assert.match(sql,/UPDATE lr_gold_device_resource_claims AS c/);
assert.match(sql,/worker_state='terminal_unknown'/);
assert.match(sql,/c\.job_id IN \(SELECT job_id FROM lost\)/);
assert.doesNotMatch(sql,/SET worker_state='terminal_unknown'\s+FROM lost/,
 'empty lost CTE must not suppress previously unknown claims');
assert.match(sql,/j\.state='unknown'/);
assert.match(sql,/j\.disposition='operator_restart_reconcile'/);
assert.match(sql,/c\.worker_state='admitting' AND c\.process_id IS NULL/);
assert.doesNotMatch(sql,/DELETE\s+FROM\s+lr_gold_device_resource_claims/i);
assert.doesNotMatch(sql,/INSERT\s+INTO\s+lr_gold_terminal_receipt_acks/i);
statements.length=0;
await new GoldPersonalAgentScheduler({pool}).recoverStartup();
assert.equal(statements.length,1);
assert.doesNotMatch(statements[0],/lr_gold_device_resource_claims/,
 'M3 baseline without M4 migration must remain usable');
await assert.rejects(
 ()=>new GoldPersonalAgentScheduler({pool:{connect:async()=>({}),query:async()=>{throw Error('pg_flush_failed')}},resources:{}}).recoverStartup(),
 /pg_flush_failed/,'fail closed if durable PG recovery fails');
console.log('GOLD_M3_RECOVERY_UNKNOWN_CLAIM_ATOMIC_FAIL_CLOSED=PASS');
