#!/usr/bin/env python3
"""Scratch PostgreSQL signed-device ACK verifier ACL source guards."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
SQL=(ROOT/'portability/device_ack_verifier_acl_uat.sql').read_text()
RUN=(ROOT/'portability/verify_signed_device_ack_pg_uat.py').read_text()
REAL=(ROOT.parent/'device-agent/operator-agent.mjs').read_text()
WALL=(ROOT.parent/'device-agent/local-wall.mjs').read_text()

class DeviceAckVerifierAclSource(unittest.TestCase):
 def test_isolation_and_no_real_agent_wiring(self):
  self.assertIn('DISPOSABLE POSTGRES UAT',SQL)
  self.assertNotIn('device_ack_verifier_acl_uat.sql',REAL+WALL)
  self.assertIn('--confirm-synthetic-only',RUN)
  self.assertIn('u.check_isolation(cid)',RUN)
 def test_all_three_roles_are_nonlogin(self):
  for role in ['lr_uat_ack_function_owner','lr_uat_ack_verifier',
               'lr_uat_ack_untrusted']:
   self.assertIn('CREATE ROLE '+role+' NOLOGIN NOINHERIT',SQL)
 def test_public_execute_closed_in_scratch_database(self):
  self.assertIn('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC',SQL)
  self.assertIn('REVOKE CREATE ON SCHEMA public FROM PUBLIC',SQL)
 def test_only_one_signed_ack_entrypoint_granted_to_verifier(self):
  self.assertIn('GRANT EXECUTE ON FUNCTION public.lr_uat_commit_signed_device_ack',SQL)
  self.assertIn('TO lr_uat_ack_verifier',SQL)
  self.assertNotIn('GRANT EXECUTE ON FUNCTION public.lr_uat_ack_signed_lease',SQL.split('TO lr_uat_ack_verifier')[0].split('TO lr_uat_ack_function_owner')[0])
 def test_function_owner_is_separate_and_definer_search_path_safe(self):
  self.assertIn('OWNER TO lr_uat_ack_function_owner',SQL)
  self.assertIn('SECURITY DEFINER',SQL)
  self.assertIn('SET search_path=pg_catalog,public,pg_temp',SQL)
  self.assertIn('GRANT UPDATE(consumed_at,ack_packet_sha256)',SQL)
  self.assertIn('GRANT UPDATE(request_id)',SQL)
 def test_verifier_has_no_general_table_write(self):
  self.assertNotIn('GRANT INSERT ON ALL TABLES',SQL)
  self.assertNotIn('GRANT UPDATE ON ALL TABLES',SQL)
  self.assertNotIn('GRANT SELECT ON ALL TABLES',SQL)
  self.assertNotIn('GRANT UPDATE ON lr_uat_device_ack_challenge TO lr_uat_ack_verifier',SQL)
 def test_real_verifier_role_executed_in_scratch_e2e(self):
  self.assertIn('SET ROLE lr_uat_ack_verifier;',RUN)
  self.assertIn('SET ROLE lr_uat_ack_untrusted;',RUN)
  self.assertIn('ACL PASS 01 verifier can call',RUN)
  self.assertIn('ACL PASS 04 NOLOGIN',RUN)
 def test_revocation_and_temp_table_shadow_negative_tests(self):
  self.assertIn('REVOKE EXECUTE ON FUNCTION public.lr_uat_commit_signed_device_ack',RUN)
  self.assertIn('ACL PASS 05 verifier EXECUTE revoked',RUN)
  self.assertIn('CREATE TEMP TABLE lr_uat_device_ack_challenge(dummy int)',RUN)
  self.assertIn('temp_schema_shadowed_privileged_function_table',RUN)
 def test_no_public_owner_privileges_or_prod_claim(self):
  self.assertNotIn('GRANT lr_uat_ack_function_owner TO',SQL)
  self.assertNotIn('PASSWORD',SQL)
  self.assertNotIn('LOGIN ',SQL.replace('NOLOGIN',''))
  self.assertIn('production=false',RUN)

if __name__=='__main__':
 unittest.main(verbosity=2)
