#!/usr/bin/env node
/**
 * SYNTHETIC UAT ONLY. Child process launched by a trusted fixture supervisor as:
 *   flock -x -n -E 77 -F <absolute-fixture-root>/authority.lock node <this> <root> <json-base64url>
 * Does not receive or execute real commands. Never imported by device-agent.
 * The inherited fd3 check binds the lock inode; it is not independent
 * proof of kernel lock ownership. Test supervisor verifies kernel contention.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  makeEmptySyntheticSnapshot, evaluateSyntheticReceiptDecision,
} from './rc50_agent_receipt_decision.mjs';

const [root, encoded] = process.argv.slice(2);
function refuse(reason) {
  process.stderr.write('RC50_AUTHORITY_REFUSED ' + reason + '\n');
  process.exit(22);
}
function requireSafeFixture() {
  if (typeof root !== 'string' || !path.isAbsolute(root) ||
      path.resolve(root) !== root || path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith('lr-rc50-agent-authority-')) refuse('fixture_root_invalid');
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))
    refuse('fixture_permissions_invalid');
  const lock = fs.lstatSync(path.join(root,'authority.lock'));
  if (!lock.isFile() || lock.isSymbolicLink() || lock.nlink !== 1 ||
      (lock.mode & 0o077) !== 0 || (process.getuid && lock.uid !== process.getuid()))
    refuse('lock_inode_invalid');
  let inherited;
  try { inherited = fs.fstatSync(3); } catch { refuse('inherited_fd_missing'); }
  if (!inherited.isFile() || inherited.dev !== lock.dev || inherited.ino !== lock.ino)
    refuse('inherited_inode_mismatch');
}
function readSnapshot() {
  const file = path.join(root, 'authority.json');
  let stat;
  try { stat=fs.lstatSync(file); }
  catch (error) {
    if (error?.code==='ENOENT') return null;
    refuse('receipt_stat_failed');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      stat.size > 1048576 || (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) refuse('receipt_file_invalid');
  let text;
  try { text = fs.readFileSync(file,'utf8'); } catch { refuse('receipt_unreadable'); }
  try { return JSON.parse(text); } catch { refuse('receipt_corrupt'); }
}
function persist(data) {
  const file = path.join(root,'authority.json');
  const tmp = path.join(root,'.authority.' + process.pid + '.' +
    crypto.randomBytes(8).toString('hex') + '.tmp');
  let fd = null;
  try {
    fd = fs.openSync(tmp,'wx',0o600);
    const bytes = Buffer.from(JSON.stringify(data) + '\n');
    if (bytes.length > 1048576) refuse('receipt_too_large');
    let at=0;
    while (at < bytes.length) {
      const n=fs.writeSync(fd,bytes,at,bytes.length-at);
      if (n <= 0) throw Error('short_write');
      at+=n;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=null;
    fs.renameSync(tmp,file);
    const d=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
  } catch (error) {
    refuse('durability_failed_' + String(error?.code || error?.message || 'unknown').slice(0,45));
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch {}
    try { fs.rmSync(tmp,{force:true}); } catch {}
  }
}
function pause(ms) {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 1200) refuse('invalid_pause');
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared,0,0,ms);
}
try {
  requireSafeFixture();
  if (typeof encoded!=='string' || encoded.length>8192 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    refuse('invalid_request');
  const request=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
  if (!request || typeof request!=='object' || Array.isArray(request))
    refuse('invalid_request_shape');
  const current=readSnapshot();
  if (request.operation==='initialize') {
    if (current !== null) refuse('fixture_already_initialized');
    persist(makeEmptySyntheticSnapshot());
    process.stdout.write(JSON.stringify({decision:'INITIALIZED',physicalExecutionAuthorized:false})+'\n');
  } else {
    if (current===null) refuse('receipt_snapshot_missing');
    const decision=evaluateSyntheticReceiptDecision(current,{
      ...request,lockState:'acquired',storageHealth:'healthy'
    });
    if (decision.decision==='DENY') {
      process.stdout.write(JSON.stringify(decision)+'\n');
      process.exitCode=24;
    } else {
      if (decision.decision==='PROPOSE_DURABLE_MUTATION') persist(decision.next);
      if (request.delayMs !== undefined) {
        process.stdout.write('RC50_AUTHORITY_TEST_LOCK_HELD\n');
        pause(request.delayMs);
      }
      process.stdout.write(JSON.stringify({
        decision:decision.decision,reason:decision.reason,
        generation:decision.next?.generation ?? current.generation,
        physicalExecutionAuthorized:false, fsyncPersisted:decision.decision==='PROPOSE_DURABLE_MUTATION'
      })+'\n');
      if (request.crashAfterPersist===true && request.operation==='start_fake')
        process.kill(process.pid,'SIGKILL'); // only fake STARTED receipt, no OS action
    }
  }
} catch (error) {
  refuse('worker_error_' + String(error?.message || error).replace(/\s+/g,'_').slice(0,65));
}
