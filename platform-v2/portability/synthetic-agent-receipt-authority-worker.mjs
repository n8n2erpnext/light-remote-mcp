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
  validSyntheticReceiptSnapshot,
} from './rc50_agent_receipt_decision.mjs';
import {
  verifySyntheticEpochPacket, verifySyntheticCommandPacket,
  syntheticSignedEpochDigest, syntheticSignedCommandDigest,
  syntheticKeyFingerprint,
} from './synthetic-signed-agent-gate.mjs';
import {
  evaluateFakeAbGrantLease,makeFakeDeviceGrantState,
  validFakeDeviceGrantState,fakePublicKeyFingerprint,
} from './synthetic-ab-grant-lease.mjs';

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
function readPinnedPublicKey(spki) {
  if(typeof spki!=='string'||!/^[A-Za-z0-9_-]{40,700}$/.test(spki))
    throw Error('invalid_fixture_key');
  const pub=crypto.createPublicKey({
    key:Buffer.from(spki,'base64url'),format:'der',type:'spki'
  });
  if(pub.asymmetricKeyType!=='ed25519'||
    pub.export({format:'der',type:'spki'}).toString('base64url')!==spki)
    throw Error('noncanonical_fixture_key');
  return pub;
}
const boundDeny=reason=>Object.freeze({decision:'DENY',reason,physicalExecutionAuthorized:false});
function checkedBoundRequest(current,request) {
  // AB revocation high-watermark AND receipt state must be committed together
  // under the SAME held OS lock. This UAT never performs real physical work.
  const grant=current.grantState;
  if(!grant||typeof grant!=='object'||!current.signedVerifierSpki)
    return boundDeny('BOUND_GRANT_STATE_MISSING');
  if(!validFakeDeviceGrantState(grant)||
     !validSyntheticReceiptSnapshot(current) ||
     current.generation!==grant.floorGeneration ||
     current.grantRevision!==grant.floorGrantRevision ||
     (current.generation>0&&!/^[a-f0-9]{64}$/.test(current.signedEpochDigest||'')))
    return boundDeny('BOUND_DURABLE_STATE_CORRUPT');
  let wall,issuer,writer;
  try {
    wall=readPinnedPublicKey(current.wallVerifierSpki);
    issuer=readPinnedPublicKey(current.leaseVerifierSpki);
    writer=readPinnedPublicKey(current.signedVerifierSpki);
  }catch{return boundDeny('BOUND_ISSUER_KEY_INVALID');}
  if(fakePublicKeyFingerprint(wall)!==grant.wallPin||
     fakePublicKeyFingerprint(issuer)!==grant.issuerPin ||
     syntheticKeyFingerprint(writer)!==current.signedVerifierSha ||
     current.accountId!==grant.accountId ||
     current.deviceId!==grant.deviceId ||current.agentId!==grant.agentId)
    return boundDeny('BOUND_IDENTITY_OR_ISSUER_PIN_MISMATCH');
  const now=Date.now(); // local worker clock, never request.nowMs
  if(request.operation==='bound_recover'){
    const r=checkedSignedRequest(current,{operation:'signed_recover'});
    return r.decision==='PROPOSE_DURABLE_MUTATION'?
      {...r,next:{...r.next,grantState:grant}}:r;
  }
  if(request.operation==='bound_revoke'){
    const r=evaluateFakeAbGrantLease(grant,{
      operation:'revoke',signedRevocation:request.signedRevocation
    },{wallPublicKey:wall,issuerPublicKey:issuer,timeSource:()=>now});
    if(r.decision!=='PROPOSE_DURABLE_STATE')return r;
    const receipts=Object.fromEntries(Object.entries(current.receipts).map(([id,row])=>[
      id,{...row,status:row.status==='accepted'?'fenced':
        row.status==='started'?'uncertain':row.status}
    ]));
    return {decision:'PROPOSE_DURABLE_MUTATION',
      reason:'BOUND_REVOCATION_DURABLE_FENCE',physicalExecutionAuthorized:false,
      next:{...current,grantState:r.next,receipts}};
  }
  if(!['bound_accept','bound_start','bound_complete'].includes(request.operation))
    return boundDeny('UNKNOWN_BOUND_OPERATION');
  // Check signed epoch/command against both pinned cryptographic issuer chains;
  // a forged Wall approval, lease, command or writer epoch cannot pass this gate.
  let signedEpoch,signedCommand;
  try{
    const pub=readPinnedPublicKey(current.signedVerifierSpki);
    signedEpoch=verifySyntheticEpochPacket(request.signedEpoch,pub);
    signedCommand=verifySyntheticCommandPacket(request.signedCommand,pub);
  }catch{return boundDeny('BOUND_SIGNED_EPOCH_OR_COMMAND_INVALID');}
  const lease=request.signedLease?.payload;
  if(!lease||lease.kind!=='fake_lease' ||
     signedEpoch.accountId!==grant.accountId||
     signedEpoch.deviceId!==grant.deviceId||
     signedEpoch.agentId!==grant.agentId||
     signedEpoch.generation!==lease.generation||
     signedEpoch.grantRevision!==lease.grantRevision||
     signedCommand.generation!==lease.generation||
     signedCommand.grantRevision!==lease.grantRevision)
    return boundDeny('BOUND_WRITER_EPOCH_DOES_NOT_MATCH_LEASE');
  const accepting=request.operation==='bound_accept';
  const decision=evaluateFakeAbGrantLease(grant,{
    operation:accepting?'accept':'check',
    signedApproval:request.signedApproval,signedLease:request.signedLease
  },{wallPublicKey:wall,issuerPublicKey:issuer,timeSource:()=>now});
  if(decision.decision!=='PROPOSE_DURABLE_STATE')return decision;
  const nextWithGrant={...current,grantState:decision.next};
  if(accepting){
    const advance=checkedSignedRequest(nextWithGrant,{
      operation:'signed_epoch',signedEpoch:request.signedEpoch
    });
    if(!['PROPOSE_DURABLE_MUTATION','NOOP'].includes(advance.decision))return advance;
    const afterEpoch=advance.decision==='PROPOSE_DURABLE_MUTATION'?
      advance.next:nextWithGrant;
    const accepted=checkedSignedRequest(afterEpoch,{
      operation:'signed_accept',signedEpoch:request.signedEpoch,
      signedCommand:request.signedCommand
    });
    if(accepted.decision==='DENY')return accepted;
    if(accepted.decision==='NOOP')return {
      decision:'NOOP',reason:'BOUND_DUPLICATE_RECEIPT',
      physicalExecutionAuthorized:false};
    return {decision:'PROPOSE_DURABLE_MUTATION',
      reason:'BOUND_APPROVAL_EPOCH_AND_RECEIPT_PERSISTED',
      physicalExecutionAuthorized:false,
      next:{...accepted.next,grantState:decision.next}};
  }
  const receipt=checkedSignedRequest(nextWithGrant,{
    operation:request.operation==='bound_start'?'signed_start':'signed_complete',
    signedEpoch:request.signedEpoch,signedCommand:request.signedCommand
  });
  if(receipt.decision!=='PROPOSE_DURABLE_MUTATION')return receipt;
  return {decision:'PROPOSE_DURABLE_MUTATION',
    reason:request.operation==='bound_start'?'BOUND_FAKE_STARTED':'BOUND_FAKE_COMPLETED',
    physicalExecutionAuthorized:false,
    next:{...receipt.next,grantState:decision.next}};
}
function checkedSignedRequest(current,request) {
  const deny=(reason)=>({decision:'DENY',reason,physicalExecutionAuthorized:false});
  if(!current || typeof current.signedVerifierSpki!=='string' ||
      !/^[A-Za-z0-9_-]{40,700}$/.test(current.signedVerifierSpki) ||
      !/^[a-f0-9]{64}$/.test(current.signedVerifierSha||''))
    return deny('TRUSTED_VERIFIER_NOT_PINNED');
  let pub;
  try {
    pub=crypto.createPublicKey({key:Buffer.from(current.signedVerifierSpki,'base64url'),
      format:'der',type:'spki'});
    if(pub.asymmetricKeyType!=='ed25519' ||
       syntheticKeyFingerprint(pub)!==current.signedVerifierSha)
      return deny('PINNED_VERIFIER_INVALID');
  }catch{return deny('PINNED_VERIFIER_INVALID');}
  // Real local wall-clock read INSIDE the locked worker; the untrusted caller
  // must never be able to extend an expired signed lease with request.nowMs.
  const now=Date.now();
  if(!Number.isSafeInteger(now)||now<0) return deny('INVALID_LOCAL_CLOCK');
  if(request.operation==='signed_recover'){
    const r=evaluateSyntheticReceiptDecision(current,{
      operation:'recover',lockState:'acquired',storageHealth:'healthy',
      nowMs:now,recoveryEvidence:'synthetic_snapshot_checked'});
    return r;
  }
  let epoch;
  try { epoch=verifySyntheticEpochPacket(request.signedEpoch,pub); }
  catch { return deny('EPOCH_SIGNATURE_OR_SHAPE_INVALID'); }
  if(epoch.accountId!==current.accountId||epoch.deviceId!==current.deviceId||
      epoch.agentId!==current.agentId) return deny('SIGNED_EPOCH_WRONG_TARGET');
  if(now<epoch.notBefore||now>=epoch.expiresAt)
    return deny('SIGNED_EPOCH_NOT_FRESH');
  const digest=syntheticSignedEpochDigest(epoch);
  if(request.operation==='signed_epoch'){
    if(epoch.generation<current.generation ||
       epoch.grantRevision<current.grantRevision)
      return deny('SIGNED_EPOCH_ROLLBACK');
    if(epoch.generation===current.generation&&
        digest!==current.signedEpochDigest)
      return deny('SIGNED_EPOCH_SAME_GENERATION_CONFLICT');
    const r=evaluateSyntheticReceiptDecision(current,{
      operation:'advance_epoch',lockState:'acquired',storageHealth:'healthy',nowMs:now,
      proof:{kind:'fake_epoch',verifiedBy:'synthetic_test_only',
        accountId:epoch.accountId,deviceId:epoch.deviceId,agentId:epoch.agentId,
        generation:epoch.generation,grantRevision:epoch.grantRevision,
        notBeforeMs:epoch.notBefore,expiresAtMs:epoch.expiresAt}
    });
    if(r.decision==='PROPOSE_DURABLE_MUTATION')
      return {...r,next:{...r.next,signedEpochDigest:digest}};
    return r;
  }
  if(digest!==current.signedEpochDigest ||
      epoch.generation!==current.generation ||
      epoch.grantRevision!==current.grantRevision)
    return deny('SIGNED_EPOCH_NOT_CURRENT');
  if(!['signed_accept','signed_start','signed_complete'].includes(request.operation))
    return deny('UNKNOWN_SIGNED_ACTION');
  let command;
  try {command=verifySyntheticCommandPacket(request.signedCommand,pub);}
  catch{return deny('COMMAND_SIGNATURE_OR_SHAPE_INVALID');}
  if(command.accountId!==epoch.accountId||command.deviceId!==epoch.deviceId||
     command.agentId!==epoch.agentId||command.generation!==epoch.generation||
     command.grantRevision!==epoch.grantRevision||
     command.epochDigest!==digest ||
     command.notBefore<epoch.notBefore||command.expiresAt>epoch.expiresAt)
    return deny('SIGNED_COMMAND_GRANT_OR_EPOCH_MISMATCH');
  if(now<command.notBefore||now>=command.expiresAt)
    return deny('SIGNED_COMMAND_NOT_FRESH');
  const fake={
    kind:'fake_command',verifiedBy:'synthetic_test_only',
    accountId:command.accountId,deviceId:command.deviceId,agentId:command.agentId,
    generation:command.generation,grantRevision:command.grantRevision,
    notBeforeMs:command.notBefore,expiresAtMs:command.expiresAt,
    commandId:command.commandId,
    digest:syntheticSignedCommandDigest(command),
    payload:command.payload
  };
  const operation=request.operation==='signed_accept'?'accept':
    request.operation==='signed_start'?'start_fake':'complete_fake';
  return evaluateSyntheticReceiptDecision(current,{
    operation,command:fake,
    lockState:'acquired',storageHealth:'healthy',nowMs:now,
    ...(operation==='complete_fake'?{resultEvidence:'synthetic_noop_result'}:{})
  });
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
  if(request.operation==='initialize_bound'){
    if(current!==null)refuse('fixture_already_initialized');
    let writer,wall,issuer;
    try {
      writer=readPinnedPublicKey(request.verifierSpki);
      wall=readPinnedPublicKey(request.wallVerifierSpki);
      issuer=readPinnedPublicKey(request.leaseVerifierSpki);
    }catch{refuse('invalid_bound_issuer_keys');}
    const fp=[writer,wall,issuer].map(syntheticKeyFingerprint);
    if(new Set(fp).size!==3)refuse('bound_issuer_key_reuse_disallowed');
    const initial=makeEmptySyntheticSnapshot();
    if(request.deviceKeySha256===undefined)refuse('device_key_fingerprint_required');
    let grantState;
    try{
      grantState=makeFakeDeviceGrantState({
        ownerAccountId:initial.accountId,accountId:initial.accountId,
        deviceId:initial.deviceId,agentId:initial.agentId,
        deviceKeySha256:request.deviceKeySha256,
        wallPublicKey:wall,issuerPublicKey:issuer
      });
    }catch{refuse('invalid_bound_identity');}
    persist({...initial,
      signedVerifierSpki:request.verifierSpki,
      signedVerifierSha:syntheticKeyFingerprint(writer),signedEpochDigest:null,
      wallVerifierSpki:request.wallVerifierSpki,
      leaseVerifierSpki:request.leaseVerifierSpki,
      grantState});
    process.stdout.write(JSON.stringify({
      decision:'BOUND_INITIALIZED',physicalExecutionAuthorized:false
    })+'\n');
  } else if(request.operation==='initialize_signed'){
    if(current!==null) refuse('fixture_already_initialized');
    if(typeof request.verifierSpki!=='string' ||
       !/^[A-Za-z0-9_-]{40,700}$/.test(request.verifierSpki))
      refuse('bad_initial_verifier');
    let pub;
    try{
      pub=crypto.createPublicKey({key:Buffer.from(request.verifierSpki,'base64url'),
        format:'der',type:'spki'});
    }catch{refuse('bad_initial_verifier');}
    if(pub.asymmetricKeyType!=='ed25519') refuse('bad_initial_verifier');
    const canonical=pub.export({format:'der',type:'spki'}).toString('base64url');
    if(canonical!==request.verifierSpki) refuse('noncanonical_initial_verifier');
    persist({...makeEmptySyntheticSnapshot(),signedVerifierSpki:canonical,
      signedVerifierSha:syntheticKeyFingerprint(pub),signedEpochDigest:null});
    process.stdout.write(JSON.stringify({decision:'SIGNED_INITIALIZED',
      physicalExecutionAuthorized:false})+'\n');
  } else if (request.operation==='initialize') {
    if (current !== null) refuse('fixture_already_initialized');
    persist(makeEmptySyntheticSnapshot());
    process.stdout.write(JSON.stringify({decision:'INITIALIZED',physicalExecutionAuthorized:false})+'\n');
  } else {
    if (current===null) refuse('receipt_snapshot_missing');
    // A bound root cannot be mutated by the earlier, less restrictive
    // signed-only/unsigned fake paths. It has ONE compulsory lock+grant gate.
    if(current.grantState && !request.operation?.startsWith('bound_'))
      refuse('bypass_bound_authority_disallowed');
    if(!current.grantState && request.operation?.startsWith('bound_'))
      refuse('bound_authority_not_initialized');
    if(!current.grantState && current.signedVerifierSpki &&
       !request.operation?.startsWith('signed_'))
      refuse('unsigned_operation_on_pinned_authority');
    if(!current.signedVerifierSpki && request.operation?.startsWith('signed_'))
      refuse('signed_action_requires_pinned_root');
    const decision=current.grantState?
      checkedBoundRequest(current,request):
      current.signedVerifierSpki?checkedSignedRequest(current,request):
      evaluateSyntheticReceiptDecision(current,{
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
      if (request.crashAfterPersist===true &&
          (request.operation==='start_fake'||request.operation==='signed_start'||
           request.operation==='bound_start'))
        process.kill(process.pid,'SIGKILL'); // only fake STARTED receipt, no OS action
    }
  }
} catch (error) {
  refuse('worker_error_' + String(error?.message || error).replace(/\s+/g,'_').slice(0,65));
}
