#!/usr/bin/env python3
"""Source guards: no production import, network isolation and DB-backed verifier."""
from pathlib import Path
import unittest

R=Path(__file__).resolve().parents[1]
RUN=(R/'portability/verify_owner_channel_origin_transaction_pg_uat.py').read_text()
NODE=(R/'portability/synthetic-owner-channel-verifier-pg.mjs').read_text()
DOCKER=(R/'portability/Dockerfile.synthetic-origin-verifier-uat').read_text()

class ContainerVerifierSource(unittest.TestCase):
 def test_01_offline_cached_multistage_build(self):
  self.assertIn('FROM ghost:6-alpine AS node_abi',DOCKER)
  self.assertIn('FROM postgres:17-alpine',DOCKER)
  self.assertIn('COPY --from=node_abi /usr/local/bin/node',DOCKER)
  self.assertNotIn('RUN npm install',DOCKER)
  self.assertNotIn('RUN apk add',DOCKER)
 def test_02_unprivileged_readable_artifact(self):
  self.assertEqual(DOCKER.count('COPY --chmod=0444 synthetic-'),4)
  self.assertIn('RUN chmod 0555 /opt/uat',DOCKER)
  self.assertIn("'--user','999:999'",RUN)
  self.assertIn("'--read-only'",RUN)
 def test_03_node_owns_fresh_pg_context(self):
  self.assertIn("spawnSync('psql'",NODE)
  self.assertIn("lr_uat_get_owner_channel_context",NODE)
  self.assertIn("lr_uat_origin_reader_login",NODE)
  self.assertIn("'-h','postgres'",NODE)
  self.assertIn("verifySyntheticOwnerChannelEnvelope(envelope,readDbContext(envelope))",NODE)
 def test_04_reject_caller_context_and_sql_injection(self):
  self.assertIn("Object.keys(arg).sort().join(',')!=='envelope'",NODE)
  self.assertIn("UNTRUSTED_CONTEXT_FORBIDDEN",NODE)
  self.assertIn("INVALID_LOOKUP_ID",NODE)
  self.assertIn("const ID=/^uat_",NODE)
  self.assertIn("const HEX=/^[a-f0-9]{64}$/",NODE)
 def test_05_no_signer_key_or_physical_authority(self):
  self.assertIn("physicalExecutionAuthorized:false",NODE)
  self.assertIn("productionIssuerAuthorized:false",NODE)
  self.assertNotIn("generateKeyPair",NODE)
  self.assertNotIn("createPrivateKey",NODE)
  self.assertNotIn("crypto.sign",NODE)
  self.assertNotIn("docker.sock",NODE)
 def test_06_fails_closed_on_auth_and_context_errors(self):
  self.assertIn("SYNTHETIC_CONTEXT_UNAVAILABLE",NODE)
  self.assertIn("DB_CONTEXT_UNAVAILABLE",NODE)
  self.assertIn("PGCONNECT_TIMEOUT:'3'",NODE)
  self.assertIn("timeout:5000",NODE)
  self.assertIn("maxBuffer:65536",NODE)
 def test_07_no_admin_env_or_password_args(self):
  self.assertIn("PGPASSWORD:secret",NODE)
  self.assertNotIn("PGPASSWORD=",DOCKER)
  self.assertNotIn("lr_rc50_uat",NODE)
  self.assertNotIn("POSTGRES_PASSWORD",NODE)
  self.assertIn("readFileSync('/tmp/lr_rc50_origin_reader_secret'",NODE)
 def test_08_source_harness_does_not_feed_trusted_json(self):
  self.assertIn("data=json.dumps({'envelope':envelope}).encode()",RUN)
  self.assertIn("trusted=(None if EXTERNAL_VERIFIER else",RUN)
  self.assertIn("data=json.dumps({'envelope':envelopes[0],'trusted':{'grantId':'fake'}})",RUN)
 def test_09_independent_container_and_cleanup(self):
  self.assertIn("EXTERNAL_VERIFIER=start_isolated_db_client(project,cid,'verifier')",RUN)
  self.assertIn("'lr-rc50-origin-verifier-uat:e8babc6'",RUN)
  self.assertIn("('reader','writer','verifier')",RUN)
  self.assertIn("EXTERNAL_READER=EXTERNAL_WRITER=EXTERNAL_VERIFIER=None",RUN)
 def test_10_revocation_and_credential_failures(self):
  self.assertIn("wrong trusted Wall pin",RUN)
  self.assertIn("missing_verifier_credential_did_not_fail_closed",RUN)
  self.assertIn("reader secret removed",RUN)
  self.assertIn("removed_verifier_credential_affected_writer",RUN)
 def test_11_separate_origin_and_no_privilege_escalation(self):
  self.assertIn("lr_uat_origin_reader_login",RUN)
  self.assertIn("reader_escalated_to_issuer_role",RUN)
  self.assertIn("'--cap-drop','ALL'",RUN)
  self.assertIn("client_network_must_be_internal",RUN)
 def test_12_synthetic_only_migration_scope(self):
  self.assertIn("--confirm-synthetic-only",RUN)
  self.assertIn("LR_RC50_UAT_ONLY",NODE)
  self.assertNotIn("operator-host/",DOCKER)
  self.assertNotIn("plugin-server/",DOCKER)
  self.assertNotIn("EXPOSE ",DOCKER)

if __name__=='__main__':
 unittest.main(verbosity=2)
