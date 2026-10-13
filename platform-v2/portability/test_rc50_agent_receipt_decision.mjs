import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSyntheticReceiptDecision as decide,
  makeEmptySyntheticSnapshot as blank,
} from './rc50_agent_receipt_decision.mjs';

const clock = 120000;
const base = { lockState: 'acquired', storageHealth: 'healthy', nowMs: clock };
const epoch = (patch = {}) => ({ kind: 'fake_epoch', verifiedBy: 'synthetic_test_only',
  accountId: 'uat_account_demo', deviceId: 'uat_device_demo', agentId: 'uat_agent_demo',
  generation: 50, grantRevision: 5, notBeforeMs: 100000, expiresAtMs: 160000, ...patch });
const command = (patch = {}) => ({ kind: 'fake_command', verifiedBy: 'synthetic_test_only',
  accountId: 'uat_account_demo', deviceId: 'uat_device_demo', agentId: 'uat_agent_demo',
  generation: 50, grantRevision: 5, notBeforeMs: 119000, expiresAtMs: 150000,
  commandId: 'uat_cmd_one_test', digest: 'a'.repeat(64),
  payload: { kind: 'fake_noop', message: 'no physical execution' }, ...patch });
function ask(s, operation, params = {}) { return decide(s, { ...base, operation, ...params }); }
function advance(s = blank()) {
  const r = ask(s, 'advance_epoch', { proof: epoch() });
  assert.equal(r.decision, 'PROPOSE_DURABLE_MUTATION'); return r.next;
}
function accept(s = advance()) {
  const r = ask(s, 'accept', { command: command() });
  assert.equal(r.decision, 'PROPOSE_DURABLE_MUTATION'); return r.next;
}
function start(s = accept()) {
  const r = ask(s, 'start_fake', { command: command() });
  assert.equal(r.decision, 'PROPOSE_DURABLE_MUTATION'); return r.next;
}
function denied(r, reason) { assert.equal(r.decision, 'DENY'); assert.equal(r.reason, reason); assert.equal(r.physicalExecutionAuthorized, false); }

