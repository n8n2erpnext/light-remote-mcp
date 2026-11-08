#!/usr/bin/env python3
"""Fail-closed source guards for signed PG-outbox -> fake-agent E2E runner.
No Docker, database or any runtime state is touched by this module.
"""
import re
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
UAT=(ROOT/'portability/verify_signed_outbox_agent_uat.mjs').read_text()
SIGNED=(ROOT/'portability/synthetic-signed-agent-gate.mjs').read_text()
AGENT=(ROOT/'portability/synthetic-agent-generation.mjs').read_text()

class SignedOutboxSourceGuard(unittest.TestCase):
 def test_explicit_dev_compose_and_database_only(self):
  for required in ('lightremote-rc50-v2','light_remote_rc50_uat','lr_rc50_uat',
                   'lr_rc50_epoch_synthetic','rc50-v2-platform',
                   "network','inspect',PROJECT+'_private'",
                   'unsafe_service_','wrong_compose_label'):
   self.assertIn(required,UAT)
  for forbidden in ('light_remote_prod','docker compose down','docker volume rm',
                    'DROP DATABASE','DROP SCHEMA','CREATE ROLE','ALTER ROLE'):
   self.assertNotIn(forbidden,UAT)
 def test_fake_only_no_os_dispatch(self):
  for required in ("kind:'fake_noop'","'fake_fleet'","realDeviceExecuted:false",
                   'productionCutoverAuthorized:false','globalAuthorityProven:false'):
   self.assertIn(required,UAT)
  for forbidden in ('NATIVE_TERMINALS','spawnPty','desktop_input','/v1/execute',
                    '/v1/terminal','/v1/desktop','https://','http://'):
   self.assertNotIn(forbidden,UAT)
 def test_ephemeral_signing_no_private_key_export(self):
  self.assertIn("generateKeyPairSync('ed25519')",UAT)
  self.assertIn('signSyntheticEpoch(',UAT)
  self.assertIn('signSyntheticCommand(',UAT)
  self.assertIn('signature_not_verified',UAT)
  self.assertNotIn("keys.privateKey.export(",UAT)
  self.assertNotIn("writeFileSync(",UAT)
 def test_receipt_protocol_is_durable_and_never_direct_os(self):
  self.assertIn('writeSyntheticJsonDurably',AGENT)
  self.assertIn("row.status='uncertain'",AGENT)
  self.assertIn("row.status='fenced'",AGENT)
  self.assertIn("payload.kind!=='fake_noop'",AGENT)
  self.assertNotIn('child_process',AGENT)
  self.assertNotIn('NATIVE_TERMINALS',AGENT)
  self.assertIn("this.#time(e);",SIGNED)
 def test_signed_claim_and_reconciliation_cases(self):
  for required in (
   "stage='acked_once_and_duplicate'",
   "stage='uncertain_restart_before_fence'",
   "stage='rogue_signature_rejected_after_outbox_claim'",
   "stage='fence_old_generation'",
   "stage='receipt_reconcile_after_lost_ack'",
   'old_gen','fence_writer_uat','ack_command_uat','claim_command_uat',
   "status==='completed'",'duplicate_no_execution',
  ):
   # 'old_gen' intentionally not used in script; rely on explicit 'queuedOld'.
   if required=='old_gen':
    self.assertIn('queuedOld',UAT)
   else:
    self.assertIn(required,UAT)
 def test_failure_cleanup_and_owner_scoping(self):
  for required in ("finally{","fs.rmSync(fixture","uat_cmd_e2e_",
                   "DELETE FROM ${S}.command_outbox","state()",
                   "status==='active' && owner===holder","fence_writer_uat",
                   "'synthetic_rows_remain'","'synthetic_fence_not_restored'",
                   'RC50_SIGNED_PG_OUTBOX_CLEANUP_PASS'):
   self.assertIn(required,UAT)
  self.assertIn("process.exitCode=1",UAT)
 def test_envelope_checked_before_fake_receipt(self):
  self.assertIn("packet?.payload?.commandId===claimed.out_command_id",UAT)
  self.assertIn("packet?.payload?.generation===Number(claimed.out_generation)",UAT)
  self.assertIn("gate.accept(fetchSigned(claimedBad.row))",UAT)
  self.assertIn("agent.receipts()[idBad]===undefined",UAT)
 def test_no_live_key_or_account_source_dependencies(self):
  imports=re.findall(r"^import\s+.*?from\s+['\"]([^'\"]+)['\"]",UAT,re.M)
  self.assertTrue(all(x.startswith('node:') or x.startswith('./synthetic-')
                      for x in imports),imports)
  self.assertNotIn('operator-host/',UAT)
  self.assertNotIn('plugin-server/',UAT)
 def test_valid_signed_gate_has_explicit_expiration_guard(self):
  self.assertIn('signature_not_verified',SIGNED)
  self.assertIn('signed_command_not_fresh_for_start',SIGNED)
  self.assertIn('signed_command_epoch_or_grant_mismatch',SIGNED)
  self.assertIn('signed_envelope_wrong_target',SIGNED)

if __name__=='__main__':
 unittest.main(verbosity=2)
