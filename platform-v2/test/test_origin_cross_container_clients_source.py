#!/usr/bin/env python3
"""Offline guards for separate, synthetic-only PostgreSQL network clients."""
from pathlib import Path
import ast
import unittest

ROOT=Path(__file__).resolve().parents[1]
SRC=(ROOT/'portability/verify_owner_channel_origin_transaction_pg_uat.py').read_text()
READER=(ROOT/'portability/owner_channel_origin_reader_acl_uat.sql').read_text()

class IsolatedOriginClients(unittest.TestCase):
 def test_01_parse(self):
  ast.parse(SRC)
 def test_02_explicit_disposable_project(self):
  self.assertIn("lr-uat-move-[0-9a-f]{10}-src",SRC)
  self.assertIn("--confirm-synthetic-only",SRC)
  self.assertIn("client_network_must_be_internal",SRC)
  self.assertIn("unexpected_pg_network_name",SRC)
 def test_03_separate_clients(self):
  self.assertIn("EXTERNAL_READER=start_isolated_db_client(project,cid,'reader')",SRC)
  self.assertIn("EXTERNAL_WRITER=start_isolated_db_client(project,cid,'writer')",SRC)
  self.assertIn("credential_container_overlap",SRC)
 def test_04_no_public_ports_or_privileged_execution(self):
  for mark in ["'--read-only'","'--cap-drop','ALL'","'no-new-privileges'",
               "'--pids-limit'","'--memory'","'--network',name",
               "'client_host_port_published'","'client_privileged'"]:
   self.assertIn(mark,SRC)
  self.assertNotIn("'--privileged'",SRC)
  self.assertNotIn("'--publish'",SRC)
 def test_05_db_dns_and_scram(self):
  self.assertIn("-h postgres",SRC)
  self.assertIn("wrong_test_password",SRC)
  self.assertIn("password authentication failed",SRC)
  self.assertIn("lr_uat_origin_reader_login",SRC)
  self.assertIn("lr_uat_origin_service_login",SRC)
 def test_06_no_reader_writer_password_interchange(self):
  self.assertIn("EXTERNAL_READER or pg",SRC)
  self.assertIn("EXTERNAL_WRITER or pg",SRC)
  self.assertIn("credential-isolated",SRC)
  self.assertIn("test ! -e /tmp/lr_rc50_origin_login_secret",SRC)
  self.assertIn("test ! -e /tmp/lr_rc50_origin_reader_secret",SRC)
 def test_07_negative_outage_and_no_fallback(self):
  self.assertIn("'stopped_reader_implicitly_fell_back'",SRC)
  self.assertIn("'reader_outage_killed_independent_writer'",SRC)
  self.assertIn("u.docker('stop','-t','1',EXTERNAL_READER",SRC)
 def test_08_deterministic_cleanup(self):
  self.assertIn("project+'-'+role+'-psql'",SRC)
  self.assertIn("u.docker('rm','-f'",SRC)
  self.assertIn("u.compose(project,env,'down','--volumes','--remove-orphans'",SRC)
  self.assertIn("EXTERNAL_READER=EXTERNAL_WRITER=EXTERNAL_VERIFIER=None",SRC)
 def test_09_distinct_non_loopback_origin_at_database(self):
  self.assertIn("host(inet_client_addr())",SRC)
  self.assertIn("ipaddress.ip_address(reader_addr).is_loopback",SRC)
  self.assertIn("reader_writer_share_same_net_identity",SRC)
  self.assertIn("external_client_uses_loopback_trust_route",SRC)
 def test_10_acl_still_read_only(self):
  self.assertIn("CREATE ROLE lr_uat_origin_reader_login LOGIN NOINHERIT",READER)
  self.assertIn("TO lr_uat_origin_reader_login",READER)
  self.assertIn("REVOKE ALL ON FUNCTION",READER)
  self.assertNotIn("GRANT UPDATE",READER)
  self.assertNotIn("GRANT INSERT",READER)

if __name__=='__main__':
 unittest.main(verbosity=2)
