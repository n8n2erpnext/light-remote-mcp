"""Regression for the official PostgreSQL image's two startup stages."""
import importlib.util
import pathlib
import subprocess
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('unified_dev',pathlib.Path(__file__).with_name('dev.py'))
dev=importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class PostgreSQLReadinessTest(unittest.TestCase):
    def test_temporary_unix_server_is_not_final_readiness(self):
        stage={'value':'bootstrap'}
        stages=iter(('shutdown','final'))

        def probe(*args,**kwargs):
            # Bootstrap accepts the default Unix-socket probe, then that
            # socket disappears. Only the final postmaster listens on TCP.
            tcp='-h' in args and args[args.index('-h')+1]=='127.0.0.1'
            accepting=stage['value']=='final' or (stage['value']=='bootstrap' and not tcp)
            return subprocess.CompletedProcess(args,0 if accepting else 2,stdout=b'')

        with patch.object(dev,'docker',side_effect=probe),patch.object(dev.time,'sleep',side_effect=lambda _:stage.update(value=next(stages))):
            dev.wait_for_postgres('owned-fixture-pg',attempts=3,interval=0)
        self.assertEqual(stage['value'],'final','A bootstrap socket is not permission to execute initialization SQL')

    def test_unavailable_database_fails_before_sql(self):
        with patch.object(dev,'docker',return_value=subprocess.CompletedProcess([],2,stdout=b'')),patch.object(dev.time,'sleep'):
            with self.assertRaisesRegex(RuntimeError,'final TCP server did not start'):
                dev.wait_for_postgres('owned-fixture-pg',attempts=2,interval=0)


if __name__=='__main__':unittest.main()
