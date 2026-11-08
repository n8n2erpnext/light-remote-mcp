#!/usr/bin/env python3
"""Source-only triage coverage, does NOT certify mutation interception."""
import json
from collections import Counter
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]/'portability'
CENSUS=json.loads((ROOT/'mutating-route-census.json').read_text(encoding='utf8'))
TRIAGE=json.loads((ROOT/'route-fence-triage.json').read_text(encoding='utf8'))

class TriageGuard(unittest.TestCase):
 def test_scope_never_claims_real_gate(self):
  self.assertEqual(TRIAGE['status'],'GAPS_IDENTIFIED_NOT_WIRED')
  self.assertFalse(TRIAGE['globalFenceComplete'])
  self.assertFalse(TRIAGE['productionCutoverAuthorized'])
  self.assertIn('not a list of distinct',TRIAGE['method'])
 def test_every_candidate_source_grouped_once(self):
  rows=TRIAGE['routeGroups']
  sources=[item['source'] for item in rows]
  candidates={s['source'] for s in CENSUS['candidate_mutating_route_sites']}
  self.assertEqual(set(sources),candidates)
  self.assertEqual(len(sources),len(set(sources)))
  self.assertEqual(len(sources),11)
 def test_all_candidate_occurrences_remain_unreviewed(self):
  total=Counter(x['source'] for x in CENSUS['candidate_mutating_route_sites'])
  self.assertEqual(sum(total.values()),163)
  for row in TRIAGE['routeGroups']:
   self.assertGreater(total[row['source']],0)
   self.assertEqual(row['classification'],'MANUAL_PER_ENDPOINT_REVIEW_PENDING')
   self.assertFalse(row['guardInstalled'])
   self.assertIn(row['priority'],['critical','high'])
   self.assertGreater(len(row['requiredGate']),16)
 def test_critical_mutators_persist_in_triage(self):
  group={row['authorityPlane']:row for row in TRIAGE['routeGroups']}
  for key in ('account_identity_grants_team','device_enrollment_channel_dispatch',
    'direct_operations','oauth_token_lifecycle','billing_webhook',
    'admin_gateway_entitlement_config','mcp_entrypoint'):
   self.assertEqual(group[key]['priority'],'critical')
 def test_background_sources_must_be_manual(self):
  self.assertEqual(TRIAGE['backgroundPolicy']['status'],'PENDING_MANUAL_REVIEW')
  self.assertTrue(set(TRIAGE['backgroundPolicy']['mustInclude']) >= {
   'operator-host/fleet-router.mjs','plugin-server/support-backoffice.mjs',
   'plugin-server/oauth.mjs'
  })
  self.assertGreaterEqual(CENSUS['stats']['candidate_background_sites'],20)
 def test_acceptance_requires_agent_and_owner(self):
  needs=TRIAGE['criticalAcceptance']
  self.assertIn('owner_authorized_epoch',needs)
  self.assertIn('agent_signed_epoch_and_grant_proof',needs)
  self.assertIn('deny_stale_before_physical_action',needs)
  self.assertIn('independent_nonproduction_restore',needs)

if __name__=='__main__':
 unittest.main(verbosity=2)
