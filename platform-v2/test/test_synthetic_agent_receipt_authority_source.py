#!/usr/bin/env python3
"""Read-only fail-closed source markers for the Linux fake Agent receipt worker."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
UAT=ROOT/'portability'
WORKER=(UAT/'synthetic-agent-receipt-authority-worker.mjs').read_text()
TEST=(UAT/'test_synthetic_agent_receipt_authority.mjs').read_text()
REAL=(ROOT.parent/'device-agent/operator-agent.mjs').read_text()

class ReceiptAuthoritySourceGuard(unittest.TestCase):
    def test_trusted_fixture_only_and_not_real_agent_import(self):
        self.assertIn("lr-rc50-agent-authority-",WORKER)
        self.assertIn("path.dirname(root) !== path.resolve(os.tmpdir())",WORKER)
        self.assertNotIn("synthetic-agent-receipt-authority-worker.mjs",REAL)
        self.assertNotIn("rc50_agent_receipt_decision.mjs",REAL)
        self.assertIn("physicalExecutionAuthorized:false",WORKER)
    def test_kernel_lock_supervisor_and_inherited_fd_identity(self):
        for token in ["'-x','-n','-E','77','-F',lock",'fs.fstatSync(3)','inherited.ino !== lock.ino']:
            self.assertIn(token,WORKER+TEST)
        self.assertIn("second worker improperly entered protected receipt",TEST)
    def test_durable_atomic_file_and_directory_fsync(self):
        for token in ['fs.openSync(tmp,\'wx\',0o600)','fs.writeSync(fd','fs.fsyncSync(fd)','fs.renameSync(tmp,file)',
                      'fs.constants.O_DIRECTORY','fs.fsyncSync(d)']:
            self.assertIn(token,WORKER)
    def test_no_replay_after_inflight_crash(self):
        for token in ['SIGKILL','uncertain','COMMAND_NOT_SAFE_TO_START','CRASH_RECOVERY_REQUIRES_DURABLE_RECONCILIATION']:
            self.assertIn(token,WORKER+TEST)
    def test_symlink_inode_mode_and_hardlink_checks(self):
        for token in ['fs.lstatSync(file)','stat.nlink !== 1','stat.isSymbolicLink()',
                      '(stat.mode & 0o077) !== 0','inherited.dev !== lock.dev']:
            self.assertIn(token,WORKER)
    def test_real_native_interfaces_not_used(self):
        for bad in ['NativeProcessRegistry','NativeTerminalRegistry','NativeDesktopBridge',
                    'executeCommand(','executeNativeFs(','Paddle','/device-channel/']:
            self.assertNotIn(bad,WORKER)
    def test_lock_not_unlinked_by_worker(self):
        self.assertNotIn("fs.rmSync(path.join(root,'authority.lock')",WORKER)
        self.assertIn("fs.statSync(lock).ino,inode",TEST)

if __name__=='__main__':
    unittest.main(verbosity=2)
