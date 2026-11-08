#!/usr/bin/env python3
"""Source-level guard for rc50 disposable-only owner/channel context reader."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / 'portability/owner_channel_origin_reader_acl_uat.sql').read_text()
RUNNER = (ROOT / 'portability/verify_owner_channel_origin_transaction_pg_uat.py').read_text()

class ReaderBoundary(unittest.TestCase):
    def test_01_isolated_roles(self):
        self.assertIn('lr_uat_origin_context_owner NOLOGIN NOINHERIT', SQL)
        self.assertIn('lr_uat_origin_reader_login LOGIN NOINHERIT', SQL)
        self.assertNotIn('SUPERUSER', SQL)
        self.assertNotIn('BYPASSRLS', SQL)

    def test_02_explicit_read_only_grants(self):
        self.assertIn('GRANT SELECT ON', SQL)
        self.assertIn('TO lr_uat_origin_context_owner', SQL)
        self.assertNotIn('GRANT INSERT', SQL)
        self.assertNotIn('GRANT UPDATE', SQL)
        self.assertNotIn('GRANT DELETE', SQL)
        self.assertNotIn('GRANT SELECT ON', SQL.split('TO lr_uat_origin_context_owner')[-1])

    def test_03_secdef_protected_entrypoint(self):
        self.assertIn('lr_uat_get_owner_channel_context', SQL)
        self.assertIn('SECURITY DEFINER', SQL)
        self.assertIn('SET search_path=pg_catalog,public,pg_temp', SQL)
        self.assertIn('REVOKE ALL ON FUNCTION', SQL)
        self.assertIn('TO lr_uat_origin_reader_login', SQL)

    def test_04_signed_request_and_nonce_bound(self):
        self.assertIn('p_request_id', SQL)
        self.assertIn('p_nonce_sha256', SQL)
        self.assertIn('old.owner_decision_nonce_sha256=p_nonce_sha256', SQL)
        self.assertIn('i.proposed_grant_id', SQL)
        self.assertIn('ss.revoked_at IS NULL', SQL)
        self.assertIn("pins.state='active'", SQL)
        self.assertIn("r.request_id=p_request_id", SQL)

    def test_05_authenticated_reader_not_admin(self):
        self.assertIn('READER_SQL=', RUNNER)
        self.assertIn('setup_synthetic_reader_login(pg)', RUNNER)
        self.assertIn('reader=True', RUNNER)
        self.assertIn("lr_uat_origin_reader_login", RUNNER)
        self.assertIn("return json.loads(data)", RUNNER)
        self.assertIn("data=READER_SQL", RUNNER)

    def test_06_scratch_auth_denials(self):
        self.assertIn('reader_direct_trust_pin_read', RUNNER)
        self.assertIn('reader_direct_ab_mutation', RUNNER)
        self.assertIn('reader_wrong_password_accepted', RUNNER)
        self.assertIn('reader_escalated_to_issuer', RUNNER)
        self.assertIn('disposable', SQL.lower())

    def test_07_no_production_wiring(self):
        self.assertIn('--confirm-synthetic-only', RUNNER)
        self.assertIn('lr-uat-move-', RUNNER)
        self.assertNotIn('operator-host/', SQL)
        self.assertNotIn('plugin-server/', SQL)
        self.assertNotIn('CREATE EXTENSION', SQL)

if __name__ == '__main__':
    unittest.main(verbosity=2)
