import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../../client/windows-native/LightRemote.Updater/UpdateClient.cs',import.meta.url),'utf8');
for(const token of [
  'ManifestPairAttempts=3',
  'DownloadVerifiedManifestPairAsync',
  'IsPairVerificationFailure',
  'WithCacheBuster',
  'lrpair=',
  'NoCache=true',
  'NoStore=true',
  'Task.Delay(TimeSpan.FromMilliseconds(250*attempt)',
  'VerifySignedManifest(manifestBytes,signatureText,RecoveryPaths.UpdatePublicKey)'
]) assert.ok(source.includes(token),'missing updater pair-retry contract: '+token);
assert.ok(source.includes('attempt<ManifestPairAttempts&&IsPairVerificationFailure(ex)'),'retry must be limited to signature-pair verification failures');
assert.ok(source.includes('throw new CryptographicException("Update manifest signature verification exhausted.")'),'retry exhaustion must remain fail-closed');
assert.ok(!source.includes('catch(Exception){return'),'updater must not fail open');
console.log('v11-update-manifest-pair-retry=PASS');
