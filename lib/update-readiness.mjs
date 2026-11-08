import crypto from 'node:crypto';
import {clientCompatibility,compareVersion,minimumSupportedVersion,parseVersion} from './version-compat.mjs';

export function validateSignedUpdateManifest({manifestBytes,signatureText,publicKeyPem,serverVersion,policy,exact=false}={}){
  const bytes=Buffer.isBuffer(manifestBytes)?manifestBytes:Buffer.from(manifestBytes||'');
  const manifest=JSON.parse(bytes.toString('utf8'));
  const key=crypto.createPublicKey(publicKeyPem);
  let signature;
  try{signature=Buffer.from(String(signatureText||'').trim(),'base64');}catch{throw new Error('update_readiness_signature_invalid');}
  if(!signature.length||!crypto.verify('sha256',bytes,key,signature))throw new Error('update_readiness_signature_invalid');
  if(manifest.schemaVersion!==1||manifest.channel!==policy.channel||!parseVersion(manifest.version))throw new Error('update_readiness_manifest_invalid');
  if(!parseVersion(serverVersion))throw new Error('update_readiness_server_version_invalid');
  const minimum=minimumSupportedVersion(serverVersion,{backwardReleases:policy.backwardReleases});
  if(compareVersion(manifest.version,minimum)<0)throw new Error(`update_readiness_version_too_old:${manifest.version}:minimum=${minimum}`);
  if(exact&&compareVersion(manifest.version,serverVersion)!==0)throw new Error(`update_readiness_not_current:${manifest.version}:current=${serverVersion}`);
  for(const platform of policy.requiredPlatforms){
    const artifact=manifest.artifacts?.[platform];
    if(!artifact)throw new Error(`update_readiness_artifact_missing:${platform}`);
    if(policy.requireHttps&&!/^https:\/\//i.test(String(artifact.url||'')))throw new Error(`update_readiness_artifact_url_not_https:${platform}`);
    if(!/^[a-f0-9]{64}$/i.test(String(artifact.sha256||'')))throw new Error(`update_readiness_artifact_sha_invalid:${platform}`);
    if(!Number.isSafeInteger(Number(artifact.size))||Number(artifact.size)<=0)throw new Error(`update_readiness_artifact_size_invalid:${platform}`);
  }
  const spki=key.export({format:'der',type:'spki'}),keySha=crypto.createHash('sha256').update(spki).digest('hex');
  const compatibility=clientCompatibility(serverVersion,manifest.version,{backwardReleases:policy.backwardReleases});
  return {manifest,minimum,keySha,compatibility};
}
