#!/usr/bin/env python3
"""Synthetic-only AES-GCM archive/restore unit tests; no real customer files."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import tempfile
import unittest

MODULE=Path(__file__).resolve().parents[1]/"portability/sealed_synthetic_backup.py"
spec=importlib.util.spec_from_file_location("lr_synthetic_sealed",MODULE)
seal=importlib.util.module_from_spec(spec)
spec.loader.exec_module(seal)

def json_bytes(obj):
    return (json.dumps(obj,sort_keys=True,separators=(",",":"))+"\n").encode()

class SyntheticSealedBackupTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix="lr_rc50_sealed_fixture_")
        self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name)
        self.source=self.base/"source-uat"
        self.source.mkdir(mode=0o700)
        (self.source/seal.MARKER).write_bytes(seal.MARKER_VALUE)
        (self.source/seal.MARKER).chmod(0o600)
        self.key=secrets.token_bytes(32)
        self.payloads={
         "accounts.json":{"accounts":[{"id":"uat-account-simulated","plan":"free"}]},
         "devices.json":{"devices":[{"deviceId":"uat-device-simulated",
            "ownerAccountId":"uat-account-simulated","state":"offline"}]},
         "device-access-grants.json":{"grants":[{"grantId":"uat-grant-revoked",
            "deviceId":"uat-device-simulated","revoked":True,"actor":"uat-agent"},
            {"grantId":"uat-grant-active","deviceId":"uat-device-simulated",
             "revoked":False,"expiresAt":"2026-10-13T03:00:00Z"}]},
         "usage.json":{"usage":[{"accountId":"uat-account-simulated",
            "month":"2026-10","usedCalls":1234,"eventId":"uat-event-00001"}]},
         "enrollment-signer.json":{"syntheticTestOnly":True,
           "fakeKeyReference":"not-a-real-signing-key","publicKey":"TEST_ONLY"}
        }
        for idx,name in enumerate(seal.FILENAMES):
            f=self.source/name
            f.write_bytes(json_bytes(self.payloads[name]))
            f.chmod(0o640 if idx==3 else 0o600)
        self.target=self.base/"restored-uat-destination"

    def test_encrypted_roundtrip_preserves_ids_revocation_quota_and_file_permissions(self):
        archive=seal.seal(self.source,self.key)
        self.assertNotIn(b"uat-account-simulated",archive)
        self.assertNotIn(b"uat-device-simulated",archive)
        self.assertNotIn(b"fakeKeyReference",archive)
        self.assertLess(len(archive),25000)
        info=seal.restore(archive,self.key,self.target)
        self.assertEqual(info["restored"],5)
        self.assertTrue(info["encrypted"])
        for name in seal.FILENAMES:
            a=self.source/name
            b=self.target/name
            self.assertEqual(a.read_bytes(),b.read_bytes(),name)
            self.assertEqual(a.stat().st_mode&0o777,b.stat().st_mode&0o777)
            self.assertEqual(a.stat().st_uid,b.stat().st_uid)
            self.assertEqual(a.stat().st_gid,b.stat().st_gid)
        restored=json.loads((self.target/"device-access-grants.json").read_text())
        self.assertTrue(restored["grants"][0]["revoked"])
        self.assertEqual(restored["grants"][1]["grantId"],"uat-grant-active")
        calls=json.loads((self.target/"usage.json").read_text())["usage"][0]
        self.assertEqual(calls["usedCalls"],1234)
        self.assertEqual(calls["eventId"],"uat-event-00001")

    def test_wrong_key_and_ciphertext_tampering_fail_before_any_restore_writes(self):
        blob=seal.seal(self.source,self.key)
        with self.assertRaisesRegex(seal.SyntheticArchiveDenied,
                                     "synthetic_archive_authentication_failed"):
            seal.restore(blob,secrets.token_bytes(32),self.target)
        self.assertFalse(self.target.exists())
        outer=json.loads(blob)
        raw=bytearray(seal.decode(outer["ciphertext"]))
        raw[-1]^=0x01
        outer["ciphertext"]=seal.encode(raw)
        corrupted=json_bytes(outer)
        with self.assertRaisesRegex(seal.SyntheticArchiveDenied,
                                     "synthetic_archive_authentication_failed"):
            seal.restore(corrupted,self.key,self.target)
        self.assertFalse(self.target.exists())

    def test_rejects_missing_fixture_unexpected_file_and_weak_mode(self):
        archive=seal.seal(self.source,self.key)
        self.assertTrue(archive.startswith(b'{"ciphertext":'))
        (self.source/"usage.json").unlink()
        with self.assertRaisesRegex(seal.SyntheticArchiveDenied,
                                     "unexpected_or_missing_synthetic_file"):
            seal.seal(self.source,self.key)
        (self.source/"usage.json").write_bytes(json_bytes(self.payloads["usage.json"]))
        (self.source/"usage.json").chmod(0o644)
        with self.assertRaisesRegex(seal.SyntheticArchiveDenied,
                                     "unsafe_synthetic_file_mode"):
            seal.seal(self.source,self.key)
        (self.source/"usage.json").chmod(0o600)
        (self.source/"extra-data.json").write_text("{}")
        with self.assertRaisesRegex(seal.SyntheticArchiveDenied,
                                     "unexpected_or_missing_synthetic_file"):
            seal.seal(self.source,self.key)

    def test_symlink_source_and_hardlink_source_both_rejected(self):
        original=self.source/"usage.json"
        other=self.base/"not-part-of-synthetic-fixture.json"
        other.write_text('{"fake":true}')
        original.unlink()
        original.symlink_to(other)
        with self.assertRaisesRegex(seal.SyntheticArchiveDenied,
                                     "synthetic_symlink_hardlink_or_nonfile_denied"):
            seal.seal(self.source,self.key)
        original.unlink()
        os.link(other,original)
        original.chmod(0o600)
        with self.assertRaisesRegex(seal.SyntheticArchiveDenied,
                                     "synthetic_symlink_hardlink_or_nonfile_denied"):
            seal.seal(self.source,self.key)

    def test_never_overwrites_destination_even_with_correct_key(self):
        blob=seal.seal(self.source,self.key)
        self.target.mkdir()
        (self.target/"do-not-touch").write_text("SAFE")
        with self.assertRaisesRegex(seal.SyntheticArchiveDenied,
                                     "synthetic_restore_destination_already_exists"):
            seal.restore(blob,self.key,self.target)
        self.assertEqual((self.target/"do-not-touch").read_text(),"SAFE")
        self.assertFalse((self.target/"accounts.json").exists())

    def test_denies_unmarked_source_or_arbitrary_target_name(self):
        blob=seal.seal(self.source,self.key)
        with self.assertRaisesRegex(seal.SyntheticArchiveDenied,
                                     "synthetic_restore_destination_name_denied"):
            seal.restore(blob,self.key,self.base/"production-state")
        (self.source/seal.MARKER).unlink()
        with self.assertRaisesRegex(seal.SyntheticArchiveDenied,
                                     "synthetic_marker_not_plain_file"):
            seal.seal(self.source,self.key)

    def test_tampered_manifest_with_authenticated_ciphertext_still_fails(self):
        blob=seal.seal(self.source,self.key)
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        outer=json.loads(blob)
        plain=AESGCM(self.key).decrypt(seal.decode(outer["nonce"]),
                                        seal.decode(outer["ciphertext"]),seal.AAD)
        manifest=json.loads(plain)
        manifest["entries"][0]["name"]="../unsafe.json"
        altered=json_bytes(manifest)
        outer["ciphertext"]=seal.encode(AESGCM(self.key).encrypt(
            seal.decode(outer["nonce"]),altered,seal.AAD))
        with self.assertRaisesRegex(seal.SyntheticArchiveDenied,
                                     "synthetic_path_or_manifest_tamper"):
            seal.restore(json_bytes(outer),self.key,self.target)
        self.assertFalse(self.target.exists())

if __name__=="__main__":
    unittest.main(verbosity=2)