test('01 - fake first epoch proposes fsync-pending generation advance', () => {
  const s = blank(); const r = ask(s, 'advance_epoch', { proof: epoch() });
  assert.equal(r.requiresFileAndDirectoryFsync, true);
  assert.equal(r.next.generation, 50); assert.equal(s.generation, 0);
});
test('02 - receipt operations deny when OS lock not acquired', () => {
  denied(ask(advance(), 'accept', { command: command(), lockState: 'busy' }), 'EXCLUSIVE_LOCK_NOT_PROVEN');
});
test('03 - missing receipt storage validation is fail-closed', () => {
  denied(ask(advance(), 'accept', { command: command(), storageHealth: 'ambiguous_after_rename' }), 'STORAGE_NOT_VERIFIED');
});
test('04 - abandoned Windows mutex is not clean owner acquisition', () => {
  denied(ask(advance(), 'recover', { lockState: 'abandoned', recoveryEvidence: 'synthetic_snapshot_checked' }), 'ABANDONED_LOCK_REQUIRES_RECONCILIATION');
});
test('05 - malformed or corrupt receipt snapshot denied', () => {
  const s = advance(); s.receipts.uat_bad = {status:'started'};
  denied(ask(s, 'accept', {command:command()}), 'INVALID_OR_CORRUPT_RECEIPT_SNAPSHOT');
});
test('06 - same signed fake command is idempotent', () => {
  const s = accept(); const r = ask(s, 'accept', {command:command()});
  assert.equal(r.decision, 'NOOP'); assert.equal(r.reason, 'DUPLICATE_RECEIPT_NO_REEXECUTION');
});
test('07 - changed digest with same commandId denied', () => {
  denied(ask(accept(), 'accept', {command:command({digest:'b'.repeat(64)})}), 'CONFLICTING_COMMAND_ID');
});
test('08 - fake start is a receipt proposal, not OS permission', () => {
  const r = ask(accept(), 'start_fake', {command:command()});
  assert.equal(r.next.receipts.uat_cmd_one_test.status, 'started');
  assert.equal(r.physicalExecutionAuthorized, false);
});
test('09 - second start denied', () => {
  denied(ask(start(), 'start_fake', {command:command()}), 'COMMAND_NOT_SAFE_TO_START');
});
test('10 - fake completion without verified synthetic evidence denied', () => {
  denied(ask(start(), 'complete_fake', {command:command()}), 'FAKE_COMPLETION_EVIDENCE_REQUIRED');
});
test('11 - fake completion records receipt as a durable proposal', () => {
  const r=ask(start(), 'complete_fake', {command:command(), resultEvidence:'synthetic_noop_result'});
  assert.equal(r.next.receipts.uat_cmd_one_test.status, 'completed'); assert.equal(r.requiresFileAndDirectoryFsync, true);
});
test('12 - recovery turns STARTED into UNCERTAIN', () => {
  const r=ask(start(), 'recover', {recoveryEvidence:'synthetic_snapshot_checked'});
  assert.equal(r.next.receipts.uat_cmd_one_test.status, 'uncertain');
});
test('13 - recovery turns ACCEPTED into UNCERTAIN', () => {
  const r=ask(accept(), 'recover', {recoveryEvidence:'synthetic_snapshot_checked'});
  assert.equal(r.next.receipts.uat_cmd_one_test.status, 'uncertain');
});
test('14 - no recovery evidence denied', () => {
  denied(ask(start(), 'recover'), 'RECOVERY_EVIDENCE_REQUIRED');
});
test('15 - higher epoch fences accepted receipt', () => {
  const s=accept(); const r=ask(s, 'advance_epoch', {proof:epoch({generation:51,grantRevision:6})});
  assert.equal(r.next.receipts.uat_cmd_one_test.status, 'fenced');
});
test('16 - higher epoch quarantines started receipt', () => {
  const s=start(); const r=ask(s, 'advance_epoch', {proof:epoch({generation:51,grantRevision:6})});
  assert.equal(r.next.receipts.uat_cmd_one_test.status, 'uncertain');
});
test('17 - epoch downgrade forbidden', () => {
  denied(ask(advance(), 'advance_epoch', {proof:epoch({generation:49})}), 'EPOCH_DOWNGRADE');
});
test('18 - equal epoch with conflicting grant denied', () => {
  denied(ask(advance(), 'advance_epoch', {proof:epoch({grantRevision:9})}), 'CONFLICTING_GRANT_REVISION');
});
test('19 - wrong device identity denied', () => {
  denied(ask(advance(), 'accept', {command:command({deviceId:'uat_device_wrong'})}), 'COMMAND_INVALID_STALE_OR_EXPIRED');
});
test('20 - expired command denied just before fake start', () => {
  denied(ask(accept(), 'start_fake', {command:command(), nowMs:150000}), 'COMMAND_INVALID_STALE_OR_EXPIRED');
});
test('21 - stale generation command denied after higher epoch', () => {
  const s=advance(); const next=ask(s,'advance_epoch',{proof:epoch({generation:51,grantRevision:6})}).next;
  denied(ask(next, 'accept', {command:command()}), 'COMMAND_INVALID_STALE_OR_EXPIRED');
});
test('22 - signed epoch cannot be assumed from unverified input', () => {
  denied(ask(blank(), 'advance_epoch', {proof:epoch({verifiedBy:'unchecked'})}), 'INVALID_FAKE_EPOCH_PROOF');
});
test('23 - unexpected command payload rejected', () => {
  denied(ask(advance(), 'accept', {command:command({payload:{kind:'pty',message:'x'}})}), 'COMMAND_INVALID_STALE_OR_EXPIRED');
});
test('24 - unsupported real OS operations denied', () => {
  denied(ask(start(), 'start_real_pty', {command:command()}), 'UNSUPPORTED_OPERATION');
});
test('25 - no result proposal can authorize OS execution', () => {
  const cases=[ask(blank(),'advance_epoch',{proof:epoch()}),ask(accept(),'start_fake',{command:command()}),ask(start(),'recover',{recoveryEvidence:'synthetic_snapshot_checked'})];
  for(const result of cases) assert.equal(result.physicalExecutionAuthorized, false);
});

test('26 - impossible generation/revision pair is corrupt', () => {
  const s=advance(); s.grantRevision=0;
  denied(ask(s, 'accept', {command:command()}), 'INVALID_OR_CORRUPT_RECEIPT_SNAPSHOT');
});
