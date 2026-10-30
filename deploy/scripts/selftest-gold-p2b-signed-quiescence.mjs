import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateP2BQuiescence} from '../../lib/gold-p2b-signed-quiescence.mjs';

const observed={
 unknownTotal:27,retainedPreDispatch:26,unresolvedUnknown:1,
 startedUnknown:1,unknownWithClaims:0,
 foreignClaims:1,runningClaims:1,claimsWithoutTerminalAck:1,
 claimsWithProcessId:1,terminalAckMatches:0,
};
const result=evaluateP2BQuiescence(observed);
assert.equal(result.classification,'HOLD');
assert.equal(result.retainedPreDispatch,26);
assert.equal(result.unresolvedUnknown,1);
assert.equal(result.claimsWithoutTerminalAck,1);
assert.equal(result.releaseAllowed,false);
assert.equal(result.signedQuiescenceProven,false);
assert.equal(result.modifiedRows,0);
assert.ok(result.blockers.includes('os_effect_may_still_be_running'));
assert.ok(result.blockers.includes('exact_signed_terminal_receipt_missing'));
for(const value of [{},{...observed,retainedPreDispatch:27},{...observed,startedUnknown:2},
 {...observed,runningClaims:2},{...observed,terminalAckMatches:2},
 {...observed,foreignClaims:-1},{...observed,unknownTotal:NaN}]){
 assert.throws(()=>evaluateP2BQuiescence(value),/p2b_quiescence_aggregate/);
}
// Even zero rows and a claimed exact receipt are not a cryptographic proof.
const empty=Object.fromEntries(Object.keys(observed).map(k=>[k,0]));
assert.equal(evaluateP2BQuiescence(empty).releaseAllowed,false);
assert.equal(evaluateP2BQuiescence(empty).classification,'SIGNED_PROOF_STILL_REQUIRED');
const ackSeen={...observed,claimsWithoutTerminalAck:0,terminalAckMatches:1};
assert.equal(evaluateP2BQuiescence(ackSeen).releaseAllowed,false);
const sql=fs.readFileSync(fileURLToPath(new URL('./gold-p2b-unknown-claim-audit.sql',import.meta.url)),'utf8');
assert.match(sql,/BEGIN READ ONLY;/);
assert.match(sql,/COMMIT;/);
for(const token of ['operator_restart_reconcile','QUEUED_AGENT_SLOT','RESOURCE_LOCKED',
 'lr_gold_terminal_receipt_acks','lr_gold_device_resource_claims','lr_gold_personal_agent_work'])
 assert.ok(sql.includes(token));
assert.doesNotMatch(sql,/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\s/im);
assert.doesNotMatch(sql,/SELECT\s+\*/i);
assert.doesNotMatch(sql,/pg_sleep|FOR UPDATE|LOCK TABLE/i);
const rendered=JSON.stringify(result);
assert.doesNotMatch(rendered,/(accountId|deviceId|jobId|processId|token|signature)/);
const cli=fileURLToPath(new URL('./gold-p2b-audit-report.mjs',import.meta.url));
const actual=spawnSync(process.execPath,[cli],{
 input:JSON.stringify({...observed,deviceId:'sensitive-test-device',jobId:'sensitive-test-job'}),
 encoding:'utf8',timeout:7000
});
assert.equal(actual.status,4);
assert.equal(JSON.parse(actual.stdout).releaseAllowed,false);
assert.doesNotMatch(actual.stdout,/sensitive-test/);
const bad=spawnSync(process.execPath,[cli],{
 input:JSON.stringify({sessionId:'private-value'}),
 encoding:'utf8',timeout:7000
});
assert.equal(bad.status,5);
assert.doesNotMatch(bad.stderr,/private-value/);
console.log('GOLD_P2B_SIGNED_QUIESCENCE_HOLD_AND_PRIVACY=PASS');
