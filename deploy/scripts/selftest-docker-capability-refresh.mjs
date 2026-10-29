import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EnrollmentRegistry } from '../../operator-host/enrollment-registry.mjs';
import { devicePolicyMessage, deviceHeartbeatMessage } from '../../lib/device-proof.mjs';
import { createLinuxAdapter } from '../../device-agent/platform-adapters/linux.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-docker-rescan-'));
try {
  const now=1_800_000_000_000;
  const registry=new EnrollmentRegistry({stateFile:path.join(root,'state.json'),signerFile:path.join(root,'signer.pem'),now:()=>now});
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
  const accountId='owner-a';
  const enrollment=registry.begin({publicIdentityKey,displayName:'Docker late-install fixture',platform:'linux',architecture:'x64',capabilities:['filesystem','git'],agentVersion:'test'});
  const approved=registry.approve({enrollmentId:enrollment.enrollmentId,code:enrollment.deviceCode,accountId,approvedCapabilities:['filesystem','git'],policyProfile:'full'});
  const deviceId=approved.deviceId;
  const initial=registry.policyView(deviceId);
  assert.equal(initial.grantableCapabilities.includes('docker'),false);
  assert.throws(()=>registry.updatePolicy({deviceId,accountId,approvedCapabilities:['filesystem','git','docker']}),/approved_capability_not_grantable/);

  assert.throws(()=>registry.refreshDiscoveredCapabilities({deviceId,accountId:'attacker',capabilities:['filesystem','git','docker']}),/device_account_mismatch/);
  assert.throws(()=>registry.refreshDiscoveredCapabilities({deviceId,accountId,capabilities:['docker']}),/device_filesystem_capability_required/);
  assert.equal(registry.policyView(deviceId).policyRevision,initial.policyRevision);

  const scan=registry.refreshDiscoveredCapabilities({deviceId,accountId,capabilities:['filesystem','git','docker']});
  assert.deepEqual(scan.addedCapabilities,['docker']);
  assert.deepEqual(scan.approvalRequired,['docker']);
  assert(scan.policy.grantableCapabilities.includes('docker'));
  assert(!scan.policy.approvedCapabilities.includes('docker'),'rescan must not grant Docker');
  assert.equal(scan.policy.policyRevision,initial.policyRevision+1);

  const signed=registry.policyEnvelope(deviceId);
  const policy=signed.policy;
  const signaturePayload=devicePolicyMessage({deviceId,accountId,revision:policy.policyRevision,approvedCapabilities:policy.approvedCapabilities,grantableCapabilities:policy.grantableCapabilities,policyProfile:policy.policyProfile,updatedAt:policy.policyUpdatedAt});
  const serverKey=crypto.createPublicKey({key:Buffer.from(signed.signer.publicKey,'base64'),format:'der',type:'spki'});
  assert(crypto.verify(null,Buffer.from(signaturePayload),serverKey,Buffer.from(signed.signature,'base64url')),'policy rescan must be signed');
  const timestamp=now,nonce=crypto.randomBytes(18).toString('base64url'),capabilities=['filesystem','git','docker'];
  const signature=crypto.sign(null,Buffer.from(deviceHeartbeatMessage({deviceId,timestamp,nonce,capabilities})),privateKey).toString('base64url');
  assert.throws(()=>registry.verifyHeartbeat({deviceId,timestamp,nonce,capabilities,signature,policyRevision:scan.policy.policyRevision}),/device_capability_escalation/);
  const same=registry.refreshDiscoveredCapabilities({deviceId,accountId,capabilities:['filesystem','git','docker']});
  assert.equal(same.policy.policyRevision,scan.policy.policyRevision,'idempotent rescan');

  const afterOwner=registry.updatePolicy({deviceId,accountId,approvedCapabilities:['filesystem','git','docker']});
  assert(afterOwner.approvedCapabilities.includes('docker'));
  const downgrade=registry.refreshDiscoveredCapabilities({deviceId,accountId,capabilities:['filesystem','git']});
  assert(downgrade.removedCapabilities.includes('docker'));
  assert(!downgrade.policy.approvedCapabilities.includes('docker'),'uninstalled Docker must be revoked');
  assert.throws(()=>registry.updatePolicy({deviceId,accountId,approvedCapabilities:['filesystem','git','docker']}),/approved_capability_not_grantable/);
  const reload=new EnrollmentRegistry({stateFile:path.join(root,'state.json'),signerFile:path.join(root,'signer.pem'),now:()=>now});
  assert(!reload.policyView(deviceId).grantableCapabilities.includes('docker'),'rescan must survive restart');

  const adapter=createLinuxAdapter({commandExists:()=>true});
  for(const harmless of ['command -v docker','which docker','type -P docker']){
    assert(!adapter.inferRequiredCapabilities(harmless).includes('docker'),harmless+' must be diagnostic');
  }
  for(const unsafe of ['command -v docker && docker ps','which docker; docker rm foo','docker ps','$(docker ps)','command -v /usr/bin/docker']){
    assert(adapter.inferRequiredCapabilities(unsafe).includes('docker'),unsafe+' must remain gated');
  }
  console.log('DOCKER_CAPABILITY_REFRESH_PASS signed_policy,owner_approval,revoke,restart,idempotence,classification');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
