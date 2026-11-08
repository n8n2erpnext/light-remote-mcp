"""Fail-closed tests for cross-host synthetic-only state archive, not P0 release."""
import importlib.util
import io
import json
from pathlib import Path
import secrets
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "portability" / "cross_host_synthetic_state_uat.py"
spec = importlib.util.spec_from_file_location("rc50_crosshost", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class CrossHostSyntheticUAT(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rc50-crosshost-tests-")
        self.parent = Path(self.temp.name)
        self.origin = self.parent / ("lr_rc50_crosshost_" + secrets.token_hex(6))
        self.destination = self.parent / ("lr_rc50_crosshost_" + secrets.token_hex(6))
        self.result = mod.source(self.origin)
        self.archive = Path(self.result["archive"])

    def tearDown(self):
        self.temp.cleanup()

    def rebuild(self, transform):
        output = io.BytesIO()
        with zipfile.ZipFile(self.archive) as original, zipfile.ZipFile(
                output, "w", compression=zipfile.ZIP_DEFLATED) as new:
            for name in original.namelist():
                new.writestr(name, transform(name, original.read(name)))
        tampered = self.parent / "modified.zip"
        tampered.write_bytes(output.getvalue())
        return tampered

    def test_private_snapshot_manifest_and_archive_hashes(self):
        report = mod.verify_archive(self.archive)
        self.assertEqual(report["files"], 13)
        self.assertEqual(report["archiveSha256"], self.result["archiveSha256"])
        self.assertFalse(report["cutoverAuthorized"])
        self.assertFalse(report["globalWriterFenceProven"])

    def test_same_host_restore_denied_and_never_activates(self):
        with self.assertRaisesRegex(ValueError, "source_and_target_same_host"):
            mod.restore(self.destination, self.archive)
        with self.assertRaisesRegex(ValueError, "authenticated_old_writer_fence_absent"):
            mod.deny("authenticated_old_writer_fence_absent")

    def test_private_restore_and_rollback_never_create_writer(self):
        restored = mod.restore(self.destination, self.archive, cross_host=False)
        self.assertEqual(restored["files"], 13)
        stage = self.destination / "restored-state"
        for name in mod.FILES:
            self.assertEqual((stage / name).read_bytes(),
                             (self.origin / "state" / name).read_bytes())
        self.assertFalse(restored["destinationWriterActive"])
        self.assertTrue((self.destination / "activation-denied.json").exists())
        rolled = mod.rollback(self.destination)
        self.assertTrue(rolled["quarantined"])
        self.assertFalse((self.destination / "restored-state").exists())
        self.assertEqual(
            len(list((self.destination / "rolled-back-restored-state").rglob("*.json"))),
            13)
        with self.assertRaisesRegex(ValueError, "rollback_unsafe_target"):
            mod.rollback(self.destination)

    def test_content_tampering_cannot_pass_hash(self):
        def alter(name, payload):
            return payload + b"\x00" if name == "state/operator/accounts.json" else payload
        with self.assertRaisesRegex(ValueError, "payload_integrity_mismatch"):
            mod.verify_archive(self.rebuild(alter))

    def test_fake_or_missing_freeze_cannot_pass(self):
        def alter(name, payload):
            if name == "source-freeze.json":
                value = json.loads(payload)
                value["globallyAuthenticatedWriterFence"] = True
                return mod.canonical(value)
            return payload
        with self.assertRaisesRegex(ValueError, "freeze_mismatch"):
            mod.verify_archive(self.rebuild(alter))

    def test_archive_extra_traversal_member_is_denied(self):
        out = self.parent / "evil.zip"
        with zipfile.ZipFile(self.archive) as source, zipfile.ZipFile(
                out, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for entry in source.namelist():
                target.writestr(entry, source.read(entry))
            target.writestr("../../owner.conf", b"malicious")
        with self.assertRaisesRegex(ValueError, "missing_extra_or_duplicate"):
            mod.verify_archive(out)

    def test_unsafe_root_and_marker_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "invalid_private_scratch_name"):
            mod.source(self.parent / "not_a_random_uat_name")
        valid = self.parent / ("lr_rc50_crosshost_" + secrets.token_hex(6))
        valid.mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, "missing_synthetic_only_marker"):
            mod.rollback(valid)

    def test_rollback_denies_modified_activation_state(self):
        mod.restore(self.destination, self.archive, cross_host=False)
        (self.destination / "activation-denied.json").write_bytes(
            mod.canonical({"targetWriterActive": True}))
        with self.assertRaisesRegex(ValueError, "rollback_activation_state_untrusted"):
            mod.rollback(self.destination)


if __name__ == "__main__":
    unittest.main()
