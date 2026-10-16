"""Archive-contract regression; no live Docker/PG/Redis in these unit tests."""
import importlib.util
import io
import json
from pathlib import Path
import secrets
import tempfile
import unittest
import zipfile

SCRIPT=Path(__file__).resolve().parents[1]/"portability"/"real_pg_redis_cross_host_uat.py"
spec=importlib.util.spec_from_file_location("rc50_real_db",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class RealDatabaseCrossHostArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix="rc50-real-pg-redis-unit-")
        self.dir=Path(self.tmp.name)
        self.folder=self.dir/("lr_rc50_db_crosshost_"+secrets.token_hex(6))
        self.folder.mkdir(mode=0o700)
        self.manifest,_=m.pack(self.folder,b"PGDMP"+"synthetic-pg-fixture".encode(),
                               b"REDIS"+"synthetic-redis-fixture".encode(),
                               secrets.token_hex(6))
        self.archive=self.folder/"rc50-real-db-synthetic.zip"

    def tearDown(self):
        self.tmp.cleanup()

    def mutate(self,func):
        dest=self.dir/"altered.zip"
        with zipfile.ZipFile(self.archive) as original,zipfile.ZipFile(
                dest,"w",compression=zipfile.ZIP_DEFLATED) as altered:
            for name in original.namelist():
                altered.writestr(name,func(name,original.read(name)))
        return dest

    def test_both_native_binary_signatures_expected_by_contract(self):
        manifest,data=m.verify(self.archive,different_host=False)
        self.assertEqual(set(data),set(m.FILES))
        self.assertEqual(manifest["authWriterFence"],False)
        self.assertEqual(manifest["cutoverAuthorized"],False)

    def test_target_same_host_is_rejected(self):
        with self.assertRaisesRegex(ValueError,"same_physical_host"):
            m.verify(self.archive,different_host=True)

    def test_tampered_pg_dump_is_rejected(self):
        broken=self.mutate(lambda n,v:v+b"X" if n==m.FILES[0] else v)
        with self.assertRaisesRegex(ValueError,"bad_snapshot_sha"):
            m.verify(broken,different_host=False)

    def test_tampered_redis_rdb_is_rejected(self):
        broken=self.mutate(lambda n,v:b"BAD"+v[3:] if n==m.FILES[1] else v)
        with self.assertRaisesRegex(ValueError,"bad_snapshot_sha"):
            m.verify(broken,different_host=False)

    def test_manifest_attempts_to_enable_writer_denied(self):
        def mutation(name,payload):
            if name=="manifest.json":
                d=json.loads(payload);d["authWriterFence"]=True
                return m.canonical(d)
            return payload
        with self.assertRaisesRegex(ValueError,"unsupported_or_unsafe_manifest"):
            m.verify(self.mutate(mutation),different_host=False)

    def test_unrecognized_zip_path_is_denied(self):
        extra=self.dir/"extraneous.zip"
        with zipfile.ZipFile(self.archive) as original,zipfile.ZipFile(
                extra,"w",compression=zipfile.ZIP_DEFLATED) as altered:
            for n in original.namelist():altered.writestr(n,original.read(n))
            altered.writestr("../userfile","unsafe")
        with self.assertRaisesRegex(ValueError,"untrusted_archive_members"):
            m.verify(extra,different_host=False)

    def test_oversized_member_rejected_before_decompression(self):
        oversized=self.mutate(lambda n,v:b"A"*(512*1024+10) if n==m.FILES[1] else v)
        with self.assertRaisesRegex(ValueError,"unsafe_or_oversized_archive_member"):
            m.verify(oversized,different_host=False)

    def test_truncated_pgdump_magic_does_not_pass(self):
        def mutation(n,v):
            return b"oops" if n==m.FILES[0] else v
        out=self.mutate(mutation)
        with self.assertRaisesRegex(ValueError,"bad_snapshot_sha"):
            m.verify(out,different_host=False)

    def test_synthetic_root_must_be_unique_private(self):
        with self.assertRaisesRegex(ValueError,"scratch_must_be_fresh_random_and_private"):
            m.root_dir(self.dir/"prod-services")
        with self.assertRaisesRegex(ValueError,"scratch_must_be_fresh_random_and_private"):
            m.root_dir(self.folder)
        fresh=self.dir/("lr_rc50_db_crosshost_"+secrets.token_hex(6))
        created=m.root_dir(fresh)
        self.assertEqual(created,fresh)
        self.assertEqual(created.stat().st_mode&0o777,0o700)


if __name__=="__main__":
    unittest.main()
