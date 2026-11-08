#!/usr/bin/env python3
"""P0 source-only guard for proposed *unwired* synthetic HTTP verifier ingress."""
from pathlib import Path
import unittest

root=Path(__file__).resolve().parents[1]/'portability'
server=(root/'synthetic-origin-verifier-http-service.mjs').read_text()
client=(root/'synthetic-origin-producer-http-client.mjs').read_text()
docker=(root/'Dockerfile.synthetic-origin-verifier-uat').read_text()
class UATSourceOnly(unittest.TestCase):
 def test_01_explicit_optin(self):
  self.assertIn("LR_RC50_UAT_ONLY",server)
  self.assertIn("--synthetic-service",server)
  self.assertIn("--single",client)
  self.assertIn("LR_RC50_UAT_ONLY",client)
 def test_02_no_production_binding(self):
  self.assertIn("'0.0.0.0'",server)
  self.assertIn("const PORT=39071",server)
  self.assertNotIn("EXPOSE ",docker)
  self.assertNotIn("productionIssuerAuthorized:true",server)
  self.assertNotIn("physicalExecutionAuthorized:true",server)
 def test_03_message_authenticity(self):
  self.assertIn("createHmac('sha256'",server)
  self.assertIn("timingSafeEqual",server)
  self.assertIn("createHmac('sha256'",client)
  self.assertIn("x-uat-signature",client)
 def test_04_anti_replay(self):
  self.assertIn("SyntheticReplayJournal",server)
  self.assertIn("replayJournal.claim(nonce)",server)
  self.assertIn("WINDOW_MS=30000",server)
  self.assertIn("rc50_synthetic_replay_journal_not_ready",server)
 def test_05_trusted_input_denied(self):
  self.assertIn("Object.keys(input).sort().join(',')!=='envelope'",server)
  self.assertIn("UNTRUSTED_CONTEXT_FORBIDDEN",server)
  self.assertIn("verifyViaSyntheticDb(input.envelope)",server)
 def test_06_body_limit(self):
  self.assertIn("MAX_BODY=24000",server)
  self.assertIn("BODY_TOO_LARGE",server)
  self.assertIn("server.requestTimeout=8000",server)
 def test_07_no_private_keys(self):
  self.assertNotIn("generateKeyPair",server)
  self.assertNotIn("createPrivateKey",server)
  self.assertNotIn("sign(",server)
  self.assertNotIn("docker.sock",client)
 def test_08_explicit_unwired_status(self):
  runner=(root/'verify_owner_channel_origin_transaction_pg_uat.py').read_text()
  self.assertNotIn("EXTERNAL_PRODUCER",runner)
  self.assertIn("EXTERNAL_VERIFIER",runner)
 def test_09_durable_journal_preprovision_and_secret_file(self):
  self.assertIn("SyntheticReplayJournal(replayJournalPath)",server)
  self.assertNotIn("initializeSyntheticReplayJournal(",server)
  self.assertIn("fs.constants.O_NOFOLLOW",server)
  self.assertIn("st.uid!==process.getuid()",server)
  self.assertIn("REPLAY_JOURNAL_NOT_READY", (root/'synthetic-durable-nonce-journal.mjs').read_text())
 def test_10_local_single_instance_fail_closed(self):
  lease=(root/'synthetic-single-instance-lease.mjs').read_text()
  self.assertIn("SyntheticSingleInstanceLease(replayJournalPath)",server)
  self.assertIn("if(!replayLease.owns())return 503",server)
  self.assertIn("replayLease?.release()",server)
  self.assertIn("fs.constants.O_EXCL",lease)
  self.assertIn("LEASE_NOT_ACQUIRED",lease)
  self.assertIn("LEASE_OWNERSHIP_LOST",lease)
  self.assertIn("COPY --chmod=0444 synthetic-single-instance-lease.mjs",docker)
  self.assertNotIn("unlinkSync(this.file)",server)
 def test_11_live_journal_identity(self):
  journal=(root/'synthetic-durable-nonce-journal.mjs').read_text()
  self.assertIn("REPLAY_LIVE_FILE_CHANGED",journal)
  self.assertIn("b.ino!==a.ino",journal)
  self.assertIn("a.size!==this.expectedBytes",journal)
 def test_12_cached_image(self):
  self.assertIn("COPY --chmod=0444 synthetic-origin-verifier-http-service.mjs",docker)
  self.assertIn("COPY --chmod=0444 synthetic-origin-producer-http-client.mjs",docker)
  self.assertIn("COPY --chmod=0444 synthetic-durable-nonce-journal.mjs",docker)
  self.assertNotIn("npm install",docker)
  self.assertNotIn("apk add",docker)

if __name__=='__main__':
 unittest.main(verbosity=2)
