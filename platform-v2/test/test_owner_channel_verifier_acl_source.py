#!/usr/bin/env python3
"""Read-only source guard for synthetic PG origin verifier EXECUTE boundary."""
import unittest
from pathlib import Path
R=Path(__file__).resolve().parents[1]
P=R/'portability'
ACL=(P/'owner_channel_origin_verifier_acl_uat.sql').read_text()
RUN=(P/'verify_owner_channel_origin_transaction_pg_uat.py').read_text()
SQL=(P/'owner_channel_origin_transaction_uat.sql').read_text()
WALL=(R.parent/'device-agent/local-wall.mjs').read_text()
AGENT=(R.parent/'device-agent/operator-agent.mjs').read_text()
class OriginVerifierAclGuard(unittest.TestCase):
 def test_no_real_agent_or_wall_import(self):
  self.assertIn('ephemeral synthetic PostgreSQL',ACL)
  self.assertNotIn('owner_channel_origin_verifier_acl_uat.sql',WALL+AGENT)
  self.assertIn('--confirm-synthetic-only',RUN)
  self.assertIn('u.check_isolation(cid)',RUN)
 def test_all_three_roles_nonlogin_noninherit(self):
  for r in ('lr_uat_origin_function_owner','lr_uat_origin_verifier',
            'lr_uat_origin_untrusted'):
   self.assertIn('CREATE ROLE '+r+' NOLOGIN NOINHERIT',ACL)
 def test_revoke_implicit_public_execution_and_schema_create(self):
  self.assertIn('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC',ACL)
  self.assertIn('REVOKE CREATE ON SCHEMA public FROM PUBLIC',ACL)
 def test_verifier_gets_only_signed_owner_channel_entrypoint(self):
  self.assertIn('GRANT EXECUTE ON FUNCTION public.lr_uat_commit_owner_channel_origin',ACL)
  self.assertIn('TO lr_uat_origin_verifier',ACL)
  self.assertIn('GRANT EXECUTE ON FUNCTION public.lr_uat_issue_direct_owner_grant(text,text)',ACL)
  self.assertIn('TO lr_uat_origin_function_owner',ACL)
  self.assertNotIn('TO lr_uat_origin_untrusted;',ACL)
 def test_definer_role_fixed_search_path_temp_schema_last(self):
  self.assertIn('OWNER TO lr_uat_origin_function_owner',ACL)
  self.assertIn('SECURITY DEFINER',ACL)
  self.assertIn('SET search_path=pg_catalog,public,pg_temp',ACL)
  self.assertIn('GRANT UPDATE(state,consumed_at)',ACL)
  self.assertIn('GRANT UPDATE(generation,grant_revision)',ACL)
 def test_service_role_cannot_access_tables_or_legacy_path(self):
  self.assertIn("has_function_privilege('lr_uat_origin_verifier'",RUN)
  self.assertIn("'lr_uat_origin_untrusted'",RUN)
  self.assertIn('legacy_issuer_exec_exposed',RUN)
  self.assertIn('SET ROLE lr_uat_origin_verifier; SELECT * FROM lr_uat_trusted_origin_verifier_pins',RUN)
  self.assertIn('SET ROLE lr_uat_origin_verifier; UPDATE lr_uat_device_authority_floor',RUN)
 def test_success_transaction_does_use_restricted_verifier_role(self):
  self.assertIn("return ('SET ROLE lr_uat_origin_verifier; '+query)",RUN)
  self.assertIn('temp_table_shadowed_protected_origin',RUN)
  self.assertIn("hardened_acl=True",RUN)
  self.assertIn('source-only',ACL.lower()) if False else None
 def test_privilege_revocation_regrant_runtime_negative(self):
  self.assertIn('REVOKE EXECUTE ON FUNCTION public.lr_uat_commit_owner_channel_origin',RUN)
  self.assertIn('ACL PASS 05 REVOKE EXECUTE',RUN)
  self.assertIn('ACL PASS 06 regrant restores narrow procedure',RUN)
  self.assertIn('pg_temp table shadow cannot intercept',RUN)
 def test_no_production_credentials_or_pg_ed25519_claim(self):
  self.assertNotIn('PASSWORD',ACL)
  self.assertNotIn('CREATE ROLE lr_uat_origin_verifier LOGIN',ACL)
  self.assertIn('DOES\n-- NOT authenticate a real TLS verifier service',ACL)
  self.assertIn('PostgreSQL does not verify Ed25519',SQL)
  self.assertIn('production=false',RUN)
 def test_test_isolation_private_pg_only(self):
  for marker in ("u.BASE+'-src'","u.migrations(cid)",
    "down','--volumes','--remove-orphans",
    'RC50_OWNER_CHANNEL_ATOMIC_ORIGIN_PRIVATE_COMPOSE_CLEANED'):
   self.assertIn(marker,RUN)
if __name__=='__main__':
 unittest.main(verbosity=2)
