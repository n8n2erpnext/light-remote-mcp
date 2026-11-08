#!/usr/bin/env python3
"""Fail-closed source-only audit of the locked fake signed receipt experiment."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
PORT=ROOT/'portability'
WORKER=(PORT/'synthetic-agent-receipt-authority-worker.mjs').read_text()
CRYPTO=(PORT/'synthetic-signed-agent-gate.mjs').read_text()
TEST=(PORT/'test_synthetic_signed_receipt_authority.mjs').read_text()
REAL=(ROOT.parent/'device-agent/operator-agent.mjs').read_text()

class SignedReceiptAuthoritySourceGuards(unittest.TestCase):
    def test_real_agent_not_modified_to_import_experimental_authority(self):
        self.assertNotIn('synthetic-agent-receipt-authority-worker.mjs',REAL)
        self.assertNotIn('synthetic-signed-agent-gate.mjs',REAL)
        self.assertNotIn('rc50_agent_receipt_decision.mjs',REAL)
        self.assertIn('lr-rc50-agent-authority-',WORKER)
    def test_pin_set_once_from_canonical_spki_inside_private_fixture(self):
        for marker in [
          "request.operation==='initialize_signed'",
          "if(current!==null) refuse('fixture_already_initialized')",
          "pub.asymmetricKeyType!=='ed25519'",
          "canonical!==request.verifierSpki",
          "signedVerifierSpki:canonical",
          "signedVerifierSha:syntheticKeyFingerprint(pub)"
        ]:self.assertIn(marker,WORKER)
    def test_all_signed_envelopes_cryptographically_verified_under_lock(self):
        for marker in [
          'verifySyntheticEpochPacket(request.signedEpoch,pub)',
          'verifySyntheticCommandPacket(request.signedCommand,pub)',
          "crypto.createPublicKey({key:Buffer.from(current.signedVerifierSpki,'base64url')",
          'syntheticKeyFingerprint(pub)!==current.signedVerifierSha',
          "crypto.verify(null,bytes(type,fields,packet.payload),key"
        ]:self.assertIn(marker,WORKER+CRYPTO)
    def test_no_caller_clock_override(self):
        self.assertIn('const now=Date.now()',WORKER)
        self.assertNotIn('const now=request.nowMs',WORKER)
        self.assertIn('caller-supplied clock cannot revive already expired signed command',TEST)
    def test_signed_epoch_grant_and_command_digest_are_bound(self):
        for marker in [
          'epoch.grantRevision<current.grantRevision',
          'digest!==current.signedEpochDigest',
          'epoch.generation!==current.generation',
          'command.grantRevision!==epoch.grantRevision',
          'command.epochDigest!==digest',
          'digest:syntheticSignedCommandDigest(command)'
        ]:self.assertIn(marker,WORKER)
    def test_unsigned_fake_proof_cannot_mutate_pinned_root(self):
        self.assertIn("!request.operation?.startsWith('signed_')",WORKER)
        self.assertIn('unsigned_operation_on_pinned_authority',WORKER)
        self.assertIn('unsigned internal fake flags cannot modify pinned authority',TEST)
    def test_kernel_lock_and_file_and_directory_fsync_still_present(self):
        for marker in [
          'fs.fstatSync(3)', 'inherited.ino !== lock.ino',
          'fs.fsyncSync(fd)','fs.renameSync(tmp,file)','fs.fsyncSync(d)',
          "'-x','-n','-E','77','-F',lock",'an independent kernel process blocks two signed receipt writers'
        ]:self.assertIn(marker,WORKER+TEST)
    def test_never_calls_real_os_actions_or_exports_private_signer(self):
        for forbidden in ['executeCommand(','NATIVE_TERMINALS','NATIVE_PROCESSES',
                          'executeNativeFs(','requestLocalUpdate(','LIGHT_SCP','Paddle']:
            self.assertNotIn(forbidden,WORKER)
        self.assertIn("crypto.generateKeyPairSync('ed25519')",TEST)
        self.assertNotIn('privateKey.export(',TEST)
        self.assertIn('physicalExecutionAuthorized:false',WORKER)
    def test_missing_revocation_authority_not_misrepresented(self):
        self.assertNotIn('ownerAuthorized:true',WORKER)
        self.assertNotIn('productionCutoverAuthorized:true',WORKER)
        self.assertIn("request.operation==='signed_recover'",WORKER)

if __name__=='__main__':
    unittest.main(verbosity=2)
